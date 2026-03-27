import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { exec } from "child_process";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export const dynamic = "force-dynamic";

interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  state: {
    lastStatus?: string;
    lastRunAtMs?: number;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
}

function detectProject(name: string): string {
  if (name.includes("gpulaw")) return "GPULaw";
  if (name.includes("medchat")) return "MedChat";
  if (name.includes("sienovo")) return "Sienovo";
  if (
    name.includes("medtravel") ||
    name.includes("dental") ||
    name.includes("implant")
  )
    return "MedTravel";
  if (name.includes("iris") || name.includes("limo")) return "Iris Limo";
  if (
    name.includes("usproglove") ||
    name.includes("proglove") ||
    name.includes("glove") ||
    name.includes("nitrile") ||
    name.includes("ppe")
  )
    return "US ProGlove";
  if (name.includes("dkwholesale") || name.includes("dk-wholesale"))
    return "DK Wholesale";
  if (name.includes("xpilot") || name.includes("x-post")) return "xPilot";
  if (name.includes("unincore")) return "Unincore";
  if (name.includes("ouxi")) return "OUXI";
  if (name.includes("jytech")) return "JY Tech";
  return "General";
}

function detectCategory(name: string): string {
  if (
    name.includes("lead") ||
    name.includes("prospect") ||
    name.includes("scraper")
  )
    return "lead_generation";
  if (
    name.includes("email") ||
    name.includes("brevo") ||
    name.includes("cold-email")
  )
    return "email_marketing";
  if (
    name.includes("seo") ||
    name.includes("blog") ||
    name.includes("backlink") ||
    name.includes("content-optimizer")
  )
    return "seo";
  if (
    name.includes("tweet") ||
    name.includes("x-") ||
    name.includes("linkedin") ||
    name.includes("marketing-tweet") ||
    name.includes("community")
  )
    return "social_media";
  if (
    name.includes("health") ||
    name.includes("monitor") ||
    name.includes("sre") ||
    name.includes("site-report")
  )
    return "monitoring";
  if (
    name.includes("standup") ||
    name.includes("sprint") ||
    name.includes("project-review")
  )
    return "project_mgmt";
  if (name.includes("product") || name.includes("analytics")) return "product";
  if (
    name.includes("sales") ||
    name.includes("followup") ||
    name.includes("hubspot")
  )
    return "sales";
  if (
    name.includes("dev") ||
    name.includes("github") ||
    name.includes("quality") ||
    name.includes("security") ||
    name.includes("dep-")
  )
    return "engineering";
  if (name.includes("ads") || name.includes("google-ads")) return "advertising";
  if (name.includes("model-scout") || name.includes("integration"))
    return "research";
  return "other";
}

function categorizeAgent(name: string): { category: string; project: string } {
  return { category: detectCategory(name), project: detectProject(name) };
}

function extractMetrics(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  const patterns: [RegExp, string][] = [
    [
      /(\d+)\s*(?:new\s+)?leads?\s+(?:found|generated|imported|contacted|scraped)/i,
      "leads",
    ],
    [/(\d+)\s*emails?\s+sent/i, "emails_sent"],
    [/(\d+)\s*(?:contacts?|emails?)\s+found/i, "contacts_found"],
    [/(\d+)\s*tweets?\s+(?:posted|sent|published)/i, "tweets"],
    [/(\d+)\s*(?:blog\s+)?posts?\s+(?:published|created)/i, "posts_published"],
    [/(\d+)\s*(?:articles?)\s+(?:published|written)/i, "articles"],
    [/(\d+)\s*PRs?\s+created/i, "prs_created"],
    [/[Rr]ecipients.*?(\d+)\s*subscribers?/i, "emails_sent"],
    [/subscribers?:\s*\*?\*?(\d+)/i, "subscribers"],
    [/CRM\s+leads?:\s*\*?\*?(\d+)/i, "crm_leads"],
    [/(\d+)%\s*(?:uptime|health)/i, "uptime_pct"],
    [/(\d+)\s*tasks?\s+completed/i, "tasks_completed"],
    [/(\d+)\s*(?:issues?|bugs?)\s+(?:found|opened|created)/i, "issues"],
    [/Campaign\s+ID.*?(\d+)/i, "campaigns"],
  ];
  for (const [pattern, key] of patterns) {
    const match = text.match(pattern);
    if (match) metrics[key] = parseFloat(match[1]);
  }
  return metrics;
}

function execAsync(command: string, timeout: number): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { timeout, encoding: "utf-8" }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      resolve(stdout);
    });
  });
}

async function readOpenClawData(): Promise<{
  jobs: CronJob[];
  summaries: Record<string, string>;
}> {
  try {
    // Run both Docker commands concurrently
    const [jobsRaw, summariesRaw] = await Promise.all([
      execAsync(
        "docker exec openclaw-gateway cat /home/node/.openclaw/cron/jobs.json",
        5000,
      ),
      execAsync(
        "docker exec openclaw-gateway node /home/node/.openclaw/extract-sessions.js",
        15000,
      ),
    ]);

    if (!jobsRaw) return { jobs: [], summaries: {} };

    const jobsData = JSON.parse(jobsRaw);
    const jobs: CronJob[] = jobsData.jobs || [];

    let summaries: Record<string, string> = {};
    if (summariesRaw) {
      try {
        summaries = JSON.parse(summariesRaw.trim());
      } catch {
        // Parse failed — continue with empty summaries
      }
    }

    return { jobs, summaries };
  } catch {
    return { jobs: [], summaries: {} };
  }
}

const STATUS_FALLBACK: Record<string, Record<string, string>> = {
  en: { ok: "OK", error: "Error", unknown: "Unknown" },
  zh: { ok: "\u6b63\u5e38", error: "\u9519\u8bef", unknown: "\u672a\u77e5" },
};

