import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Debug endpoint: shows why a user can/cannot see traffic data.
 * GET /api/reports/debug
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;
  const emailDomain = email.split("@")[1] || "";

  // 1. Find user
  const users = await sql`SELECT id, role, plan FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found", email });
  }
  const userId = users[0].id as number;
  const isAdmin = users[0].role === "admin";

  // 2. Resolve plan (also auto-joins domain-matched orgs)
  const userPlan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);

  // 3. Check org memberships
  const orgMemberships = await sql`
    SELECT om.org_id, om.role as member_role, o.name as org_name, o.plan as org_plan, o.domain as org_domain
    FROM organization_members om
    JOIN organizations o ON om.org_id = o.id
    WHERE om.user_id = ${userId}
  `;

  // 4. Check project_members
  const projectMemberships = await sql`
    SELECT pm.project_id, p.name as project_name
    FROM project_members pm
    JOIN projects p ON pm.project_id = p.id
    WHERE pm.user_id = ${userId}
  `;

  // 5. Find all projects user can access (same query as reports)
  const accessibleProjects = isAdmin
    ? await sql`SELECT id, name, ga_property_id, domain, org_id, user_id FROM projects`
    : await sql`
      SELECT DISTINCT ON (name) id, name, ga_property_id, domain, org_id, user_id
      FROM projects
      WHERE user_id = ${userId}
        OR id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})
        OR (domain IS NOT NULL AND domain != '' AND domain = ${emailDomain})
        OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      ORDER BY name
    `;

  // 6. Find projects with GA property IDs
  const projectsWithGa = accessibleProjects.filter((p) => p.ga_property_id);
  const projectsWithoutGa = accessibleProjects.filter((p) => !p.ga_property_id);

  // 7. All projects in system (for admin debugging)
  const allProjects = await sql`SELECT id, name, ga_property_id, domain, org_id, user_id FROM projects ORDER BY id`;

  // 8. Domain-matched projects (what Helen should see)
  const domainMatchedProjects = await sql`
    SELECT id, name, ga_property_id, domain, org_id
    FROM projects
    WHERE domain IS NOT NULL AND domain != '' AND domain = ${emailDomain}
  `;

  // 9. Org-matched projects
  const orgMatchedProjects = await sql`
    SELECT p.id, p.name, p.ga_property_id, p.org_id, o.name as org_name
    FROM projects p
    JOIN organizations o ON p.org_id = o.id
    WHERE p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
  `;

  return NextResponse.json({
    user: {
      email,
      emailDomain,
      userId,
      isAdmin,
      resolvedPlan: userPlan,
      rawPlan: users[0].plan,
    },
    orgMemberships: orgMemberships.map((o) => ({
      orgId: o.org_id,
      orgName: o.org_name,
      orgPlan: o.org_plan,
      orgDomain: o.org_domain,
      memberRole: o.member_role,
    })),
    projectMemberships: projectMemberships.map((p) => ({
      projectId: p.project_id,
      projectName: p.project_name,
    })),
    accessibleProjects: accessibleProjects.map((p) => ({
      id: p.id,
      name: p.name,
      hasGaPropertyId: !!p.ga_property_id,
      gaPropertyId: p.ga_property_id || null,
      domain: p.domain || null,
      orgId: p.org_id || null,
      ownerId: p.user_id,
    })),
    diagnosis: {
      totalAccessibleProjects: accessibleProjects.length,
      projectsWithGa: projectsWithGa.length,
      projectsWithoutGa: projectsWithoutGa.map((p) => p.name),
      domainMatchedProjects: domainMatchedProjects.length,
      orgMatchedProjects: orgMatchedProjects.length,
      issues: [
        ...(accessibleProjects.length === 0 ? ["NO_PROJECTS: User has no accessible projects. Check org membership, project domain, or project_members."] : []),
        ...(projectsWithGa.length === 0 && accessibleProjects.length > 0 ? ["NO_GA_PROPERTY: User has projects but none have ga_property_id configured. Go to Settings to add GA4 Property ID."] : []),
        ...(orgMemberships.length === 0 ? [`NO_ORG: User is not a member of any organization. Create an org with domain '${emailDomain}' or add user manually.`] : []),
        ...(domainMatchedProjects.length === 0 ? [`NO_DOMAIN_MATCH: No projects have domain = '${emailDomain}'. Set project domain in Settings.`] : []),
      ],
    },
    allProjectsInSystem: allProjects.map((p) => ({
      id: p.id,
      name: p.name,
      hasGa: !!p.ga_property_id,
      domain: p.domain || null,
      orgId: p.org_id || null,
      ownerId: p.user_id,
    })),
  });
}
