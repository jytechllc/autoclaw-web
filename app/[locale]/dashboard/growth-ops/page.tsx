import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { auth0 } from "@/lib/auth0";
import { isValidLocale } from "@/lib/i18n";

type TrackerRow = {
  week_start: string;
  owner: string;
  focus_icp: string;
  offer_angle: string;
  geo_page_or_update: string;
  outbound_batch_sent: string;
  followup_batch_sent: string;
  social_posts_published: string;
  homepage_visits: string;
  use_case_visits: string;
  geo_page_visits: string;
  contacts_enriched: string;
  initial_emails_sent: string;
  followups_sent: string;
  replies: string;
  positive_replies: string;
  calls_booked: string;
  paid_setups_closed: string;
  top_signal: string;
  top_problem: string;
  next_change: string;
};

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

function toNumber(value: string) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function yesNoBadge(value: string) {
  const isYes = value.toLowerCase() === "yes";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        isYes ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
      }`}
    >
      {isYes ? "Yes" : "No"}
    </span>
  );
}

function metricCard(label: string, value: number | string, hint?: string) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
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

  const tracker = parseCsv(readFileSync(TRACKER_PATH, "utf8")).sort((a, b) =>
    a.week_start < b.week_start ? 1 : -1
  );
  const current = tracker[0];
  const previous = tracker[1];

  const labels =
    locale === "zh" || locale === "zh-TW"
      ? {
          title: "Growth Ops",
          subtitle: "统一查看 outbound、SEO、GEO 和 social 的每周执行、结果和下一步改进。",
          currentWeek: "当前周",
          previousWeek: "上一周",
          focusIcp: "本周 ICP",
          offerAngle: "Offer 角度",
          contactsEnriched: "补全联系人",
          initialEmails: "首轮邮件",
          followups: "跟进邮件",
          replies: "回复数",
          positiveReplies: "正向回复",
          callsBooked: "预约数",
          closedDeals: "已成交 Setup",
          homepageVisits: "首页访问",
          useCaseVisits: "Use Case 访问",
          geoPageVisits: "GEO 页面访问",
          channelActions: "本周动作",
          signal: "最强信号",
          problem: "主要问题",
          nextChange: "下轮改动",
          tracker: "历史追踪",
          geoUpdate: "GEO 页面 / 更新",
          outboundBatch: "Outbound Batch",
          followupBatch: "Follow-up Batch",
          socialPosts: "Social Posts",
        }
      : {
          title: "Growth Ops",
          subtitle: "Track outbound, SEO, GEO, and social execution in one weekly operating view.",
          currentWeek: "Current Week",
          previousWeek: "Previous Week",
          focusIcp: "Focus ICP",
          offerAngle: "Offer Angle",
          contactsEnriched: "Contacts Enriched",
          initialEmails: "Initial Emails",
          followups: "Follow-Ups",
          replies: "Replies",
          positiveReplies: "Positive Replies",
          callsBooked: "Calls Booked",
          closedDeals: "Paid Setups Closed",
          homepageVisits: "Homepage Visits",
          useCaseVisits: "Use-Case Visits",
          geoPageVisits: "GEO Page Visits",
          channelActions: "Weekly Actions",
          signal: "Top Signal",
          problem: "Top Problem",
          nextChange: "Next Change",
          tracker: "Tracker History",
          geoUpdate: "GEO Page / Update",
          outboundBatch: "Outbound Batch",
          followupBatch: "Follow-Up Batch",
          socialPosts: "Social Posts",
        };

  return (
    <DashboardShell user={{ email: session.user.email }} fullHeight={false}>
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{labels.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">{labels.subtitle}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-white p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-500">{labels.currentWeek}</p>
              <h2 className="mt-2 text-xl font-semibold text-gray-900">{current.week_start}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {labels.focusIcp}: <span className="font-medium text-gray-900">{current.focus_icp}</span>
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {labels.offerAngle}: <span className="font-medium text-gray-900">{current.offer_angle}</span>
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {labels.geoUpdate}: <span className="font-medium text-gray-900">{current.geo_page_or_update}</span>
              </p>
            </div>
            {previous ? (
              <div className="rounded-xl border border-white bg-white/80 px-4 py-3 text-sm text-gray-600">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{labels.previousWeek}</p>
                <p className="mt-1 font-medium text-gray-900">{previous.week_start}</p>
                <p className="mt-1">{previous.focus_icp}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricCard(labels.contactsEnriched, toNumber(current.contacts_enriched))}
          {metricCard(labels.initialEmails, toNumber(current.initial_emails_sent))}
          {metricCard(labels.followups, toNumber(current.followups_sent))}
          {metricCard(labels.replies, toNumber(current.replies))}
          {metricCard(labels.positiveReplies, toNumber(current.positive_replies))}
          {metricCard(labels.callsBooked, toNumber(current.calls_booked))}
          {metricCard(labels.closedDeals, toNumber(current.paid_setups_closed))}
          {metricCard(labels.socialPosts, toNumber(current.social_posts_published))}
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">{labels.channelActions}</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-700">
              <div className="flex items-center justify-between gap-3">
                <span>{labels.outboundBatch}</span>
                {yesNoBadge(current.outbound_batch_sent)}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{labels.followupBatch}</span>
                {yesNoBadge(current.followup_batch_sent)}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{labels.socialPosts}</span>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                  {toNumber(current.social_posts_published)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">Traffic</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-700">
              <div className="flex items-center justify-between gap-3">
                <span>{labels.homepageVisits}</span>
                <span className="font-medium text-gray-900">{toNumber(current.homepage_visits)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{labels.useCaseVisits}</span>
                <span className="font-medium text-gray-900">{toNumber(current.use_case_visits)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{labels.geoPageVisits}</span>
                <span className="font-medium text-gray-900">{toNumber(current.geo_page_visits)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">{labels.nextChange}</h3>
            <p className="mt-4 text-sm leading-6 text-gray-700">{current.next_change}</p>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">{labels.signal}</h3>
            <p className="mt-4 text-sm leading-6 text-gray-700">{current.top_signal}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">{labels.problem}</h3>
            <p className="mt-4 text-sm leading-6 text-gray-700">{current.top_problem}</p>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">{labels.tracker}</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2">Week</th>
                  <th className="px-3 py-2">{labels.focusIcp}</th>
                  <th className="px-3 py-2">{labels.initialEmails}</th>
                  <th className="px-3 py-2">{labels.followups}</th>
                  <th className="px-3 py-2">{labels.replies}</th>
                  <th className="px-3 py-2">{labels.callsBooked}</th>
                  <th className="px-3 py-2">{labels.closedDeals}</th>
                  <th className="px-3 py-2">{labels.nextChange}</th>
                </tr>
              </thead>
              <tbody>
                {tracker.map((row) => (
                  <tr key={row.week_start} className="border-b border-gray-100 align-top">
                    <td className="px-3 py-3 font-medium text-gray-900">{row.week_start}</td>
                    <td className="px-3 py-3 text-gray-700">{row.focus_icp}</td>
                    <td className="px-3 py-3 text-gray-700">{toNumber(row.initial_emails_sent)}</td>
                    <td className="px-3 py-3 text-gray-700">{toNumber(row.followups_sent)}</td>
                    <td className="px-3 py-3 text-gray-700">{toNumber(row.replies)}</td>
                    <td className="px-3 py-3 text-gray-700">{toNumber(row.calls_booked)}</td>
                    <td className="px-3 py-3 text-gray-700">{toNumber(row.paid_setups_closed)}</td>
                    <td className="px-3 py-3 text-gray-600">{row.next_change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
