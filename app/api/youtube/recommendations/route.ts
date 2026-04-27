import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { chatWithAI } from "@/lib/ai";

export const dynamic = "force-dynamic";

interface IncomingVideo {
  id: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

interface IncomingChannel {
  title: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
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

  const body = await req.json();
  const channel = body.channel as IncomingChannel | undefined;
  const videos = (body.videos as IncomingVideo[] | undefined) || [];

  if (!channel || videos.length === 0) {
    return NextResponse.json(
      { error: "channel and videos are required" },
      { status: 400 }
    );
  }

  const top = [...videos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 10);
  const recent = [...videos]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 10);

  const prompt = `You are a YouTube growth strategist. Analyse this channel and produce concrete, actionable recommendations.

CHANNEL
- Title: ${channel.title}
- Subscribers: ${channel.subscriberCount}
- Total videos: ${channel.videoCount}
- Total views: ${channel.viewCount}
- Description: ${(channel.description || "").slice(0, 400)}

TOP 10 VIDEOS BY VIEWS
${top.map((v, i) => `${i + 1}. "${v.title}" — ${v.viewCount} views, ${v.likeCount} likes, ${v.commentCount} comments (published ${v.publishedAt})`).join("\n")}

10 MOST RECENT VIDEOS
${recent.map((v, i) => `${i + 1}. "${v.title}" — ${v.viewCount} views (published ${v.publishedAt})`).join("\n")}

Respond strictly as JSON with this shape (no markdown, no commentary):
{
  "summary": "2-3 sentence read of the channel's current state",
  "bestPostingTimes": ["e.g. Tue 18:00 UTC", "..."],
  "contentThemes": [{"theme": "...", "rationale": "..."}],
  "titleImprovements": [{"original": "...", "suggested": "...", "why": "..."}],
  "growthActions": ["concrete action 1", "concrete action 2", "..."]
}`;

  try {
    const ai = await chatWithAI(
      [
        { role: "system", content: "You are an expert YouTube channel strategist. Always reply with valid JSON only." },
        { role: "user", content: prompt },
      ],
      1500
    );

    const cleaned = ai.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "AI response was not valid JSON", raw: ai.content },
        { status: 502 }
      );
    }

    return NextResponse.json({
      recommendations: parsed,
      model: ai.model,
      provider: ai.provider,
    });
  } catch (err) {
    console.error("YouTube recommendations error:", err);
    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 }
    );
  }
}