function fallbackSummary(job: CronJob, locale: string): string {
  const durationSec = Math.round((job.state.lastDurationMs || 0) / 1000);
  const statusKey = job.state.lastStatus || "unknown";
  const statusLabel =
    STATUS_FALLBACK[locale]?.[statusKey] ||
    STATUS_FALLBACK.en[statusKey] ||
    statusKey;
  if (locale === "zh") {
    return `\u72b6\u6001\uff1a${statusLabel}\u3002\u8017\u65f6\uff1a${durationSec}\u79d2\u3002`;
  }
  return `Status: ${statusLabel}. Duration: ${durationSec}s.`;
}

const PROJECT_ALIASES: Record<string, string[]> = {
  "Iris Limo": ["iris", "limo", "iris-limo"],
  GPULaw: ["gpulaw"],
  MedTravel: ["medtravel"],
  MedChat: ["medchat"],
  Sienovo: ["sienovo"],
};

function matchesUserProject(
  cronProject: string,
  userProjectNames: string[],
): boolean {
  if (userProjectNames.includes(cronProject)) return true;
  for (const userProject of userProjectNames) {
    const aliases = PROJECT_ALIASES[userProject];
    if (aliases && aliases.some((a) => cronProject.toLowerCase().includes(a)))
      return true;
    if (cronProject.toLowerCase().includes(userProject.toLowerCase()))
      return true;
    if (userProject.toLowerCase().includes(cronProject.toLowerCase()))
      return true;
  }
  return false;
}

// ── Brevo data fetching (all 3 calls in parallel) ──

interface BrevoCampaign {
  id: number;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  project: string;
  sentDate?: string;
}

interface BrevoResult {
  brevoStats: {
    emailsSent: number;
    delivered: number;
    opened: number;
    clicked: number;
  };
  brevoCampaigns: BrevoCampaign[];
  brevoLists: {
    name: string;
    totalSubscribers: number;
    uniqueSubscribers: number;
  }[];
}

async function fetchBrevoData(brevoByokKey?: string): Promise<BrevoResult> {
  const apiKey = brevoByokKey || process.env.BREVO_API_KEY;
  console.log(`[reports] fetchBrevoData: byokKey=${brevoByokKey ? "yes" : "no"} envKey=${process.env.BREVO_API_KEY ? "yes" : "no"} using=${apiKey ? apiKey.substring(0, 12) + "..." : "NONE"}`);
  if (!apiKey)
    return {
      brevoStats: { emailsSent: 0, delivered: 0, opened: 0, clicked: 0 },
      brevoCampaigns: [],
      brevoLists: [],
    };

  const headers = { "api-key": apiKey, accept: "application/json" };

  try {
    // Run all 3 Brevo API calls concurrently
    const [aggRes, campRes, listsRes] = await Promise.all([
      fetch("https://api.brevo.com/v3/smtp/statistics/aggregatedReport", {
        headers,
      }),
      fetch("https://api.brevo.com/v3/emailCampaigns?limit=50&sort=desc", {
        headers,
      }),
      fetch("https://api.brevo.com/v3/contacts/lists?limit=50", { headers }),
    ]);

    let brevoStats = { emailsSent: 0, delivered: 0, opened: 0, clicked: 0 };
    if (aggRes.ok) {
      const data = await aggRes.json();
      brevoStats = {
        emailsSent: data.requests || 0,
        delivered: data.delivered || 0,
        opened: data.uniqueOpens || 0,
        clicked: data.uniqueClicks || 0,
      };
    }

    let brevoCampaigns: BrevoCampaign[] = [];
    if (campRes.ok) {
      const campData = await campRes.json();
      brevoCampaigns = (campData.campaigns || []).map(
        (c: Record<string, unknown>) => {
          const statsObj = c.statistics as Record<string, unknown> | undefined;
          const globalStats =
            (statsObj?.globalStats as Record<string, number>) || {};
          const campStats =
            (statsObj?.campaignStats as Record<string, number>[]) || [];
          const aggregated = campStats.reduce(
            (acc, cs) => ({
              sent: acc.sent + (cs.sent || 0),
              delivered: acc.delivered + (cs.delivered || 0),
              uniqueViews: acc.uniqueViews + (cs.uniqueViews || 0),
              uniqueClicks: acc.uniqueClicks + (cs.uniqueClicks || 0),
            }),
            { sent: 0, delivered: 0, uniqueViews: 0, uniqueClicks: 0 },
          );
          const sent = globalStats.sent || aggregated.sent;
          const delivered = globalStats.delivered || aggregated.delivered;
          const opened =
            globalStats.uniqueOpens ||
            globalStats.uniqueViews ||
            aggregated.uniqueViews;
          const clicked = globalStats.uniqueClicks || aggregated.uniqueClicks;
          const campName = (c.name as string) || (c.subject as string) || "";
          return {
            id: c.id as number,
            name: campName,
            status: (c.status as string) || "unknown",
            sent,
            delivered,
            opened,
            clicked,
            project: detectProject(campName.toLowerCase().replace(/\s+/g, "-")),
            sentDate: (c.sentDate as string) || (c.scheduledAt as string) || "",
          };
        },
      );
    }

    let brevoLists: {
      name: string;
      totalSubscribers: number;
      uniqueSubscribers: number;
    }[] = [];
    if (listsRes.ok) {
      const listsData = await listsRes.json();
      brevoLists = listsData.lists || [];
    }

    return { brevoStats, brevoCampaigns, brevoLists };
  } catch {
    return {
      brevoStats: { emailsSent: 0, delivered: 0, opened: 0, clicked: 0 },
      brevoCampaigns: [],
      brevoLists: [],
    };
  }
}

