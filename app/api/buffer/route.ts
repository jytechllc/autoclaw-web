import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const BUFFER_API = "https://api.buffer.com";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

interface ResolvedToken {
  token: string;
  source: "personal" | "org";
  orgId?: number;
  orgName?: string;
}

async function resolveBufferToken(userId: number, orgId?: number): Promise<ResolvedToken | null> {
  const sql = getDb();

  try {
    // If a specific org is requested, try org key first
    if (orgId) {
      const orgRows = await sql`
        SELECT ok.api_key, o.name as org_name
        FROM org_api_keys ok
        JOIN organizations o ON o.id = ok.org_id
        WHERE ok.service = 'buffer' AND ok.org_id = ${orgId}
          AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
        LIMIT 1
      `;
      if (orgRows.length > 0) {
        try {
          return { token: decrypt(orgRows[0].api_key as string), source: "org", orgId, orgName: orgRows[0].org_name as string };
        } catch {
          return { token: orgRows[0].api_key as string, source: "org", orgId, orgName: orgRows[0].org_name as string };
        }
      }
    }

    // Try personal key
    const personalRows = await sql`
      SELECT api_key FROM user_api_keys
      WHERE user_id = ${userId} AND service = 'buffer'
      LIMIT 1
    `;
    if (personalRows.length > 0) {
      try {
        return { token: decrypt(personalRows[0].api_key as string), source: "personal" };
      } catch {
        return { token: personalRows[0].api_key as string, source: "personal" };
      }
    }

    // Fall back to any org key the user has access to
    const anyOrgRows = await sql`
      SELECT ok.api_key, ok.org_id, o.name as org_name
      FROM org_api_keys ok
      JOIN organizations o ON o.id = ok.org_id
      WHERE ok.service = 'buffer'
        AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      ORDER BY ok.org_id
      LIMIT 1
    `;
    if (anyOrgRows.length > 0) {
      try {
        return { token: decrypt(anyOrgRows[0].api_key as string), source: "org", orgId: anyOrgRows[0].org_id as number, orgName: anyOrgRows[0].org_name as string };
      } catch {
        return { token: anyOrgRows[0].api_key as string, source: "org", orgId: anyOrgRows[0].org_id as number, orgName: anyOrgRows[0].org_name as string };
      }
    }
  } catch {
    // org_api_keys table may not exist yet
  }

  return null;
}

