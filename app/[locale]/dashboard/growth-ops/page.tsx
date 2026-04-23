import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import GrowthOpsView, { type TrackerRow } from "@/components/GrowthOpsView";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { isValidLocale } from "@/lib/i18n";

const TRACKER_PATH = resolve("/Users/wlin/dev/autoclaw/autoclaw-web/docs/sales/growth-execution-tracker.csv");

function parseCsv(text: string): TrackerRow[] {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);

    return headers.reduce((acc, header, index) => {
      acc[header as keyof TrackerRow] = values[index] || "";
      return acc;
    }, {} as TrackerRow);
  });
}

async function fetchRealMetricRows(
  sql: ReturnType<typeof getDb>,
  isAdmin: boolean,
  userId: number,
) {
  const orgRows = isAdmin
    ? await sql`SELECT id, name FROM organizations ORDER BY name`
    : await sql`
        SELECT o.id, o.name
        FROM organizations o
        JOIN organization_members om ON om.org_id = o.id
        WHERE om.user_id = ${userId}
        ORDER BY o.name
      `;

  const orgIds = orgRows.map((row) => row.id as number);
  if (orgIds.length === 0) return [];

  const metricsSince = new Date();
  metricsSince.setUTCDate(metricsSince.getUTCDate() - 14);
  metricsSince.setUTCHours(0, 0, 0, 0);

  const [contactRows, emailRows] = await Promise.all([
    sql`
      SELECT
        o.name AS scope_value,
        TO_CHAR(DATE_TRUNC('week', c.created_at), 'YYYY-MM-DD') AS week_start,
        COUNT(*)::int AS contacts_enriched
      FROM contacts c
      JOIN projects p ON p.id = c.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE p.org_id = ANY(${orgIds})
        AND c.created_at >= ${metricsSince.toISOString()}
      GROUP BY o.name, DATE_TRUNC('week', c.created_at)
      ORDER BY week_start DESC, o.name ASC
    `,
    sql`
      SELECT
        o.name AS scope_value,
        TO_CHAR(DATE_TRUNC('week', e.created_at), 'YYYY-MM-DD') AS week_start,
        COUNT(*) FILTER (WHERE COALESCE(e.subject, '') NOT ILIKE 'Re:%')::int AS initial_emails_sent,
        COUNT(*) FILTER (WHERE COALESCE(e.subject, '') ILIKE 'Re:%')::int AS followups_sent
      FROM email_logs e
      JOIN projects p ON p.id = e.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE p.org_id = ANY(${orgIds})
        AND e.created_at >= ${metricsSince.toISOString()}
      GROUP BY o.name, DATE_TRUNC('week', e.created_at)
      ORDER BY week_start DESC, o.name ASC
    `,
  ]);

  const metricMap = new Map<string, TrackerRow>();

  const ensureRow = (scopeValue: string, weekStart: string) => {
    const key = `${scopeValue}::${weekStart}`;
    if (!metricMap.has(key)) {
      metricMap.set(key, {
        week_start: weekStart,
        scope_type: "org",
        scope_value: scopeValue,
        owner: "",
        focus_icp: "",
        offer_angle: "",
        geo_page_or_update: "",
        outbound_batch_sent: "",
        followup_batch_sent: "",
        social_posts_published: "",
        homepage_visits: "",
        use_case_visits: "",
        geo_page_visits: "",
        contacts_enriched: "",
        initial_emails_sent: "",
        followups_sent: "",
        replies: "",
        positive_replies: "",
        calls_booked: "",
        paid_setups_closed: "",
        top_signal: "",
        top_problem: "",
        next_change: "",
      });
    }
    return metricMap.get(key)!;
  };

  for (const row of contactRows) {
    const entry = ensureRow(row.scope_value as string, row.week_start as string);
    entry.contacts_enriched = String((row.contacts_enriched as number) || 0);
  }

  for (const row of emailRows) {
    const entry = ensureRow(row.scope_value as string, row.week_start as string);
    const initial = (row.initial_emails_sent as number) || 0;
    const followups = (row.followups_sent as number) || 0;
    entry.initial_emails_sent = String(initial);
    entry.followups_sent = String(followups);
    entry.outbound_batch_sent = initial > 0 ? "yes" : "no";
    entry.followup_batch_sent = followups > 0 ? "yes" : "no";
  }

  return Array.from(metricMap.values()).sort((a, b) =>
    a.week_start === b.week_start
      ? a.scope_value.localeCompare(b.scope_value)
      : a.week_start < b.week_start
        ? 1
        : -1
  );
}

export default async function GrowthOpsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const session = await auth0.getSession();
  const { locale } = await params;

  if (!session?.user) {
    redirect(`/auth/login?returnTo=/${locale}/dashboard/growth-ops`);
  }

  if (!isValidLocale(locale)) {
    redirect("/en/dashboard/growth-ops");
  }

  const sql = getDb();
  const users = await sql`SELECT id, role FROM users WHERE email = ${session.user.email as string} LIMIT 1`;
  const isAdmin = users.length > 0 && users[0].role === "admin";
  const userId = (users[0]?.id as number) || 0;
  const tracker = parseCsv(readFileSync(TRACKER_PATH, "utf8"));
  const realMetricRows = userId ? await fetchRealMetricRows(sql, isAdmin, userId) : [];

  return (
    <DashboardShell user={{ email: session.user.email }} fullHeight={false}>
      <GrowthOpsView locale={locale} tracker={tracker} realMetricRows={realMetricRows} isAdmin={isAdmin} />
    </DashboardShell>
  );
}
