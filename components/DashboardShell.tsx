"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import UserPlanBadge from "@/components/UserPlanBadge";
import ChatWidget from "@/components/ChatWidget";

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

export default function DashboardShell({ children, user, plan, fullHeight }: Props) {
  const params = useParams();
  const pathname = usePathname();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const tc = dict.common;

  const navItems: NavItem[] = [
    { href: `/${locale}/dashboard/reports`, label: tc.dashboard },
    { href: `/${locale}/dashboard/chat`, label: tc.chat },
    {
      label: tc.intelligent,
      children: [
        { href: `/${locale}/dashboard/projects`, label: tc.projects },
        { href: `/${locale}/dashboard/skills`, label: tc.skills },
        { href: `/${locale}/dashboard/knowledge`, label: tc.knowledge },
        { href: `/${locale}/dashboard/contacts`, label: tc.customers },
        { href: `/${locale}/dashboard/activities`, label: tc.activities },
      ],
    },
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
        { href: `/${locale}/dashboard/tiktok`, label: tc.tiktok },
        { href: `/${locale}/dashboard/x`, label: tc.x },
        { href: `/${locale}/dashboard/facebook`, label: tc.facebook },
        { href: `/${locale}/dashboard/instagram`, label: tc.instagram },
      ],
    },
    {
      label: tc.finance,
      children: [
        { href: `/${locale}/dashboard/billing`, label: tc.billing },
        { href: `/${locale}/dashboard/income`, label: tc.income },
      ],
    },
    { href: `/${locale}/dashboard/settings`, label: tc.settings },
    { href: `/${locale}/dashboard/docs`, label: tc.docs },
  ];

  const isActive = (href: string) => pathname === href;

  // Default to all groups expanded so the navigation is fully visible on first load.
  const getInitialExpanded = () => {
    const expanded = new Set<string>();
    for (const item of navItems) {
      if (isGroup(item)) {
        expanded.add(item.label);
      }
    }
    return expanded;
  };

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(getInitialExpanded);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
            <LanguageSwitcher locale={locale} />
            <span className="text-sm text-gray-600 hidden sm:flex items-center gap-1.5">
              {user.email} <UserPlanBadge plan={plan} />
            </span>
            <a href="/auth/logout" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">{tc.logOut}</a>
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
