import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const sessionToken = (body.sessionToken || "").trim();
    if (!sessionToken) {
      return NextResponse.json({ error: "sessionToken required" }, { status: 400 });
    }

    const sql = getDb();
    const email = session.user.email as string;

    // Get or create user
    let users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      users = await sql`INSERT INTO users (email, auth0_id) VALUES (${email}, ${session.user.sub || ''}) RETURNING id`;
    }
    const userId = users[0].id as number;

    // Look up trial session
    const sessions = await sql`
      SELECT id, leads, claimed_by, expires_at FROM trial_lead_sessions
      WHERE session_token = ${sessionToken}
    `;
    if (sessions.length === 0) {
      return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
    }

    const trialSession = sessions[0];
    if (trialSession.claimed_by) {
      return NextResponse.json({ error: "Already claimed", claimed: 0 });
    }

    const leads = (trialSession.leads as { firstName: string; lastName: string; email: string; company: string; position: string; linkedinUrl?: string }[]) || [];
    if (leads.length === 0) {
      return NextResponse.json({ claimed: 0 });
    }

    // Get or create a default project for the user
    let projects = await sql`SELECT id FROM projects WHERE user_id = ${userId} ORDER BY created_at LIMIT 1`;
    if (projects.length === 0) {
      projects = await sql`INSERT INTO projects (user_id, name, description) VALUES (${userId}, 'My Project', 'Auto-created from trial lead search') RETURNING id`;
    }
    const projectId = projects[0].id as number;

    // Insert leads into contacts
    let claimed = 0;
    for (const lead of leads) {
      if (!lead.email) continue;
      try {
        await sql`
          INSERT INTO contacts (user_id, project_id, email, first_name, last_name, company, position, source, source_detail, linkedin_url)
          VALUES (${userId}, ${projectId}, ${lead.email}, ${lead.firstName || ''}, ${lead.lastName || ''}, ${lead.company || ''}, ${lead.position || ''}, 'apollo', 'Trial Lead Search', ${lead.linkedinUrl || null})
          ON CONFLICT (user_id, email) DO NOTHING
        `;
        claimed++;
      } catch { /* skip duplicate */ }
    }

    // Mark session as claimed
    await sql`UPDATE trial_lead_sessions SET claimed_by = ${userId} WHERE session_token = ${sessionToken}`;

    return NextResponse.json({ claimed, projectId });
  } catch (err) {
    console.error("[POST /api/trial-leads/claim]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
