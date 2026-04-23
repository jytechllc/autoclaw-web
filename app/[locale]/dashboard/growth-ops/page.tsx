import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import DashboardShell from "@/components/DashboardShell";
import GrowthOpsView, { type CoverageRow, type TrackerRow } from "@/components/GrowthOpsView";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { isValidLocale } from "@/lib/i18n";

const TRACKER_PATH = resolve("/Users/wlin/dev/autoclaw/autoclaw-web/docs/sales/growth-execution-tracker.csv");

function toNumber(value: string) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

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
  const weekBucketDate = new Date();
  const day = weekBucketDate.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  weekBucketDate.setUTCDate(weekBucketDate.getUTCDate() - offset);
  weekBucketDate.setUTCHours(0, 0, 0, 0);
  const currentWeekStart = weekBucketDate.toISOString().slice(0, 10);

  const projectRows = isAdmin
    ? await sql`
        SELECT p.id, p.name, p.org_id, o.name AS org_name, p.ga_property_id
        FROM projects p
        JOIN organizations o ON o.id = p.org_id
        WHERE p.org_id = ANY(${orgIds})
      `
    : await sql`
        SELECT DISTINCT p.id, p.name, p.org_id, o.name AS org_name, p.ga_property_id
        FROM projects p
        JOIN organizations o ON o.id = p.org_id
        LEFT JOIN project_members pm ON pm.project_id = p.id
        WHERE p.org_id = ANY(${orgIds})
          AND (
            p.user_id = ${userId}
            OR pm.user_id = ${userId}
            OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
          )
      `;

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

  const gaProjectRows = projectRows.filter((row) => row.ga_property_id) as Array<{
    id: number;
    name: string;
    org_id: number;
    org_name: string;
    ga_property_id: string;
  }>;

  if (process.env.GA_SERVICE_ACCOUNT_KEY && gaProjectRows.length > 0) {
    try {
      const credentials = JSON.parse(process.env.GA_SERVICE_ACCOUNT_KEY);
      const analyticsClient = new BetaAnalyticsDataClient({ credentials });
      const gaResults = await Promise.all(
        gaProjectRows.map(async (project) => {
          try {
            const [response] = await analyticsClient.runReport({
              property: `properties/${project.ga_property_id}`,
              dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
              dimensions: [{ name: "pagePath" }],
              metrics: [{ name: "screenPageViews" }],
              limit: 1000,
            });

            let homepage = 0;
            let useCases = 0;
            let geo = 0;
            for (const row of response.rows || []) {
              const path = row.dimensionValues?.[0]?.value || "";
              const views = Number(row.metricValues?.[0]?.value || 0);
              if (!views) continue;

              if (/^\/(en|zh|zh-TW|fr|ko)?$/.test(path) || /^\/(en|zh|zh-TW|fr|ko)\/?$/.test(path)) {
                homepage += views;
              }
              if (path.includes("/use-cases")) {
                useCases += views;
              }
              if (
                path.includes("/use-cases/us-b2b-outbound") ||
                path.includes("/docs") ||
                path.includes("/status") ||
                path.includes("/changelog")
              ) {
                geo += views;
              }
            }

            return {
              orgName: project.org_name,
              weekStart: currentWeekStart,
              homepage,
              useCases,
              geo,
            };
          } catch {
            return null;
          }
        })
      );

      for (const row of gaResults) {
        if (!row) continue;
        const entry = ensureRow(row.orgName, row.weekStart);
        entry.homepage_visits = String((toNumber(entry.homepage_visits) || 0) + row.homepage);
        entry.use_case_visits = String((toNumber(entry.use_case_visits) || 0) + row.useCases);
        entry.geo_page_visits = String((toNumber(entry.geo_page_visits) || 0) + row.geo);
      }
    } catch {
      // Ignore GA errors and fall back to tracker text-only values.
    }
  }

  return Array.from(metricMap.values()).sort((a, b) =>
    a.week_start === b.week_start
      ? a.scope_value.localeCompare(b.scope_value)
      : a.week_start < b.week_start
        ? 1
        : -1
  );
}

