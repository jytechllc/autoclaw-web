"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useOrg } from "@/components/OrgContext";

export type TrackerRow = {
  week_start: string;
  scope_type: string;
  scope_value: string;
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

export default function GrowthOpsView({
  locale,
  tracker,
  realMetricRows,
  isAdmin,
}: {
  locale: string;
  tracker: TrackerRow[];
  realMetricRows: TrackerRow[];
  isAdmin: boolean;
}) {
  const { activeOrg, loading, orgs } = useOrg();
  const searchParams = useSearchParams();
  const allCompaniesSelected = searchParams.get("scope") === "all";

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
          companyView: "当前公司视图",
          globalView: "全局视图",
          fallbackNote: "当前公司还没有独立的 growth tracker，已显示 global 数据（仅管理员可见）。",
          noData: "当前没有可显示的 growth tracker 数据。",
          noCompanyData: "当前公司还没有独立的 growth tracker 数据。",
          allCompaniesView: "全部公司视图",
          noAllCompaniesData: "当前用户可访问的公司还没有可显示的增长数据。",
          companiesIncluded: "纳入公司",
          companiesWithData: "有数据公司",
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
          companyView: "Current Company View",
          globalView: "Global View",
          fallbackNote: "This company does not have a dedicated growth tracker yet, so global data is being shown to admins only.",
          noData: "No growth tracker data is available yet.",
          noCompanyData: "This company does not have dedicated growth tracker data yet.",
          allCompaniesView: "All Companies View",
          noAllCompaniesData: "No growth data is available yet for the companies included in this view.",
          companiesIncluded: "Companies Included",
          companiesWithData: "Companies With Data",
        };

  const { current, previous, filteredRows, usingFallback, currentViewLabel, includedOrgCount, orgsWithDataCount } = useMemo(() => {
    const sortRows = (rows: TrackerRow[]) =>
      [...rows].sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
    const sorted = sortRows(tracker);
    const metricRows = sortRows(realMetricRows);
    const globalRows = sorted.filter(
      (row) => row.scope_type === "global" || row.scope_value === "all"
    );
    const orgNameSet = new Set(orgs.map((org) => org.name.trim().toLowerCase()));
    const aggregateRows = (rows: TrackerRow[]): TrackerRow[] => {
      const grouped = new Map<string, TrackerRow[]>();
      for (const row of rows) {
        const bucket = grouped.get(row.week_start) || [];
        bucket.push(row);
        grouped.set(row.week_start, bucket);
      }

      const combineText = (items: TrackerRow[], key: keyof TrackerRow) =>
        Array.from(new Set(items.map((item) => item[key]).filter(Boolean))).join(" | ");

      const combineYesNo = (items: TrackerRow[], key: keyof TrackerRow) =>
        items.some((item) => String(item[key]).toLowerCase() === "yes") ? "yes" : "no";

      const sumNumeric = (items: TrackerRow[], key: keyof TrackerRow) =>
        String(items.reduce((sum, item) => sum + toNumber(String(item[key])), 0));

      return Array.from(grouped.entries())
        .map(([weekStart, items]) => ({
          week_start: weekStart,
          scope_type: "org-group",
          scope_value: "all-selected-orgs",
          owner: combineText(items, "owner"),
          focus_icp: combineText(items, "focus_icp"),
          offer_angle: combineText(items, "offer_angle"),
          geo_page_or_update: combineText(items, "geo_page_or_update"),
          outbound_batch_sent: combineYesNo(items, "outbound_batch_sent"),
          followup_batch_sent: combineYesNo(items, "followup_batch_sent"),
          social_posts_published: sumNumeric(items, "social_posts_published"),
          homepage_visits: sumNumeric(items, "homepage_visits"),
          use_case_visits: sumNumeric(items, "use_case_visits"),
          geo_page_visits: sumNumeric(items, "geo_page_visits"),
          contacts_enriched: sumNumeric(items, "contacts_enriched"),
          initial_emails_sent: sumNumeric(items, "initial_emails_sent"),
          followups_sent: sumNumeric(items, "followups_sent"),
          replies: sumNumeric(items, "replies"),
          positive_replies: sumNumeric(items, "positive_replies"),
          calls_booked: sumNumeric(items, "calls_booked"),
          paid_setups_closed: sumNumeric(items, "paid_setups_closed"),
          top_signal: combineText(items, "top_signal"),
          top_problem: combineText(items, "top_problem"),
          next_change: combineText(items, "next_change"),
        }))
        .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
    };

    const mergeRows = (baseRows: TrackerRow[], metricSourceRows: TrackerRow[]) => {
      const byWeek = new Map<string, TrackerRow>();
      const metricKeys: (keyof TrackerRow)[] = [
        "outbound_batch_sent",
        "followup_batch_sent",
        "social_posts_published",
        "homepage_visits",
        "use_case_visits",
        "geo_page_visits",
        "contacts_enriched",
        "initial_emails_sent",
        "followups_sent",
        "replies",
        "positive_replies",
        "calls_booked",
        "paid_setups_closed",
      ];

      for (const row of baseRows) {
        byWeek.set(row.week_start, { ...row });
      }

      for (const metricRow of metricSourceRows) {
        const existing = byWeek.get(metricRow.week_start) || { ...metricRow };
        const merged = { ...existing };
        for (const key of metricKeys) {
          if (metricRow[key] !== "") {
            merged[key] = metricRow[key];
          }
        }
        merged.week_start = metricRow.week_start;
        merged.scope_type = existing.scope_type || metricRow.scope_type;
        merged.scope_value = existing.scope_value || metricRow.scope_value;
        byWeek.set(metricRow.week_start, merged);
      }

      return sortRows(Array.from(byWeek.values()));
    };

    if (allCompaniesSelected) {
      const accessibleOrgRows = sorted.filter(
        (row) => row.scope_type === "org" && orgNameSet.has(row.scope_value.trim().toLowerCase())
      );
      const accessibleMetricRows = metricRows.filter(
        (row) => row.scope_type === "org" && orgNameSet.has(row.scope_value.trim().toLowerCase())
      );
      const accessibleNames = new Set<string>();
      for (const row of accessibleOrgRows) accessibleNames.add(row.scope_value.trim().toLowerCase());
      for (const row of accessibleMetricRows) accessibleNames.add(row.scope_value.trim().toLowerCase());
      const aggregated = mergeRows(aggregateRows(accessibleOrgRows), aggregateRows(accessibleMetricRows));
      return {
        current: aggregated[0] || null,
        previous: aggregated[1] || null,
        filteredRows: aggregated,
        usingFallback: false,
        currentViewLabel: labels.allCompaniesView,
        includedOrgCount: orgs.length,
        orgsWithDataCount: accessibleNames.size,
      };
    }

    if (!activeOrg) {
      return {
        current: isAdmin ? globalRows[0] || sorted[0] || null : null,
        previous: isAdmin ? globalRows[1] || sorted[1] || null : null,
        filteredRows: isAdmin ? (globalRows.length > 0 ? globalRows : sorted) : [],
        usingFallback: false,
        currentViewLabel: isAdmin ? labels.globalView : labels.companyView,
        includedOrgCount: isAdmin ? orgs.length : 0,
        orgsWithDataCount: 0,
      };
    }

    const orgRows = sorted.filter(
      (row) =>
        row.scope_type === "org" &&
        row.scope_value.trim().toLowerCase() === activeOrg.name.trim().toLowerCase()
    );
    const orgMetricRows = metricRows.filter(
      (row) =>
        row.scope_type === "org" &&
        row.scope_value.trim().toLowerCase() === activeOrg.name.trim().toLowerCase()
    );
    const mergedOrgRows = mergeRows(orgRows, orgMetricRows);

    if (mergedOrgRows.length > 0) {
      return {
        current: mergedOrgRows[0],
        previous: mergedOrgRows[1] || null,
        filteredRows: mergedOrgRows,
        usingFallback: false,
        currentViewLabel: activeOrg.name,
        includedOrgCount: 1,
        orgsWithDataCount: 1,
      };
    }

    if (isAdmin) {
      const adminGlobalRows = mergeRows(globalRows, aggregateRows(metricRows));
      return {
        current: adminGlobalRows[0] || null,
        previous: adminGlobalRows[1] || null,
        filteredRows: adminGlobalRows,
        usingFallback: true,
        currentViewLabel: activeOrg.name,
        includedOrgCount: 1,
        orgsWithDataCount: 0,
      };
    }

    return {
      current: null,
      previous: null,
      filteredRows: [],
      usingFallback: false,
      currentViewLabel: activeOrg.name,
      includedOrgCount: 1,
      orgsWithDataCount: 0,
    };
  }, [activeOrg, allCompaniesSelected, isAdmin, labels.allCompaniesView, labels.companyView, labels.globalView, orgs, realMetricRows, tracker]);

  if (!current) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          {allCompaniesSelected
            ? labels.noAllCompaniesData
            : activeOrg
              ? labels.noCompanyData
              : labels.noData}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{labels.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-500">{labels.subtitle}</p>
      </div>

      <section className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-500">{labels.currentWeek}</p>
            <h2 className="mt-2 text-xl font-semibold text-gray-900">{current.week_start}</h2>
            <p className="mt-1 text-sm text-gray-600">
              {labels.companyView}:{" "}
              <span className="font-medium text-gray-900">
                {loading ? "..." : currentViewLabel}
              </span>
            </p>
            {usingFallback ? (
              <p className="mt-2 text-sm text-amber-700">{labels.fallbackNote}</p>
            ) : null}
            <p className="mt-2 text-sm text-gray-600">
              {labels.focusIcp}: <span className="font-medium text-gray-900">{current.focus_icp}</span>
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {labels.offerAngle}: <span className="font-medium text-gray-900">{current.offer_angle}</span>
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {labels.geoUpdate}: <span className="font-medium text-gray-900">{current.geo_page_or_update}</span>
            </p>
            {allCompaniesSelected ? (
              <p className="mt-1 text-sm text-gray-600">
                {labels.companiesIncluded}:{" "}
                <span className="font-medium text-gray-900">{includedOrgCount}</span>
                {" · "}
                {labels.companiesWithData}:{" "}
                <span className="font-medium text-gray-900">{orgsWithDataCount}</span>
              </p>
            ) : null}
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
              {filteredRows.map((row) => (
                <tr key={`${row.scope_type}-${row.scope_value}-${row.week_start}`} className="border-b border-gray-100 align-top">
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
  );
}