// ── GA4 data fetching (all properties in parallel, totals+daily combined) ──

interface GaResult {
  gaStats: { totalUsers: number; sessions: number; pageViews: number };
  gaProjects: {
    project: string;
    status: "ok" | "no_data" | "error";
    error?: string;
    data: {
      date: string;
      users: number;
      sessions: number;
      pageViews: number;
    }[];
  }[];
}

async function fetchGaData(
  propertyProjectMap: Record<string, string>,
): Promise<GaResult> {
  const gaPropertyIds = Object.keys(propertyProjectMap);
  if (!process.env.GA_SERVICE_ACCOUNT_KEY || gaPropertyIds.length === 0) {
    return {
      gaStats: { totalUsers: 0, sessions: 0, pageViews: 0 },
      gaProjects: [],
    };
  }

  try {
    const credentials = JSON.parse(process.env.GA_SERVICE_ACCOUNT_KEY);
    const analyticsClient = new BetaAnalyticsDataClient({ credentials });

    // Run all properties concurrently, each with totals + daily in parallel
    const results = await Promise.all(
      gaPropertyIds.map(async (propertyId) => {
        const projectName = propertyProjectMap[propertyId];
        try {
          const [totalsResponse, dailyResponse] = await Promise.all([
            analyticsClient.runReport({
              property: `properties/${propertyId}`,
              dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
              metrics: [
                { name: "totalUsers" },
                { name: "sessions" },
                { name: "screenPageViews" },
              ],
            }),
            analyticsClient.runReport({
              property: `properties/${propertyId}`,
              dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
              dimensions: [{ name: "date" }],
              metrics: [
                { name: "totalUsers" },
                { name: "sessions" },
                { name: "screenPageViews" },
              ],
              orderBys: [
                {
                  dimension: {
                    dimensionName: "date",
                    orderType: "ALPHANUMERIC",
                  },
                },
              ],
            }),
          ]);

          const [response] = totalsResponse;
          let totalUsers = 0,
            sessions = 0,
            pageViews = 0;
          if (response.rows?.[0]?.metricValues) {
            const vals = response.rows[0].metricValues;
            totalUsers = Number(vals[0]?.value || 0);
            sessions = Number(vals[1]?.value || 0);
            pageViews = Number(vals[2]?.value || 0);
          }

          const [dailyRes] = dailyResponse;
          const dailyData: {
            date: string;
            users: number;
            sessions: number;
            pageViews: number;
          }[] = [];
          for (const row of dailyRes.rows || []) {
            const dateStr = row.dimensionValues?.[0]?.value || "";
            const formatted =
              dateStr.length === 8
                ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
                : dateStr;
            dailyData.push({
              date: formatted,
              users: Number(row.metricValues?.[0]?.value || 0),
              sessions: Number(row.metricValues?.[1]?.value || 0),
              pageViews: Number(row.metricValues?.[2]?.value || 0),
            });
          }

          const hasData =
            dailyData.length > 0 ||
            totalUsers > 0 ||
            sessions > 0 ||
            pageViews > 0;
          return {
            projectName,
            totalUsers,
            sessions,
            pageViews,
            dailyData,
            status: hasData ? ("ok" as const) : ("no_data" as const),
          };
        } catch (err) {
          console.error(
            `GA4 error for property ${propertyId} (${projectName}):`,
            err,
          );
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          return {
            projectName,
            totalUsers: 0,
            sessions: 0,
            pageViews: 0,
            dailyData: [],
            status: "error" as const,
            error: errMsg,
          };
        }
      }),
    );

    const gaStats = { totalUsers: 0, sessions: 0, pageViews: 0 };
    const gaProjects: GaResult["gaProjects"] = [];
    for (const r of results) {
      gaStats.totalUsers += r.totalUsers;
      gaStats.sessions += r.sessions;
      gaStats.pageViews += r.pageViews;
      gaProjects.push({
        project: r.projectName,
        status: r.status,
        error: r.error,
        data: r.dailyData,
      });
    }

    return { gaStats, gaProjects };
  } catch {
    return {
      gaStats: { totalUsers: 0, sessions: 0, pageViews: 0 },
      gaProjects: [],
    };
  }
}

// ── Token usage fetching ──

interface TokenSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

interface TokenResult {
  tokenUsage: {
    date: string;
    project: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }[];
  tokenSummary: TokenSummary;
  personalTokenSummary: TokenSummary;
}

interface TaskStatusCounts {
  pending: number;
  processing: number;
  completed: number;
  total: number;
}

interface TaskStatusByProject extends TaskStatusCounts {
  project: string;
}

interface KpisByProject {
  project: string;
  leadsGenerated: number;
  contentPublished: number;
}

interface BrevoContactsByProject {
  project: string;
  contacts: number;
}

async function fetchTaskStatusCounts(
  sql: ReturnType<typeof getDb>,
  projectIds: number[],
  isAdmin: boolean,
): Promise<TaskStatusCounts> {
  try {
    if (!isAdmin && projectIds.length === 0) {
      return { pending: 0, processing: 0, completed: 0, total: 0 };
    }
    const rows = isAdmin
      ? await sql`
          SELECT
            COUNT(*) FILTER (WHERE task_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE task_status IN ('processing', 'in_progress'))::int AS processing,
            COUNT(*) FILTER (WHERE task_status = 'completed')::int AS completed
          FROM (
            SELECT LOWER(COALESCE(task->>'status', '')) AS task_status
            FROM agent_assignments aa
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(aa.config->'tasks') = 'array' THEN aa.config->'tasks'
                ELSE '[]'::jsonb
              END
            ) AS task
            WHERE aa.status = 'active'
          ) task_rows`
      : await sql`
          SELECT
            COUNT(*) FILTER (WHERE task_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE task_status IN ('processing', 'in_progress'))::int AS processing,
            COUNT(*) FILTER (WHERE task_status = 'completed')::int AS completed
          FROM (
            SELECT LOWER(COALESCE(task->>'status', '')) AS task_status
            FROM agent_assignments aa
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(aa.config->'tasks') = 'array' THEN aa.config->'tasks'
                ELSE '[]'::jsonb
              END
            ) AS task
            WHERE aa.status = 'active'
              AND aa.project_id = ANY(${projectIds})
          ) task_rows`;
    const pending = (rows[0]?.pending as number) || 0;
    const processing = (rows[0]?.processing as number) || 0;
    const completed = (rows[0]?.completed as number) || 0;
    return {
      pending,
      processing,
      completed,
      total: pending + processing + completed,
    };
  } catch {
    return { pending: 0, processing: 0, completed: 0, total: 0 };
  }
}

