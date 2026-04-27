import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { ensureYouTubeTables, getValidAccessToken } from "@/lib/youtube";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_PRIVACY = ["public", "unlisted", "private"] as const;
type Privacy = (typeof ALLOWED_PRIVACY)[number];

export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  await ensureYouTubeTables();
  const uploads = await sql`
    SELECT id, title, description, privacy_status, publish_at, status, youtube_video_id, error, created_at
    FROM youtube_uploads WHERE user_id = ${users[0].id}
    ORDER BY created_at DESC LIMIT 50
  `;
  return NextResponse.json({ uploads });
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
  const userId = users[0].id;

  const allowed = checkRateLimit(`youtube-upload:${userId}`, { limit: 10, windowMs: 60000 });
  if (!allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const body = await req.json();
  const title: string = (body.title || "").trim();
  const description: string = body.description || "";
  const tags: string[] = Array.isArray(body.tags) ? body.tags.slice(0, 30) : [];
  const categoryId: string = body.categoryId || "22";
  const videoUrl: string = body.videoUrl || "";
  const privacyInput: string = body.privacyStatus || "public";
  const publishAtIso: string | undefined = body.publishAt;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!videoUrl) {
    return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
  }
  if (!ALLOWED_PRIVACY.includes(privacyInput as Privacy)) {
    return NextResponse.json(
      { error: `privacyStatus must be one of: ${ALLOWED_PRIVACY.join(", ")}` },
      { status: 400 }
    );
  }
  let publishAt: Date | null = null;
  if (publishAtIso) {
    publishAt = new Date(publishAtIso);
    if (isNaN(publishAt.getTime())) {
      return NextResponse.json({ error: "publishAt is not a valid ISO date" }, { status: 400 });
    }
    if (publishAt.getTime() < Date.now() + 60 * 1000) {
      return NextResponse.json(
        { error: "publishAt must be at least 1 minute in the future" },
        { status: 400 }
      );
    }
  }

  const tokenInfo = await getValidAccessToken(userId);
  if (!tokenInfo) {
    return NextResponse.json({ error: "YouTube not connected" }, { status: 400 });
  }

  await ensureYouTubeTables();
  // Scheduled publish requires the video to be uploaded as private.
  const effectivePrivacy: Privacy = publishAt ? "private" : (privacyInput as Privacy);

  const inserted = await sql`
    INSERT INTO youtube_uploads
      (user_id, title, description, tags, category_id, privacy_status, publish_at, video_url, status)
    VALUES
      (${userId}, ${title}, ${description}, ${tags as unknown as string}, ${categoryId},
       ${effectivePrivacy}, ${publishAt}, ${videoUrl}, 'uploading')
    RETURNING id
  `;
  const uploadRowId = inserted[0].id;

  try {
    // 1. Fetch the video bytes from the source URL
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new Error(`Failed to fetch source video: ${videoRes.status}`);
    }
    const videoBytes = Buffer.from(await videoRes.arrayBuffer());
    const contentType = (videoRes.headers.get("content-type") || "video/mp4").split(";")[0].trim();

    // 2. Initiate resumable upload to YouTube
    const metadata = {
      snippet: {
        title,
        description,
        tags,
        categoryId,
      },
      status: {
        privacyStatus: effectivePrivacy,
        ...(publishAt ? { publishAt: publishAt.toISOString() } : {}),
        selfDeclaredMadeForKids: false,
      },
    };

    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": contentType,
          "X-Upload-Content-Length": String(videoBytes.byteLength),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const errBody = await initRes.text();
      throw new Error(`YouTube init failed (${initRes.status}): ${errBody}`);
    }
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) {
      throw new Error("YouTube did not return an upload URL");
    }

    // 3. PUT the bytes
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenInfo.accessToken}`,
        "Content-Type": contentType,
        "Content-Length": String(videoBytes.byteLength),
      },
      body: videoBytes,
    });

    const putData = await putRes.json();
    if (!putRes.ok || !putData.id) {
      throw new Error(`YouTube upload failed (${putRes.status}): ${JSON.stringify(putData)}`);
    }

    const finalStatus = publishAt ? "scheduled" : "published";
    await sql`
      UPDATE youtube_uploads
      SET youtube_video_id = ${putData.id}, status = ${finalStatus}, updated_at = NOW()
      WHERE id = ${uploadRowId}
    `;

    return NextResponse.json({
      success: true,
      id: uploadRowId,
      youtubeVideoId: putData.id,
      status: finalStatus,
      videoUrl: `https://youtu.be/${putData.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("YouTube upload error:", message);
    await sql`
      UPDATE youtube_uploads
      SET status = 'failed', error = ${message}, updated_at = NOW()
      WHERE id = ${uploadRowId}
    `;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
