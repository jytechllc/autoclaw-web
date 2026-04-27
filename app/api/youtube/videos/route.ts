import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getValidAccessToken } from "@/lib/youtube";

export const dynamic = "force-dynamic";

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationIso: string;
}

export async function GET(req: NextRequest) {
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

  const max = Math.min(parseInt(req.nextUrl.searchParams.get("max") || "25", 10), 50);

  // 1. Get the user's uploads playlist ID
  const channelRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?mine=true&part=contentDetails",
    { headers: { Authorization: `Bearer ${tokenInfo.accessToken}` } }
  );
  const channelData = await channelRes.json();
  const uploadsPlaylistId =
    channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    return NextResponse.json({ videos: [], summary: emptySummary() });
  }

  // 2. Fetch the most recent uploads from that playlist
  const playlistRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${uploadsPlaylistId}&part=contentDetails,snippet&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${tokenInfo.accessToken}` } }
  );
  const playlistData = await playlistRes.json();
  const videoIds: string[] = (playlistData?.items || [])
    .map((it: { contentDetails?: { videoId?: string } }) => it.contentDetails?.videoId)
    .filter((id: string | undefined): id is string => Boolean(id));

  if (videoIds.length === 0) {
    return NextResponse.json({ videos: [], summary: emptySummary() });
  }

  // 3. Get statistics for those videos in one batch
  const videosRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${videoIds.join(",")}&part=snippet,statistics,contentDetails`,
    { headers: { Authorization: `Bearer ${tokenInfo.accessToken}` } }
  );
  const videosData = await videosRes.json();

  const videos: YouTubeVideo[] = (videosData?.items || []).map(
    (v: {
      id: string;
      snippet?: { title?: string; description?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      contentDetails?: { duration?: string };
    }) => ({
      id: v.id,
      title: v.snippet?.title || "",
      description: v.snippet?.description || "",
      thumbnailUrl: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || "",
      publishedAt: v.snippet?.publishedAt || "",
      viewCount: parseInt(v.statistics?.viewCount || "0", 10),
      likeCount: parseInt(v.statistics?.likeCount || "0", 10),
      commentCount: parseInt(v.statistics?.commentCount || "0", 10),
      durationIso: v.contentDetails?.duration || "",
    })
  );

  return NextResponse.json({ videos, summary: summarize(videos) });
}

function emptySummary() {
  return {
    totalVideos: 0,
    totalViews: 0,
    avgViews: 0,
    avgLikes: 0,
    avgComments: 0,
    topVideo: null as null | { id: string; title: string; viewCount: number },
    postsByHour: Array.from({ length: 24 }, () => 0),
    postsByWeekday: Array.from({ length: 7 }, () => 0),
  };
}

function summarize(videos: YouTubeVideo[]): ReturnType<typeof emptySummary> {
  if (videos.length === 0) return emptySummary();
  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
  const totalLikes = videos.reduce((s, v) => s + v.likeCount, 0);
  const totalComments = videos.reduce((s, v) => s + v.commentCount, 0);
  const top = videos.reduce((a, b) => (b.viewCount > a.viewCount ? b : a));
  const postsByHour = Array.from({ length: 24 }, () => 0);
  const postsByWeekday = Array.from({ length: 7 }, () => 0);
  for (const v of videos) {
    if (v.publishedAt) {
      const d = new Date(v.publishedAt);
      postsByHour[d.getUTCHours()]++;
      postsByWeekday[d.getUTCDay()]++;
    }
  }
  return {
    totalVideos: videos.length,
    totalViews,
    avgViews: Math.round(totalViews / videos.length),
    avgLikes: Math.round(totalLikes / videos.length),
    avgComments: Math.round(totalComments / videos.length),
    topVideo: { id: top.id, title: top.title, viewCount: top.viewCount },
    postsByHour,
    postsByWeekday,
  };
}
