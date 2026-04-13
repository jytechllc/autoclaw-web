import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserKey } from "@/lib/keys";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

// POST: Upload resume file (no auth, rate limited)
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const slug = formData.get("slug") as string | null;

  if (!file || !slug) {
    return NextResponse.json({ error: "file and slug are required" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only PDF, DOC, DOCX, JPG, PNG files are allowed" }, { status: 400 });
  }

  const sql = getDb();

  // Find org by slug and get the org owner's blob token
  const orgs = await sql`SELECT id, created_by FROM organizations WHERE slug = ${slug}`;
  if (orgs.length === 0) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const orgCreatorId = orgs[0].created_by as number;

  // Get the org owner's blob token (BYOK)
  const blobToken = await getUserKey(orgCreatorId, "blob_token");
  if (!blobToken && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Resume upload not configured. Please contact the employer." }, { status: 503 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `resumes/${slug}/${timestamp}-${safeName}`;

    const blob = await put(path, buffer, {
      access: "public",
      ...(blobToken ? { token: blobToken } : {}),
    });

    return NextResponse.json({ url: blob.url });
  } catch (e) {
    console.error("Resume upload failed:", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
