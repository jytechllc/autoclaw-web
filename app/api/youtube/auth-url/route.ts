import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getYouTubeAuthUrl } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      { status: 500 }
    );
  }
  const authUrl = getYouTubeAuthUrl(req.nextUrl.origin, "autoclaw-youtube");
  return NextResponse.json({ authUrl });
}