async function fetchCoverageRows(
  sql: ReturnType<typeof getDb>,
  isAdmin: boolean,
  userId: number,
  tracker: TrackerRow[],
): Promise<CoverageRow[]> {
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

  const projectRows = isAdmin
    ? await sql`
        SELECT p.id, p.org_id, o.name AS org_name, p.ga_property_id
        FROM projects p
        JOIN organizations o ON o.id = p.org_id
        WHERE p.org_id = ANY(${orgIds})
      `
    : await sql`
        SELECT DISTINCT p.id, p.org_id, o.name AS org_name, p.ga_property_id
        FROM projects p
        JOIN organizations o ON o.id = p.org_id
        LEFT JOIN project_members pm ON pm.project_id = p.id
        WHERE p.org_id = ANY(${orgIds})
          AND (
            p.user_id = ${userId}
            OR pm.user_id = ${userId}
            OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
          )
      `;

  const [contactRows, emailRows] = await Promise.all([
    sql`
      SELECT
        o.name AS org_name,
        COUNT(*)::int AS contacts_enriched_14d,
        MAX(c.created_at) AS last_contact_at
      FROM contacts c
      JOIN projects p ON p.id = c.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE p.org_id = ANY(${orgIds})
        AND c.created_at >= ${metricsSince.toISOString()}
      GROUP BY o.name
    `,
    sql`
      SELECT
        o.name AS org_name,
        COUNT(*) FILTER (WHERE COALESCE(e.subject, '') NOT ILIKE 'Re:%')::int AS initial_emails_14d,
        COUNT(*) FILTER (WHERE COALESCE(e.subject, '') ILIKE 'Re:%')::int AS followups_14d,
        MAX(e.created_at) AS last_email_at
      FROM email_logs e
      JOIN projects p ON p.id = e.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE p.org_id = ANY(${orgIds})
        AND e.created_at >= ${metricsSince.toISOString()}
      GROUP BY o.name
    `,
  ]);

  const trackerNames = new Set(
    tracker
      .filter((row) => row.scope_type === "org" && row.scope_value.trim())
      .map((row) => row.scope_value.trim().toLowerCase()),
  );

  const coverageMap = new Map<string, CoverageRow>();
  for (const org of orgRows) {
    coverageMap.set(String(org.name), {
      company: String(org.name),
      projectCount: 0,
      ga4ProjectCount: 0,
      homepageVisits30d: 0,
      contactsEnriched14d: 0,
      initialEmails14d: 0,
      followups14d: 0,
      hasTrackerNotes: trackerNames.has(String(org.name).trim().toLowerCase()),
      lastActivityAt: null,
    });
  }

  for (const row of projectRows) {
    const company = String(row.org_name);
    const entry = coverageMap.get(company);
    if (!entry) continue;
    entry.projectCount += 1;
    if (row.ga_property_id) entry.ga4ProjectCount += 1;
  }

  const setLastActivity = (entry: CoverageRow, candidate: unknown) => {
    if (!candidate) return;
    const next = new Date(String(candidate)).toISOString();
    if (!entry.lastActivityAt || next > entry.lastActivityAt) {
      entry.lastActivityAt = next;
    }
  };

  for (const row of contactRows) {
    const entry = coverageMap.get(String(row.org_name));
    if (!entry) continue;
    entry.contactsEnriched14d = Number(row.contacts_enriched_14d) || 0;
    setLastActivity(entry, row.last_contact_at);
  }

  for (const row of emailRows) {
    const entry = coverageMap.get(String(row.org_name));
    if (!entry) continue;
    entry.initialEmails14d = Number(row.initial_emails_14d) || 0;
    entry.followups14d = Number(row.followups_14d) || 0;
    setLastActivity(entry, row.last_email_at);
  }

  const gaProjectRows = projectRows.filter((row) => row.ga_property_id) as Array<{
    org_name: string;
    ga_property_id: string;
  }>;

  if (process.env.GA_SERVICE_ACCOUNT_KEY && gaProjectRows.length > 0) {
    try {
      const credentials = JSON.parse(process.env.GA_SERVICE_ACCOUNT_KEY);
      const analyticsClient = new BetaAnalyticsDataClient({ credentials });
      const gaResults = await Promise.all(
        gaProjectRows.map(async (project) => {
          try {
            const [response] = await analyticsClient.runReport({
              property: `properties/${project.ga_property_id}`,
              dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
              dimensions: [{ name: "pagePath" }],
              metrics: [{ name: "screenPageViews" }],
              limit: 1000,
            });

            let homepage = 0;
            for (const row of response.rows || []) {
              const path = row.dimensionValues?.[0]?.value || "";
              const views = Number(row.metricValues?.[0]?.value || 0);
              if (!views) continue;
              if (/^\/(en|zh|zh-TW|fr|ko)?$/.test(path) || /^\/(en|zh|zh-TW|fr|ko)\/?$/.test(path)) {
                homepage += views;
              }
            }

            return { company: project.org_name, homepage };
          } catch {
            return null;
          }
        })
      );

      for (const row of gaResults) {
        if (!row) continue;
        const entry = coverageMap.get(row.company);
        if (!entry) continue;
        entry.homepageVisits30d += row.homepage;
      }
    } catch {
      // Ignore GA coverage errors.
    }
  }

  return Array.from(coverageMap.values()).sort((a, b) => a.company.localeCompare(b.company));
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
  const coverageRows = userId ? await fetchCoverageRows(sql, isAdmin, userId, tracker) : [];

  return (
    <DashboardShell user={{ email: session.user.email }} fullHeight={false}>
      <GrowthOpsView
        locale={locale}
        tracker={tracker}
        realMetricRows={realMetricRows}
        coverageRows={coverageRows}
        isAdmin={isAdmin}
      />
    </DashboardShell>
  );
}
