"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import UserPlanBadge from "@/components/UserPlanBadge";
import ChatWidget from "@/components/ChatWidget";
import { OrgProvider, useOrg } from "@/components/OrgContext";
import CreditsBadge from "@/components/CreditsBadge";
import AiCreditBadge from "@/components/AiCreditBadge";

interface Props {
  children: React.ReactNode;
  user: { email?: string | null };
  plan?: string;
  fullHeight?: boolean;
}

type NavLink = { href: string; label: string };
type NavGroup = { label: string; children: NavLink[] };
type NavItem = NavLink | NavGroup;

function isGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

// Sections hidden from read-only (sandbox/viewer) accounts. Paid Ads stays
// visible (traffic only — spend is redacted elsewhere); Settings hides the
// API-keys UI that lives inside it.
const READONLY_HIDDEN_HREF_PATTERNS = [
  "/dashboard/marketplace/",
  "/dashboard/billing",
  "/dashboard/income",
  "/dashboard/budget",
  "/dashboard/usage",
  "/dashboard/settings",
];
function filterNavForReadOnly(items: NavItem[]): NavItem[] {
  const hidden = (href: string) => READONLY_HIDDEN_HREF_PATTERNS.some((p) => href.includes(p));
  const out: NavItem[] = [];
  for (const item of items) {
    if (isGroup(item)) {
      const children = item.children.filter((c) => !hidden(c.href));
      if (children.length > 0) out.push({ ...item, children });
    } else if (!hidden(item.href)) {
      out.push(item);
    }
  }
  return out;
}

export default function DashboardShell(props: Props) {
  return (
    <OrgProvider>
      <DashboardShellInner {...props} />
    </OrgProvider>
  );
}

