import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getValidAccessToken } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED = ["public", "unlisted", "private"] as const;
type Privacy = (typeof ALLOWED)[number];

interface VideoStatus {
  privacyStatus?: string;
  embeddable?: boolean;
  publicStatsViewable?: boolean;
  selfDeclaredMadeForKids?: boolean;
  madeForKids?: boolean;
  license?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const tokenInfo = await getValidAccessToken(users[0].id);
  if (!tokenInfo) {
    return NextResponse.json({ error: "YouTube not connected" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const target = (body.privacyStatus || "public") as string;
  if (!ALLOWED.includes(target as Privacy)) {
    return NextResponse.json(
      { error: `privacyStatus must be one of: ${ALLOWED.join(", ")}` },
      { status: 400 }
    );
  }

  // 1. Get uploads playlist ID
  const channelRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?mine=true&part=contentDetails",
    { headers: { Authorization: `Bearer ${tokenInfo.accessToken}` } }
  );
  const channelData = await channelRes.json();
  const uploadsPlaylistId =
    channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    return NextResponse.json({ error: "No uploads playlist found" }, { status: 400 });
  }

  // 2. Page through playlistItems to collect all video IDs
  const allIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("playlistId", uploadsPlaylistId);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${tokenInfo.accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to list videos: ${data?.error?.message || res.status}` },
        { status: 502 }
      );
    }
    for (const it of data.items || []) {
      const id = it.contentDetails?.videoId;
      if (id) allIds.push(id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  if (allIds.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, failed: 0, total: 0 });
  }

  // 3. Process in batches of 50: fetch full status, then PUT one by one for those that differ
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: { id: string; error: string }[] = [];

  for (let i = 0; i < allIds.length; i += 50) {
    const batch = allIds.slice(i, i + 50);
    const listRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${batch.join(",")}&part=status`,
      { headers: { Authorization: `Bearer ${tokenInfo.accessToken}` } }
    );
    const listData = await listRes.json();
    if (!listRes.ok) {
      failed += batch.length;
      for (const id of batch) {
        failures.push({ id, error: listData?.error?.message || `HTTP ${listRes.status}` });
      }
      continue;
    }

    for (const item of listData.items || []) {
      const id: string = item.id;
      const currentStatus: VideoStatus = item.status || {};
      if (currentStatus.privacyStatus === target) {
        skipped++;
        continue;
      }
      const updateRes = await fetch(
        "https://www.googleapis.com/youtube/v3/videos?part=status",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tokenInfo.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id,
            status: {
              ...currentStatus,
              privacyStatus: target,
            },
          }),
        }
      );
      if (updateRes.ok) {
        updated++;
      } else {
        failed++;
        const errBody = await updateRes.json().catch(() => ({}));
        failures.push({
          id,
          error: errBody?.error?.message || `HTTP ${updateRes.status}`,
        });
      }
    }
  }

  return NextResponse.json({
    total: allIds.length,
    updated,
    skipped,
    failed,
    target,
    ...(failures.length > 0 ? { failures: failures.slice(0, 20) } : {}),
  });
}
