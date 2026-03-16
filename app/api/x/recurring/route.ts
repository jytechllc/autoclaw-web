import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function ensureRecurringTasksTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS x_recurring_tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      variant_label VARCHAR(10),
      content TEXT,
      media_url TEXT,
      image_prompt TEXT,
      tone VARCHAR(100),
      posts_per_week INTEGER DEFAULT 3,
      best_post_times JSONB DEFAULT '[]'::jsonb,
      status VARCHAR(50) DEFAULT 'active',
      version INTEGER DEFAULT 1,
      last_posted_at TIMESTAMP,
      last_posted_content TEXT,
      next_post_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Add last_posted_content column if missing (migration for existing tables)
  await sql`
    DO $$ BEGIN
      ALTER TABLE x_recurring_tasks ADD COLUMN IF NOT EXISTS last_posted_content TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `;
}

// GET: List recurring tasks
export async function GET() {
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

  await ensureRecurringTasksTable();

  const tasks = await sql`
    SELECT id, name, variant_label, tone, image_prompt, posts_per_week, best_post_times,
           status, version, last_posted_at, last_posted_content, next_post_at, created_at
    FROM x_recurring_tasks
    WHERE user_id = ${users[0].id}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ tasks });
}

// POST: Create or update a recurring task
export async function POST(req: NextRequest) {
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

  const userId = users[0].id;
  await ensureRecurringTasksTable();

  const body = await req.json();
  const { action } = body;

  // Update existing task (only variant settings, not content)
  if (action === "update") {
    const { id, imagePrompt, tone, postsPerWeek, bestPostTimes, name, status } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    // Verify ownership
    const existing = await sql`
      SELECT id, version FROM x_recurring_tasks WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const newVersion = existing[0].version + 1;
    await sql`
      UPDATE x_recurring_tasks SET
        image_prompt = COALESCE(${imagePrompt ?? null}, image_prompt),
        tone = COALESCE(${tone || null}, tone),
        posts_per_week = COALESCE(${postsPerWeek || null}, posts_per_week),
        best_post_times = COALESCE(${bestPostTimes ? JSON.stringify(bestPostTimes) : null}::jsonb, best_post_times),
        name = COALESCE(${name || null}, name),
        status = COALESCE(${status || null}, status),
        version = ${newVersion},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
    `;

    const updated = await sql`SELECT * FROM x_recurring_tasks WHERE id = ${id}`;
    return NextResponse.json({ task: updated[0] });
  }

  // Create new recurring task — stores variant strategy, not content
  const { content, mediaUrl, imagePrompt, tone, postsPerWeek, bestPostTimes, variantLabel, name } = body;

  // Calculate next post time
  const now = new Date();
  let nextPostAt = new Date(now);
  if (bestPostTimes?.length > 0) {
    const firstTime = bestPostTimes[0] as string;
    const match = firstTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      if (match[3]?.toUpperCase() === "PM" && hours !== 12) hours += 12;
      if (match[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
      nextPostAt.setDate(nextPostAt.getDate() + 1);
      nextPostAt.setHours(hours, minutes, 0, 0);
    }
  } else {
    nextPostAt.setDate(nextPostAt.getDate() + 1);
    nextPostAt.setHours(9, 0, 0, 0);
  }

  const taskName = name || `${variantLabel ? `Variant ${variantLabel}` : "Recurring"} Strategy`;

  const result = await sql`
    INSERT INTO x_recurring_tasks (user_id, name, variant_label, content, media_url, image_prompt, tone, posts_per_week, best_post_times, next_post_at)
    VALUES (
      ${userId},
      ${taskName},
      ${variantLabel || null},
      ${content || null},
      ${mediaUrl || null},
      ${imagePrompt || null},
      ${tone || null},
      ${postsPerWeek || 3},
      ${JSON.stringify(bestPostTimes || [])}::jsonb,
      ${nextPostAt.toISOString()}
    )
    RETURNING *
  `;

  return NextResponse.json({ task: result[0] });
}

// DELETE: Remove a recurring task
export async function DELETE(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await ensureRecurringTasksTable();

  await sql`
    DELETE FROM x_recurring_tasks WHERE id = ${parseInt(id)} AND user_id = ${users[0].id}
  `;

  return NextResponse.json({ success: true });
}