async function bufferGraphQL(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, data, raw: text };
}

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userId = users[0].id as number;
  const action = req.nextUrl.searchParams.get("action");
  const orgIdParam = req.nextUrl.searchParams.get("org_id");
  const orgId = orgIdParam ? parseInt(orgIdParam) : undefined;

  // List orgs with buffer keys configured
  if (action === "orgs") {
    try {
      const personalRows = await sql`
        SELECT 1 FROM user_api_keys WHERE user_id = ${userId} AND service = 'buffer' LIMIT 1
      `;
      const hasPersonal = personalRows.length > 0;

      const orgRows = await sql`
        SELECT o.id, o.name, om.role as member_role
        FROM organizations o
        JOIN organization_members om ON om.org_id = o.id AND om.user_id = ${userId}
        WHERE o.id IN (
          SELECT org_id FROM org_api_keys WHERE service = 'buffer'
        )
        ORDER BY o.name
      `;

      return NextResponse.json({
        hasPersonal,
        orgs: orgRows.map((r) => ({ id: r.id, name: r.name, role: r.member_role })),
      });
    } catch {
      return NextResponse.json({ hasPersonal: false, orgs: [] });
    }
  }

  const resolved = await resolveBufferToken(userId, orgId);
  if (!resolved) {
    return NextResponse.json({ error: "Buffer token not configured", debug: { userId, orgId: orgId || null } }, { status: 400 });
  }
  const { token } = resolved;

  // Get organizations first (needed for channels query)
  if (action === "profiles") {
    try {
      // Step 1: Get Buffer organizations
      const orgsResult = await bufferGraphQL(token, `
        query GetOrganizations {
          account {
            organizations {
              id
              name
            }
          }
        }
      `);

      if (!orgsResult.ok || !orgsResult.data) {
        const err = orgsResult.data as Record<string, unknown>;
        return NextResponse.json({
          error: `Buffer API error (${orgsResult.status}): ${err?.errors ? JSON.stringify(err.errors) : orgsResult.raw?.slice(0, 200)}`,
          source: resolved.source,
          orgName: resolved.orgName,
        }, { status: orgsResult.status });
      }

      const gqlData = orgsResult.data as { data?: { account?: { organizations?: { id: string; name: string }[] } }; errors?: unknown[] };
      if (gqlData.errors) {
        return NextResponse.json({
          error: `Buffer GraphQL error: ${JSON.stringify(gqlData.errors)}`,
          source: resolved.source,
          orgName: resolved.orgName,
        }, { status: 400 });
      }

      const bufferOrgs = gqlData.data?.account?.organizations || [];
      if (bufferOrgs.length === 0) {
        return NextResponse.json({ profiles: [], source: resolved.source, orgId: resolved.orgId, orgName: resolved.orgName });
      }

      // Step 2: Get channels for each organization
      const allChannels: { id: string; name: string; displayName: string; service: string; avatar: string; organizationId: string }[] = [];

      for (const bufOrg of bufferOrgs) {
        const chResult = await bufferGraphQL(token, `
          query GetChannels($orgId: OrganizationId!) {
            channels(input: { organizationId: $orgId }) {
              id
              name
              displayName
              service
              avatar
              isQueuePaused
            }
          }
        `, { orgId: bufOrg.id });

        const chData = chResult.data as { data?: { channels?: { id: string; name: string; displayName: string; service: string; avatar: string }[] } };
        if (chData?.data?.channels) {
          for (const ch of chData.data.channels) {
            allChannels.push({ ...ch, organizationId: bufOrg.id });
          }
        }
      }

      // Map to the profile format the frontend expects
      const profiles = allChannels.map((ch) => ({
        id: ch.id,
        service: ch.service,
        formatted_service: ch.service,
        avatar: ch.avatar || "",
        service_username: ch.displayName || ch.name,
        organization_id: ch.organizationId,
      }));

      return NextResponse.json({ profiles, source: resolved.source, orgId: resolved.orgId, orgName: resolved.orgName });
    } catch (err) {
      return NextResponse.json({ error: `Failed to fetch profiles: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  // Debug: raw channels query
  if (action === "debug") {
    const orgsResult = await bufferGraphQL(token, `
      query { account { organizations { id name } } }
    `);
    const gqlData = orgsResult.data as { data?: { account?: { organizations?: { id: string; name: string }[] } } };
    const bufferOrgs = gqlData?.data?.account?.organizations || [];

    const channelResults: Record<string, unknown> = {};
    for (const bufOrg of bufferOrgs) {
      const chResult = await bufferGraphQL(token, `
        query GetChannels($orgId: OrganizationId!) {
          channels(input: { organizationId: $orgId }) {
            id
            name
            displayName
            service
            avatar
            isQueuePaused
          }
        }
      `, { orgId: bufOrg.id });
      channelResults[`${bufOrg.name} (${bufOrg.id})`] = chResult.data;
    }

    return NextResponse.json({
      orgs: bufferOrgs,
      channels: channelResults,
      source: resolved.source,
    });
  }

  // Verify token
  if (action === "verify") {
    try {
      const result = await bufferGraphQL(token, `
        query Verify {
          account {
            email
            organizations {
              id
              name
            }
          }
        }
      `);
      return NextResponse.json({
        ok: result.ok,
        status: result.status,
        data: result.data,
        source: resolved.source,
        orgName: resolved.orgName,
        tokenPrefix: token.slice(0, 8) + "...",
      });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (action === "posts") {
    try {
      // Get orgs first
      const orgsResult = await bufferGraphQL(token, `
        query { account { organizations { id } } }
      `);
      const gqlData = orgsResult.data as { data?: { account?: { organizations?: { id: string }[] } } };
      const bufferOrgs = gqlData?.data?.account?.organizations || [];

      const allPosts: unknown[] = [];
      for (const bufOrg of bufferOrgs.slice(0, 3)) {
        const postsResult = await bufferGraphQL(token, `
          query GetPosts($orgId: OrganizationId!) {
            posts(input: { organizationId: $orgId }, first: 20) {
              edges {
                node {
                  id
                  text
                  status
                  dueAt
                  createdAt
                  sentAt
                  externalLink
                  channel {
                    id
                    displayName
                    service
                  }
                }
              }
            }
          }
        `, { orgId: bufOrg.id });

        const postsData = postsResult.data as { data?: { posts?: { edges?: { node: unknown }[] } } };
        if (postsData?.data?.posts?.edges) {
          for (const edge of postsData.data.posts.edges) {
            allPosts.push(edge.node);
          }
        }
      }

      // Map to frontend format
      const posts = allPosts.map((p: unknown) => {
        const post = p as { id: string; text: string; status: string; dueAt?: string; createdAt?: string; sentAt?: string; externalLink?: string; channel?: { displayName?: string; service?: string } };
        return {
          id: post.id,
          text: post.text || "",
          status: post.status === "sent" ? "sent" : post.status === "scheduled" ? "buffer" : post.status,
          created_at: post.createdAt || "",
          due_at: post.dueAt || "",
          sent_at: post.sentAt || "",
          external_link: post.externalLink || "",
          channel_name: post.channel?.displayName || "",
          channel_service: post.channel?.service || "",
        };
      });

      return NextResponse.json({ posts, source: resolved.source, orgId: resolved.orgId, orgName: resolved.orgName });
    } catch {
      return NextResponse.json({ posts: [] });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userId = users[0].id as number;
  const body = await req.json();
  const { text, profile_ids, now, scheduled_at, org_id, media_url } = body;
  // channel_services: { channelId: service } map from frontend
  const channelServices: Record<string, string> = body.channel_services || {};
  // channel_post_types: { channelId: postType } map from frontend (e.g. "post", "reel", "story")
  const channelPostTypes: Record<string, string> = body.channel_post_types || {};

  const resolved = await resolveBufferToken(userId, org_id);
  if (!resolved) {
    return NextResponse.json({ error: "Buffer token not configured" }, { status: 400 });
  }
  const { token } = resolved;

  if (!text || !profile_ids || profile_ids.length === 0) {
    return NextResponse.json({ error: "text and profile_ids are required" }, { status: 400 });
  }

  // Create a post for each selected channel
  const results: { channelId: string; success: boolean; error?: string; postId?: string }[] = [];

  for (const channelId of profile_ids) {
    const mode = now ? "shareNow" : scheduled_at ? "customScheduled" : "addToQueue";
    const dueAt = scheduled_at ? new Date(scheduled_at).toISOString() : undefined;

    // Build assets if media_url is provided
    // Also accept explicit media_type from frontend
    const assets: Record<string, unknown> = {};
    if (media_url) {
      const mediaType = body.media_type as string | undefined; // "video" | "image"
      const isVideoByExt = /\.(mp4|mov|avi|webm|mkv|wmv|flv)(\?|$)/i.test(media_url);
      const isImageByExt = /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic)(\?|$)/i.test(media_url);

      let isVideo = mediaType === "video" || isVideoByExt;

      if (!isVideo && !isImageByExt && !mediaType) {
        // Can't detect from extension, try HEAD request
        try {
          const headRes = await fetch(media_url, { method: "HEAD" });
          const ct = headRes.headers.get("content-type") || "";
          isVideo = ct.startsWith("video/");
        } catch {
          // Default: assume video for video-oriented channels
        }
      }

      if (isVideo) {
        assets.videos = [{ url: media_url }];
      } else {
        assets.images = [{ url: media_url }];
      }
    }

    // Build per-channel metadata (e.g. Instagram requires post type)
    const service = channelServices[channelId] || "";
    const metadata: Record<string, unknown> = {};
    const hasVideo = !!assets.videos;

    // Use user-selected post type, or smart default based on media
    const userType = channelPostTypes[channelId];

    if (service === "instagram") {
      const igType = userType || (hasVideo ? "reel" : "post");
      metadata.instagram = { type: igType, shouldShareToFeed: true };
    } else if (service === "facebook") {
      const fbType = userType || (hasVideo ? "reel" : "post");
      metadata.facebook = { type: fbType };
    } else if (service === "tiktok") {
      metadata.tiktok = {};
    } else if (service === "youtube") {
      const ytType = userType || (hasVideo ? "short" : "post");
      metadata.youtube = { type: ytType };
    } else if (service === "threads") {
      metadata.threads = { type: "post" };
    }

    const result = await bufferGraphQL(token, `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post {
              id
              text
            }
          }
          ... on MutationError {
            message
          }
        }
      }
    `, {
      input: {
        text,
        channelId,
        schedulingType: "automatic",
        mode,
        ...(dueAt ? { dueAt } : {}),
        ...(Object.keys(assets).length > 0 ? { assets } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
    });

    const gqlData = result.data as { data?: { createPost?: { post?: { id: string }; message?: string } }; errors?: { message: string }[] };

    if (gqlData?.errors) {
      results.push({ channelId, success: false, error: gqlData.errors.map((e) => e.message).join(", ") });
    } else if (gqlData?.data?.createPost?.message) {
      results.push({ channelId, success: false, error: gqlData.data.createPost.message });
    } else if (gqlData?.data?.createPost?.post?.id) {
      results.push({ channelId, success: true, postId: gqlData.data.createPost.post.id });
    } else {
      results.push({ channelId, success: false, error: "Unknown response" });
    }
  }

  const allSuccess = results.every((r) => r.success);
  const errors = results.filter((r) => !r.success).map((r) => r.error).join("; ");

  if (allSuccess) {
    return NextResponse.json({ success: true, results });
  } else {
    return NextResponse.json({ success: false, error: errors || "Failed to create post", results }, { status: 400 });
  }
}