async function fetchTaskStatusByProject(
  sql: ReturnType<typeof getDb>,
  projectIds: number[],
  isAdmin: boolean,
): Promise<TaskStatusByProject[]> {
  try {
    if (!isAdmin && projectIds.length === 0) return [];
    const rows = isAdmin
      ? await sql`
          SELECT
            p.name AS project,
            COUNT(*) FILTER (WHERE task_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE task_status IN ('processing', 'in_progress'))::int AS processing,
            COUNT(*) FILTER (WHERE task_status = 'completed')::int AS completed
          FROM (
            SELECT aa.project_id, LOWER(COALESCE(task->>'status', '')) AS task_status
            FROM agent_assignments aa
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(aa.config->'tasks') = 'array' THEN aa.config->'tasks'
                ELSE '[]'::jsonb
              END
            ) AS task
            WHERE aa.status = 'active'
          ) task_rows
          JOIN projects p ON p.id = task_rows.project_id
          GROUP BY p.name
          ORDER BY p.name`
      : await sql`
          SELECT
            p.name AS project,
            COUNT(*) FILTER (WHERE task_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE task_status IN ('processing', 'in_progress'))::int AS processing,
            COUNT(*) FILTER (WHERE task_status = 'completed')::int AS completed
          FROM (
            SELECT aa.project_id, LOWER(COALESCE(task->>'status', '')) AS task_status
            FROM agent_assignments aa
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(aa.config->'tasks') = 'array' THEN aa.config->'tasks'
                ELSE '[]'::jsonb
              END
            ) AS task
            WHERE aa.status = 'active'
              AND aa.project_id = ANY(${projectIds})
          ) task_rows
          JOIN projects p ON p.id = task_rows.project_id
          GROUP BY p.name
          ORDER BY p.name`;
    return rows.map((r) => {
      const pending = (r.pending as number) || 0;
      const processing = (r.processing as number) || 0;
      const completed = (r.completed as number) || 0;
      return {
        project: (r.project as string) || "General",
        pending,
        processing,
        completed,
        total: pending + processing + completed,
      };
    });
  } catch {
    return [];
  }
}

async function fetchDbKpisByProject(
  sql: ReturnType<typeof getDb>,
  projectIds: number[],
  isAdmin: boolean,
): Promise<KpisByProject[]> {
  try {
    if (!isAdmin && projectIds.length === 0) return [];
    const leadRows = isAdmin
      ? await sql`
          SELECT
            p.name AS project,
            COUNT(*)::int AS leads_generated
          FROM contacts c
          JOIN projects p ON p.id = c.project_id
          WHERE c.created_at >= NOW() - INTERVAL '30 days'
            AND c.source IN ('apollo', 'hunter', 'snov', 'apify', 'import')
          GROUP BY p.name
          ORDER BY p.name`
      : await sql`
          SELECT
            p.name AS project,
            COUNT(*)::int AS leads_generated
          FROM contacts c
          JOIN projects p ON p.id = c.project_id
          WHERE c.created_at >= NOW() - INTERVAL '30 days'
            AND c.project_id = ANY(${projectIds})
            AND c.source IN ('apollo', 'hunter', 'snov', 'apify', 'import')
          GROUP BY p.name
          ORDER BY p.name`;

    const contentRows = isAdmin
      ? await sql`
          SELECT
            p.name AS project,
            SUM(
              CASE WHEN COALESCE(ar.metrics->>'articles', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'articles')::numeric ELSE 0 END +
              CASE WHEN COALESCE(ar.metrics->>'posts_published', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'posts_published')::numeric ELSE 0 END +
              CASE WHEN COALESCE(ar.metrics->>'content', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'content')::numeric ELSE 0 END +
              CASE WHEN COALESCE(ar.metrics->>'prs_created', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'prs_created')::numeric ELSE 0 END +
              CASE WHEN LOWER(COALESCE(ar.task_name, '')) LIKE '%blog%' OR LOWER(COALESCE(ar.task_name, '')) LIKE '%content%' OR COALESCE(ar.task_name, '') LIKE '%博客%' OR COALESCE(ar.task_name, '') LIKE '%内容%' THEN 1 ELSE 0 END
            )::int AS content_published
          FROM agent_reports ar
          JOIN projects p ON p.id = ar.project_id
          WHERE ar.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY p.name
          ORDER BY p.name`
      : await sql`
          SELECT
            p.name AS project,
            SUM(
              CASE WHEN COALESCE(ar.metrics->>'articles', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'articles')::numeric ELSE 0 END +
              CASE WHEN COALESCE(ar.metrics->>'posts_published', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'posts_published')::numeric ELSE 0 END +
              CASE WHEN COALESCE(ar.metrics->>'content', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'content')::numeric ELSE 0 END +
              CASE WHEN COALESCE(ar.metrics->>'prs_created', '') ~ '^-?\d+(\.\d+)?$' THEN (ar.metrics->>'prs_created')::numeric ELSE 0 END +
              CASE WHEN LOWER(COALESCE(ar.task_name, '')) LIKE '%blog%' OR LOWER(COALESCE(ar.task_name, '')) LIKE '%content%' OR COALESCE(ar.task_name, '') LIKE '%博客%' OR COALESCE(ar.task_name, '') LIKE '%内容%' THEN 1 ELSE 0 END
            )::int AS content_published
          FROM agent_reports ar
          JOIN projects p ON p.id = ar.project_id
          WHERE ar.created_at >= NOW() - INTERVAL '30 days'
            AND ar.project_id = ANY(${projectIds})
          GROUP BY p.name
          ORDER BY p.name`;

    const map: Record<string, KpisByProject> = {};
    for (const r of leadRows) {
      const project = (r.project as string) || "General";
      if (!map[project]) map[project] = { project, leadsGenerated: 0, contentPublished: 0 };
      map[project].leadsGenerated += (r.leads_generated as number) || 0;
    }
    for (const r of contentRows) {
      const project = (r.project as string) || "General";
      if (!map[project]) map[project] = { project, leadsGenerated: 0, contentPublished: 0 };
      map[project].contentPublished += (r.content_published as number) || 0;
    }
    return Object.values(map).sort((a, b) => a.project.localeCompare(b.project));
  } catch {
    return [];
  }
}