function DashboardShellInner({ children, user, plan: planProp, fullHeight }: Props) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const tc = dict.common;
  const { isReadOnly, loading: orgLoading } = useOrg();
  const growthOpsLabel =
    locale === "zh"
      ? "增长运营"
      : locale === "zh-TW"
        ? "增長營運"
        : locale === "ko"
          ? "성장 운영"
          : "Growth Ops";
  const analyticsLabel =
    locale === "zh"
      ? "数据分析"
      : locale === "zh-TW"
        ? "數據分析"
        : locale === "ko"
          ? "분석"
          : "Analytics";

  const [fetchedPlan, setFetchedPlan] = useState<string | undefined>(planProp);
  useEffect(() => {
    if (planProp) return;
    fetch("/api/usage-quota").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.quota?.plan) setFetchedPlan(d.quota.plan);
    }).catch(() => {});
  }, [planProp]);
  const plan = fetchedPlan;
  const isPaid = plan && plan !== "starter";

  // Read-only (sandbox) accounts can't open hidden sections even by direct URL.
  useEffect(() => {
    if (orgLoading || !isReadOnly) return;
    if (READONLY_HIDDEN_HREF_PATTERNS.some((p) => pathname.includes(p))) {
      router.replace(`/${locale}/dashboard/reports`);
    }
  }, [orgLoading, isReadOnly, pathname, router, locale]);

  const allNavItems: NavItem[] = [
    { href: `/${locale}/dashboard/growth-ops`, label: growthOpsLabel },
    { href: `/${locale}/dashboard/reports`, label: analyticsLabel },
    { href: `/${locale}/dashboard/chat`, label: tc.chat },
    {
      label: tc.intelligent,
      children: [
        { href: `/${locale}/dashboard/projects`, label: tc.projects },
        { href: `/${locale}/dashboard/skills`, label: tc.skills },
        { href: `/${locale}/dashboard/knowledge`, label: tc.knowledge },
        { href: `/${locale}/dashboard/media-library`, label: tc.mediaLibrary || "Media Library" },
      ],
    },
    {
      label: tc.crm || "CRM",
      children: [
        { href: `/${locale}/dashboard/crm?tab=contacts`, label: tc.crmContacts || "Contacts" },
        { href: `/${locale}/dashboard/crm?tab=companies`, label: tc.crmCompanies || "Companies" },
        { href: `/${locale}/dashboard/crm?tab=groups`, label: tc.crmGroups || (locale === "zh" ? "群组" : "Groups") },
        { href: `/${locale}/dashboard/crm?tab=tasks`, label: tc.crmTasks || "Tasks" },
        { href: `/${locale}/dashboard/email-templates`, label: tc.emailTemplates },
        { href: `/${locale}/dashboard/email-review`, label: tc.emailReview || "Email Review" },
      ],
    },
    ...(isPaid ? [{
      label: tc.recruiting || "Recruiting",
      children: [
        { href: `/${locale}/dashboard/recruiting?tab=candidates`, label: tc.recruitingCandidates || "Candidates" },
        { href: `/${locale}/dashboard/recruiting?tab=positions`, label: tc.recruitingPositions || "Positions" },
        { href: `/${locale}/dashboard/recruiting?tab=pipeline`, label: tc.recruitingPipeline || "Pipeline" },
      ],
    }] : []),
    {
      label: tc.workspace,
      children: [
        { href: `/${locale}/dashboard/agents`, label: tc.agents },
        { href: `/${locale}/dashboard/workflows`, label: tc.workflows },
        { href: `/${locale}/dashboard/partners`, label: tc.partners },
      ],
    },
    {
      label: tc.socialMediaMarketing,
      children: [
        { href: `/${locale}/dashboard/buffer`, label: tc.buffer || "Buffer" },
        { href: `/${locale}/dashboard/youtube`, label: tc.youtube || "YouTube" },
        { href: `/${locale}/dashboard/tiktok`, label: tc.tiktok },
        { href: `/${locale}/dashboard/x`, label: tc.x },
        { href: `/${locale}/dashboard/facebook`, label: tc.facebook },
        { href: `/${locale}/dashboard/instagram`, label: tc.instagram },
      ],
    },
    {
      label: tc.paidAds || "Paid Ads",
      children: [
        { href: `/${locale}/dashboard/google-ads`, label: tc.googleAds || "Google Ads" },
        { href: `/${locale}/dashboard/meta-ads`, label: tc.metaAds || "Meta Ads" },
        { href: `/${locale}/dashboard/tiktok-ads`, label: tc.tiktokAds || "TikTok Ads" },
      ],
    },
    {
      label: tc.salesChannels || "Sales Channels",
      children: [
        { href: `/${locale}/dashboard/products`, label: locale === "zh" ? "产品管理" : "Products" },
        { href: `/${locale}/dashboard/marketplace/amazon`, label: "Amazon" },
        { href: `/${locale}/dashboard/marketplace/dkwholesale`, label: "DK Wholesale" },
        { href: `/${locale}/dashboard/marketplace/etsy`, label: "Etsy" },
        { href: `/${locale}/dashboard/marketplace/xianyu`, label: locale === "zh" || locale === "zh-TW" ? "闲鱼" : "Xianyu" },
      ],
    },
    {
      label: tc.finance,
      children: [
        { href: `/${locale}/dashboard/billing`, label: tc.billing },
        { href: `/${locale}/dashboard/income`, label: tc.income },
        { href: `/${locale}/dashboard/budget`, label: tc.budget || "Budget" },
      ],
    },
    {
      label: tc.system,
      children: [
        { href: `/${locale}/dashboard/growth-ops`, label: growthOpsLabel },
        { href: `/${locale}/dashboard/usage`, label: tc.usage },
        { href: `/${locale}/dashboard/settings`, label: tc.settings },
      ],
    },
    { href: `/${locale}/dashboard/docs`, label: tc.docs },
  ];
  const navItems = isReadOnly ? filterNavForReadOnly(allNavItems) : allNavItems;

  const isActive = (href: string) => pathname === href;

  // Default to collapsed — only expand the group containing the active page.
  const getInitialExpanded = () => {
    const expanded = new Set<string>();
    for (const item of navItems) {
      if (isGroup(item) && item.children.some((c) => pathname === c.href)) {
        expanded.add(item.label);
      }
    }
    return expanded;
  };

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(getInitialExpanded);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const { orgs: userOrgs, activeOrg, setActiveOrgId } = useOrg();
  const onGrowthOpsPage = pathname === `/${locale}/dashboard/growth-ops`;
  const onReportsPage = pathname === `/${locale}/dashboard/reports`;
  const supportsAllCompanies = onGrowthOpsPage || onReportsPage;
  const growthScope = searchParams.get("scope");
  const allCompaniesSelected = supportsAllCompanies && growthScope === "all";

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const isGroupActive = (group: NavGroup) =>
    group.children.some((child) => isActive(child.href));

  const chevron = (expanded: boolean) => (
    <svg
      className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );

  const renderNavItems = (items: NavItem[], onNavigate?: () => void) =>
    items.map((item) => {
      if (isGroup(item)) {
        const expanded = expandedGroups.has(item.label) || isGroupActive(item);
        return (
          <div key={item.label}>
            <button
              onClick={() => toggleGroup(item.label)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                isGroupActive(item)
                  ? "text-red-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span>{item.label}</span>
              {chevron(expanded)}
            </button>
            {expanded && (
              <div className="ml-2 border-l border-gray-200 pl-1 flex flex-col gap-0.5 mt-0.5">
                {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={onNavigate}
                    className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isActive(child.href)
                        ? "bg-red-50 text-red-700 font-medium"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      }
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            isActive(item.href)
              ? "bg-red-50 text-red-700"
              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          }`}
        >
          {item.label}
        </Link>
      );
    });

  return (
    <div className={`${fullHeight ? "h-screen" : "min-h-screen"} bg-gray-50 flex flex-col`}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shrink-0">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="md:hidden text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileNavOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
            <Link href={`/${locale}`} className="text-xl font-bold tracking-tight flex items-center gap-2">
              <img src="/logo.svg" alt="AutoClaw" className="w-8 h-8" />
              <span><span className="text-red-600">Auto</span>Claw</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <AiCreditBadge locale={locale} />
            <CreditsBadge locale={locale} />
            {/* Org selector */}
            {userOrgs.length > 0 && (
              <div className="relative hidden sm:block">
                <button
                  onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  {allCompaniesSelected
                    ? (locale === "zh" ? "全部公司" : locale === "zh-TW" ? "全部公司" : "All Companies")
                    : activeOrg?.name || (locale === "zh" ? "选择组织" : locale === "zh-TW" ? "選擇組織" : "Select Org")}
                  <svg className={`w-3 h-3 transition-transform ${orgDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {orgDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOrgDropdownOpen(false)} />
                    <div className="absolute right-0 mt-1 z-50 w-[min(90vw,28rem)] max-w-[28rem] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                      {supportsAllCompanies && userOrgs.length > 1 && (
                        <button
                          onClick={() => {
                            const basePath = onGrowthOpsPage
                              ? `/${locale}/dashboard/growth-ops`
                              : `/${locale}/dashboard/reports`;
                            router.push(`${basePath}?scope=all`);
                            setOrgDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 flex items-center justify-between cursor-pointer transition-colors ${
                            allCompaniesSelected ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"
                          }`}
                        >
                          <span className="text-sm font-medium text-left">
                            {locale === "zh" ? "全部公司" : locale === "zh-TW" ? "全部公司" : "All Companies"}
                          </span>
                          {allCompaniesSelected && (
                            <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      )}
                      {userOrgs.map((org) => (
                        <button
                          key={org.id}
                          onClick={() => {
                            setActiveOrgId(org.id);
                            if (supportsAllCompanies) {
                              if (onGrowthOpsPage) {
                                router.push(`/${locale}/dashboard/growth-ops`);
                              } else {
                                router.push(`/${locale}/dashboard/reports?org_id=${org.id}`);
                              }
                            }
                            setOrgDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 flex items-start justify-between gap-3 cursor-pointer transition-colors ${
                            !allCompaniesSelected && activeOrg?.id === org.id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 text-gray-700"
                          }`}
                        >
                          <span className="min-w-0 flex-1 text-left text-sm font-medium break-words leading-6">{org.name}</span>
                          <div className="flex shrink-0 items-center gap-2 pt-0.5">
                            {org.member_role && (
                              <span className="text-xs text-gray-400 capitalize whitespace-nowrap">{org.member_role}</span>
                            )}
                            {!allCompaniesSelected && activeOrg?.id === org.id && (
                              <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </button>
                      ))}
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        onClick={() => {
                          setOrgDropdownOpen(false);
                          const name = window.prompt(locale === "zh" ? "新公司名称" : locale === "zh-TW" ? "新公司名稱" : locale === "ko" ? "새 회사 이름" : "New company name");
                          if (!name?.trim()) return;
                          fetch("/api/organizations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "create", name: name.trim() }),
                          })
                            .then((r) => r.json())
                            .then((data) => {
                              if (data.org_id) {
                                setActiveOrgId(data.org_id);
                                window.location.reload();
                              } else {
                                window.alert(data.error || "Failed to create company");
                              }
                            })
                            .catch((e) => window.alert(e.message || "Failed to create company"));
                        }}
                        className="w-full px-3 py-2 flex items-center gap-2 text-sm text-emerald-700 hover:bg-emerald-50 cursor-pointer transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="font-medium">
                          {locale === "zh" ? "添加新公司" : locale === "zh-TW" ? "新增公司" : locale === "ko" ? "새 회사 추가" : "Add New Company"}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <LanguageSwitcher locale={locale} />
            <span className="text-sm text-gray-600 hidden sm:flex items-center gap-1.5">
              {user.email} <UserPlanBadge plan={plan} />
            </span>
            <Link href="/auth/logout" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">{tc.logOut}</Link>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex flex-col w-48 bg-white border-r border-gray-200 py-4 shrink-0">
          <nav className="flex flex-col gap-0.5 px-2">
            {renderNavItems(navItems)}
          </nav>
          <div className="px-2 mt-2">
            <Link
              href={`/${locale}/dashboard/referrals`}
              className="block px-3 py-2.5 bg-linear-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg text-xs hover:from-red-100 hover:to-orange-100 transition-colors"
            >
              <span className="font-semibold text-red-700">💰 {tc.referrals}</span>
              <p className="text-red-600/70 mt-0.5 leading-tight">5% lifetime commission</p>
            </Link>
          </div>
        </aside>

        {/* Mobile nav overlay */}
        {mobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex" onClick={() => setMobileNavOpen(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <aside className="relative w-56 bg-white shadow-lg flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">{tc.dashboard}</span>
                <button onClick={() => setMobileNavOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <nav className="flex flex-col gap-0.5 px-2 py-3">
                {renderNavItems(navItems, () => setMobileNavOpen(false))}
              </nav>
              <div className="px-3 py-2">
                <Link
                  href={`/${locale}/dashboard/referrals`}
                  onClick={() => setMobileNavOpen(false)}
                  className="block px-3 py-2.5 bg-linear-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg text-xs hover:from-red-100 hover:to-orange-100 transition-colors"
                >
                  <span className="font-semibold text-red-700">💰 {tc.referrals}</span>
                  <p className="text-red-600/70 mt-0.5 leading-tight">5% lifetime commission</p>
                </Link>
              </div>
              <div className="mt-auto px-4 py-3 border-t border-gray-100 sm:hidden">
                <span className="text-xs text-gray-500 flex items-center gap-1.5">
                  {user.email} <UserPlanBadge plan={plan} />
                </span>
              </div>
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className={`flex-1 ${fullHeight ? "flex flex-col min-h-0 overflow-hidden" : "overflow-y-auto"}`}>
          {children}
        </main>
      </div>

      {/* Floating chat widget */}
      <ChatWidget />
    </div>
  );
}