interface ContactAnalytics {
  total: number;
  enriched: number;
  byIndustry: { label: string; count: number }[];
  byCompanySize: { label: string; count: number }[];
  topCompanies: { label: string; count: number }[];
  publicVsPrivate: { public: number; private: number; unknown: number };
  bySource: { label: string; count: number }[];
}

async function fetchContactAnalytics(
  sql: ReturnType<typeof getDb>,
  projectIds: number[],
  isAdmin: boolean,
  orgUserIds?: number[],
): Promise<ContactAnalytics> {
  const empty: ContactAnalytics = {
    total: 0, enriched: 0,
    byIndustry: [], byCompanySize: [], topCompanies: [],
    publicVsPrivate: { public: 0, private: 0, unknown: 0 },
    bySource: [],
  };
  try {
    // Include contacts from org members + user's projects
    const contactFilter = isAdmin
      ? sql``
      : orgUserIds && orgUserIds.length > 0
        ? sql`WHERE (c.project_id = ANY(${projectIds}) OR c.user_id = ANY(${orgUserIds}))`
        : sql`WHERE c.project_id = ANY(${projectIds})`;
    const whereFilter = isAdmin
      ? sql``
      : orgUserIds && orgUserIds.length > 0
        ? sql`AND (project_id = ANY(${projectIds}) OR user_id = ANY(${orgUserIds}))`
        : sql`AND project_id = ANY(${projectIds})`;

    const [totalRow, enrichedRow, industryRows, sizeRows, companyRows, publicRows, sourceRows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS cnt FROM contacts c ${contactFilter}`,
      sql`SELECT COUNT(*)::int AS cnt FROM contacts c WHERE (industry IS NOT NULL AND industry != '') ${whereFilter}`,
      sql`SELECT industry AS label, COUNT(*)::int AS count FROM contacts WHERE industry IS NOT NULL AND industry != '' ${whereFilter} GROUP BY industry ORDER BY count DESC LIMIT 10`,
      sql`SELECT company_size AS label, COUNT(*)::int AS count FROM contacts WHERE company_size IS NOT NULL AND company_size != '' ${whereFilter} GROUP BY company_size ORDER BY count DESC`,
      sql`SELECT company AS label, COUNT(*)::int AS count FROM contacts WHERE company IS NOT NULL AND company != '' ${whereFilter} GROUP BY company ORDER BY count DESC LIMIT 15`,
      sql`SELECT
          SUM(CASE WHEN is_public = true THEN 1 ELSE 0 END)::int AS public,
          SUM(CASE WHEN is_public = false THEN 1 ELSE 0 END)::int AS private,
          SUM(CASE WHEN is_public IS NULL THEN 1 ELSE 0 END)::int AS unknown
        FROM contacts WHERE 1=1 ${whereFilter}`,
      sql`SELECT source AS label, COUNT(*)::int AS count FROM contacts WHERE source IS NOT NULL ${whereFilter} GROUP BY source ORDER BY count DESC`,
    ]);

    return {
      total: (totalRow[0]?.cnt as number) || 0,
      enriched: (enrichedRow[0]?.cnt as number) || 0,
      byIndustry: industryRows.map(r => ({ label: r.label as string, count: r.count as number })),
      byCompanySize: sizeRows.map(r => ({ label: r.label as string, count: r.count as number })),
      topCompanies: companyRows.map(r => ({ label: r.label as string, count: r.count as number })),
      publicVsPrivate: {
        public: (publicRows[0]?.public as number) || 0,
        private: (publicRows[0]?.private as number) || 0,
        unknown: (publicRows[0]?.unknown as number) || 0,
      },
      bySource: sourceRows.map(r => ({ label: r.label as string, count: r.count as number })),
    };
  } catch (err) {
    console.error("Contact analytics error:", err);
    return empty;
  }
}

async function fetchTokenUsage(
  sql: ReturnType<typeof getDb>,
  userId: number,
  projectIds: number[],
  isAdmin: boolean,
  isEnterprise: boolean,
): Promise<TokenResult> {
  const emptyResult: TokenResult = {
    tokenUsage: [],
    tokenSummary: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
    personalTokenSummary: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
  };
  try {
    if (projectIds.length === 0 && !isAdmin && !isEnterprise) {
      return emptyResult;
    }

    const rows =
      isAdmin || isEnterprise
        ? await sql`
          SELECT DATE(tu.created_at) as date, COALESCE(p.name, 'General') as project,
            SUM(tu.prompt_tokens)::int as prompt_tokens,
            SUM(tu.completion_tokens)::int as completion_tokens,
            SUM(tu.total_tokens)::int as total_tokens
          FROM token_usage tu
          LEFT JOIN projects p ON tu.project_id = p.id
          WHERE tu.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(tu.created_at), COALESCE(p.name, 'General')
          ORDER BY date`
        : await sql`
          SELECT DATE(tu.created_at) as date, COALESCE(p.name, 'General') as project,
            SUM(tu.prompt_tokens)::int as prompt_tokens,
            SUM(tu.completion_tokens)::int as completion_tokens,
            SUM(tu.total_tokens)::int as total_tokens
          FROM token_usage tu
          LEFT JOIN projects p ON tu.project_id = p.id
          WHERE (tu.project_id = ANY(${projectIds}) OR tu.user_id = ${userId})
            AND tu.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(tu.created_at), COALESCE(p.name, 'General')
          ORDER BY date`;

    const tokenUsage = rows.map((r) => ({
      date: (r.date as Date).toISOString().slice(0, 10),
      project: r.project as string,
      prompt_tokens: r.prompt_tokens as number,
      completion_tokens: r.completion_tokens as number,
      total_tokens: r.total_tokens as number,
    }));

    const tokenSummary: TokenSummary = { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
    for (const r of rows) {
      tokenSummary.totalTokens += r.total_tokens as number;
      tokenSummary.promptTokens += r.prompt_tokens as number;
      tokenSummary.completionTokens += r.completion_tokens as number;
    }

    // Personal usage (current user only)
    const personalRows = await sql`
      SELECT COALESCE(SUM(prompt_tokens), 0)::int as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0)::int as completion_tokens,
        COALESCE(SUM(total_tokens), 0)::int as total_tokens
      FROM token_usage WHERE user_id = ${userId}`;
    const personalTokenSummary: TokenSummary = {
      totalTokens: personalRows[0].total_tokens as number,
      promptTokens: personalRows[0].prompt_tokens as number,
      completionTokens: personalRows[0].completion_tokens as number,
    };

    return { tokenUsage, tokenSummary, personalTokenSummary };
  } catch {
    return emptyResult;
  }
}

// ── DB agent reports fetching ──

async function fetchDbAgentReports(
  sql: ReturnType<typeof getDb>,
): Promise<
  Record<
    string,
    { summary: string; metrics: Record<string, unknown>; project: string }
  >
> {
  try {
    const dbReports = await sql`
      SELECT ar.task_name, ar.summary, ar.metrics, p.name as project_name
      FROM agent_reports ar
      JOIN projects p ON ar.project_id = p.id
      ORDER BY ar.created_at DESC
    `;
    const reportByTask: Record<
      string,
      { summary: string; metrics: Record<string, unknown>; project: string }
    > = {};
    for (const r of dbReports) {
      const taskName = r.task_name as string;
      if (!reportByTask[taskName]) {
        reportByTask[taskName] = {
          summary: r.summary as string,
          metrics: (r.metrics as Record<string, unknown>) || {},
          project: r.project_name as string,
        };
      }
    }
    return reportByTask;
  } catch {
    return {};
  }
}

// ── Main handler ──

export async function GET(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") || "en";
  const email = session.user.email as string;

  const sql = getDb();
  let users =
    await sql`SELECT id, role, plan FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    users =
      await sql`INSERT INTO users (email, name, auth0_id) VALUES (${email}, ${(session.user.name as string) || ""}, ${session.user.sub as string}) RETURNING id, role, plan`;
  }
  const userId = users[0].id;
  const isAdmin = users[0].role === "admin";
  const userPlan = await resolveUserPlan(
    sql,
    userId,
    (users[0].plan as string) || "starter",
    email,
  );
  const isEnterprise = userPlan === "enterprise";

  const emailDomain = email.split("@")[1] || "";
  const userProjects = isAdmin
    ? await sql`SELECT id, name, ga_property_id FROM projects`
    : await sql`SELECT DISTINCT ON (name) id, name, ga_property_id FROM projects WHERE user_id = ${userId} OR id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (domain IS NOT NULL AND domain != '' AND domain = ${emailDomain}) OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}) ORDER BY name`;
  const userProjectNames = userProjects.map((p) => p.name as string);
  const projectIds = userProjects.map((p) => p.id as number);

  // Get all org member user IDs for shared data visibility
  const orgMemberRows = await sql`
    SELECT DISTINCT om2.user_id FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = ${userId}
  `;
  const orgUserIds = orgMemberRows.map((r) => r.user_id as number);
  if (!orgUserIds.includes(userId as number)) orgUserIds.push(userId as number);

  // Build GA property → project mapping
  const propertyProjectMap: Record<string, string> = {};
  for (const p of userProjects) {
    const pid = p.ga_property_id as string;
    if (pid && !propertyProjectMap[pid]) {
      propertyProjectMap[pid] = p.name as string;
    }
  }

  // Load user/org Brevo BYOK key
  let brevoByokKey: string | undefined;
  try {
    const brevoRows = await sql`
      SELECT api_key FROM (
        SELECT api_key, 0 as priority FROM user_api_keys WHERE service = 'brevo' AND user_id = ${userId}
        UNION ALL
        SELECT ok.api_key, 1 as priority FROM org_api_keys ok
          WHERE ok.service = 'brevo' AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      ) combined ORDER BY priority LIMIT 1
    `;
    if (brevoRows.length > 0) {
      const { decrypt } = await import("@/lib/crypto");
      try {
        const decrypted = decrypt(brevoRows[0].api_key as string);
        console.log(`[reports] Brevo BYOK decrypt: prefix=${decrypted.substring(0, 15)}... valid=${decrypted.startsWith("xkeysib-")}`);
        if (decrypted.startsWith("xkeysib-") || decrypted.length > 30) {
          brevoByokKey = decrypted;
        }
      } catch (e) {
        console.warn(`[reports] Brevo BYOK decrypt failed:`, e instanceof Error ? e.message : e);
      }
    } else {
      console.log("[reports] No Brevo BYOK key found in user_api_keys or org_api_keys");
    }
  } catch { /* ignore */ }

  // ── Run ALL data sources concurrently ──
  const [
    openClawData,
    brevoData,
    gaData,
    tokenData,
    dbReportsByTask,
    taskStatusCounts,
    taskStatusByProject,
    dbKpisByProject,
    contactAnalytics,
  ] = await Promise.all([
    readOpenClawData(),
    userPlan === "starter" && !brevoByokKey
      ? Promise.resolve({ brevoStats: { emailsSent: 0, delivered: 0, opened: 0, clicked: 0 }, brevoCampaigns: [], brevoLists: [] } as BrevoResult)
      : fetchBrevoData(brevoByokKey),
    fetchGaData(propertyProjectMap),
    fetchTokenUsage(sql, userId as number, projectIds, isAdmin, isEnterprise),
    fetchDbAgentReports(sql),
    fetchTaskStatusCounts(sql, projectIds, isAdmin),
    fetchTaskStatusByProject(sql, projectIds, isAdmin),
    fetchDbKpisByProject(sql, projectIds, isAdmin),
    fetchContactAnalytics(sql, projectIds, isAdmin, orgUserIds),
  ]);

  const { jobs, summaries } = openClawData;
  let { brevoStats, brevoCampaigns } = brevoData;
  const { brevoLists } = brevoData;
  const { gaStats, gaProjects } = gaData;
  const { tokenUsage, tokenSummary, personalTokenSummary } = tokenData;

  // Local email stats will be applied after campaign filtering (see below)

  // Build report for each job (only jobs that have run)
  const allReports = jobs
    .filter((j) => j.state?.lastRunAtMs)
    .sort((a, b) => (b.state.lastRunAtMs || 0) - (a.state.lastRunAtMs || 0))
    .map((job) => {
      const summary = summaries[job.name] || "";
      const metrics = extractMetrics(summary);
      const { category, project } = categorizeAgent(job.name);
      const durationSec = Math.round((job.state.lastDurationMs || 0) / 1000);

      return {
        id: job.id,
        agent: job.name,
        period: category,
        summary: summary || fallbackSummary(job, locale),
        metrics: {
          ...metrics,
          duration_sec: durationSec,
          ...(job.state.consecutiveErrors
            ? { errors: job.state.consecutiveErrors }
            : {}),
        },
        status:
          job.state.lastStatus === "ok"
            ? "active"
            : job.state.lastStatus === "error"
              ? "paused"
              : "completed",
        project,
        last_run: job.state.lastRunAtMs
          ? new Date(job.state.lastRunAtMs).toISOString()
          : "",
      };
    });

  const reports = isAdmin
    ? allReports
    : allReports.filter(
        (r) =>
          r.project !== "General" &&
          matchesUserProject(r.project, userProjectNames),
      );

  const brevoContactsByProjectMap: Record<string, number> = {};
  for (const list of brevoLists) {
    const count = list.uniqueSubscribers || list.totalSubscribers || 0;
    if (!count) continue;
    const detectedProject = detectProject(
      list.name.toLowerCase().replace(/\s+/g, "-"),
    );
    const project = detectedProject === "General" ? "Unknown" : detectedProject;
    if (!isAdmin && (project === "Unknown" || !matchesUserProject(project, userProjectNames))) {
      continue;
    }
    brevoContactsByProjectMap[project] =
      (brevoContactsByProjectMap[project] || 0) + count;
  }
  const brevoContactsByProject: BrevoContactsByProject[] = Object.entries(
    brevoContactsByProjectMap,
  )
    .map(([project, contacts]) => ({ project, contacts }))
    .sort((a, b) => b.contacts - a.contacts);

  // Build server agents list from ALL configured jobs
  const allServerAgents = jobs
    .sort((a, b) => (b.state.lastRunAtMs || 0) - (a.state.lastRunAtMs || 0))
    .map((job) => {
      const summary = summaries[job.name] || "";
      const metrics = extractMetrics(summary);
      const { category, project } = categorizeAgent(job.name);
      const durationSec = Math.round((job.state.lastDurationMs || 0) / 1000);
      const hasRun = !!job.state?.lastRunAtMs;

      return {
        id: job.id,
        agent: job.name,
        description: job.description || "",
        period: category,
        summary: hasRun ? summary || fallbackSummary(job, locale) : "",
        metrics: hasRun
          ? {
              ...metrics,
              duration_sec: durationSec,
              ...(job.state.consecutiveErrors
                ? { errors: job.state.consecutiveErrors }
                : {}),
            }
          : {},
        status: !hasRun
          ? "pending"
          : job.state.lastStatus === "ok"
            ? "active"
            : job.state.lastStatus === "error"
              ? "paused"
              : "completed",
        enabled: job.enabled !== false,
        project,
        last_run: hasRun ? new Date(job.state.lastRunAtMs!).toISOString() : "",
      };
    });

  const serverAgents = isAdmin
    ? allServerAgents
    : allServerAgents.filter(
        (a) =>
          a.project !== "General" &&
          matchesUserProject(a.project, userProjectNames),
      );

  // ── Filter Brevo campaigns by user projects ──
  if (!isAdmin) {
    const filteredCampaigns = brevoCampaigns.filter(
      (c) =>
        c.project !== "General" &&
        matchesUserProject(c.project, userProjectNames),
    );
    // Only override global stats if user has matching campaigns
    // Otherwise keep the API-level stats (org-shared Brevo data)
    if (filteredCampaigns.length > 0) {
      brevoCampaigns = filteredCampaigns;
      brevoStats = filteredCampaigns.reduce(
        (acc, c) => ({
          emailsSent: acc.emailsSent + c.sent,
          delivered: acc.delivered + c.delivered,
          opened: acc.opened + c.opened,
          clicked: acc.clicked + c.clicked,
        }),
        { emailsSent: 0, delivered: 0, opened: 0, clicked: 0 },
      );
    }
    // If no matching campaigns, keep original brevoStats from API (org-shared)
  }

  // Override brevoStats with local email_logs (most accurate, per-user/org filtered)
  try {
    const localStats = await sql`
      SELECT
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered,
        COUNT(*) FILTER (WHERE status = 'opened')::int as opened,
        COUNT(*) FILTER (WHERE status IN ('clicks', 'clicked'))::int as clicked
      FROM email_logs
      WHERE user_id = ${userId}
        OR user_id IN (SELECT om2.user_id FROM organization_members om1 JOIN organization_members om2 ON om1.org_id = om2.org_id WHERE om1.user_id = ${userId})
        OR project_id IN (SELECT DISTINCT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id WHERE p.user_id = ${userId} OR pm.user_id = ${userId} OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))
    `;
    if (localStats.length > 0 && localStats[0].sent > 0) {
      brevoStats = {
        emailsSent: localStats[0].sent,
        delivered: localStats[0].delivered,
        opened: localStats[0].opened,
        clicked: localStats[0].clicked,
      };
    }
  } catch { /* email_logs table may not exist */ }

  // ── Enrich server agents with Brevo campaign data ──
  if (brevoCampaigns.length > 0) {
    const campaignsByProject: Record<
      string,
      {
        sent: number;
        delivered: number;
        opened: number;
        clicked: number;
        latestDate: string;
      }
    > = {};
    for (const c of brevoCampaigns) {
      if (c.status !== "sent") continue;
      if (!campaignsByProject[c.project]) {
        campaignsByProject[c.project] = {
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          latestDate: "",
        };
      }
      const agg = campaignsByProject[c.project];
      agg.sent += c.sent;
      agg.delivered += c.delivered;
      agg.opened += c.opened;
      agg.clicked += c.clicked;
      if (c.sentDate && c.sentDate > agg.latestDate)
        agg.latestDate = c.sentDate;
    }
    for (const agent of serverAgents) {
      const projStats = campaignsByProject[agent.project];
      if (!projStats) continue;
      if (agent.period === "email_marketing" && agent.status === "pending") {
        agent.status = "active";
        agent.metrics = {
          emails_sent: projStats.sent,
          delivered: projStats.delivered,
          opened: projStats.opened,
          clicked: projStats.clicked,
        };
        const openRate =
          projStats.delivered > 0
            ? ((projStats.opened / projStats.delivered) * 100).toFixed(1)
            : "0";
        const clickRate =
          projStats.delivered > 0
            ? ((projStats.clicked / projStats.delivered) * 100).toFixed(1)
            : "0";
        agent.summary =
          locale === "zh"
            ? `已发送 ${projStats.sent} 封邮件，送达 ${projStats.delivered}，打开率 ${openRate}%，点击率 ${clickRate}%`
            : `Sent ${projStats.sent} emails, ${projStats.delivered} delivered, ${openRate}% open rate, ${clickRate}% click rate`;
        if (projStats.latestDate) agent.last_run = projStats.latestDate;
      }
    }
  }

  // ── Enrich server agents with Brevo contact list data ──
  if (brevoLists.length > 0) {
    const leadsByProject: Record<string, number> = {};
    for (const list of brevoLists) {
      const count = list.uniqueSubscribers || list.totalSubscribers;
      if (!count) continue;
      const project = detectProject(
        list.name.toLowerCase().replace(/\s+/g, "-"),
      );
      leadsByProject[project] = (leadsByProject[project] || 0) + count;
    }
    for (const agent of serverAgents) {
      const leadCount = leadsByProject[agent.project];
      if (!leadCount) continue;
      if (agent.period === "lead_generation" && agent.status === "pending") {
        agent.status = "active";
        agent.metrics = { contacts_found: leadCount };
        agent.summary =
          locale === "zh"
            ? `已找到 ${leadCount} 个潜在客户联系人`
            : `Found ${leadCount} prospect contacts`;
      }
    }
  }

  // ── Enrich server agents with DB agent_reports data ──
  for (const agent of serverAgents) {
    const dbReport = dbReportsByTask[agent.agent];
    if (!dbReport) continue;
    if (
      agent.status === "pending" &&
      dbReport.summary &&
      Object.keys(dbReport.metrics).length > 0
    ) {
      agent.status = "active";
      agent.summary = dbReport.summary;
      const numericMetrics: Record<string, number> = {};
      for (const [k, v] of Object.entries(dbReport.metrics)) {
        if (typeof v === "number") numericMetrics[k] = v;
      }
      if (Object.keys(numericMetrics).length > 0) {
        agent.metrics = numericMetrics;
      }
    }
  }

  return NextResponse.json({
    plan: userPlan,
    reports,
    agents: [],
    serverAgents,
    brevoStats,
    brevoCampaigns,
    gaStats,
    gaProjects,
    tokenUsage,
    tokenSummary,
    personalTokenSummary,
    taskStatusCounts,
    taskStatusByProject,
    dbKpisByProject,
    brevoContactsByProject,
    tasksCompleted: taskStatusCounts.total,
    contactAnalytics,
  });
}
