"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import ByokSection from "./ByokSection";
import OrgKeysSection from "./OrgKeysSection";
import PlatformApiKeysSection from "./PlatformApiKeysSection";
import OrgManagementSection from "./OrgManagementSection";

interface StorageUsage {
  plan: string;
  database: {
    totalSize: string;
    tableCount: number;
    tables: { name: string; rows: number; size: string }[];
  };
  knowledgeBase: { docCount: number; chunkCount: number; totalTokens: number };
  embeddings: {
    period: string;
    requestCount: number;
    tokenCount: number;
    budget: number;
  };
  blob: {
    configured: boolean;
    totalFiles: number;
    totalBytes: number;
    totalSizeMB: string;
  };
  data: { contacts: number; leads: number; projects: number; agents: number };
}

interface Project {
  id: number;
  name: string;
  website: string;
  description: string;
  ga_property_id: string | null;
  domain: string | null;
  org_id: number | null;
}

interface Org {
  id: number;
  name: string;
  domain: string | null;
  member_role: string | null;
  member_count: number;
  project_count: number;
}

interface OrgMember {
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export default function SettingsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const ts = dict.settings;
  const tc = dict.common;

  const { user, isLoading: userLoading } = useUser();
  const [selectedLocale, setSelectedLocale] = useState<string>(locale);
  const [saved, setSaved] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    website: "",
    ga_property_id: "",
    description: "",
    domain: "",
  });
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectSaved, setProjectSaved] = useState<number | null>(null);
  const [teamMembers, setTeamMembers] = useState<
    {
      email: string;
      name: string;
      project_role: string;
      created_at: string;
      project_ids: number[];
    }[]
  >([]);
  const [projectInviteEmail, setProjectInviteEmail] = useState<
    Record<number, string>
  >({});
  const [projectInviting, setProjectInviting] = useState<
    Record<number, boolean>
  >({});
  const [projectInviteMsg, setProjectInviteMsg] = useState<
    Record<number, string>
  >({});
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgMembers, setOrgMembers] = useState<Record<number, OrgMember[]>>({});
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgDomain, setNewOrgDomain] = useState("");
  const [orgCreating, setOrgCreating] = useState(false);
  const [orgMsg, setOrgMsg] = useState("");
  const [orgMsgType, setOrgMsgType] = useState<"success" | "error">("success");
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addMemberOrgId, setAddMemberOrgId] = useState<number | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [assignProjectId, setAssignProjectId] = useState<number | null>(null);
  const [assignOrgId, setAssignOrgId] = useState<number | null>(null);
  const [renamingOrgId, setRenamingOrgId] = useState<number | null>(null);
  const [renameOrgName, setRenameOrgName] = useState("");
  const [userRole, setUserRole] = useState<string>("user");
  const [userPlan, setUserPlan] = useState<string>("starter");
  const [apiKeys, setApiKeys] = useState<
    {
      id: number;
      service: string;
      masked_key: string;
      label: string | null;
      updated_at: string;
    }[]
  >([]);
  const [byokEditing, setByokEditing] = useState<string | null>(null);
  const [byokKeyInput, setByokKeyInput] = useState("");
  const [byokLabelInput, setByokLabelInput] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [byokMsg, setByokMsg] = useState("");
  const [byokRevealed, setByokRevealed] = useState<Record<string, string>>({});
  const [byokRevealing, setByokRevealing] = useState<string | null>(null);
  const [platformKeys, setPlatformKeys] = useState<
    {
      id: number;
      key_prefix: string;
      name: string | null;
      scopes: string[];
      last_used_at: string | null;
      expires_at: string | null;
      created_at: string;
      revoked_at: string | null;
    }[]
  >([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read", "write"]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);
  const [orgKeys, setOrgKeys] = useState<
    {
      id: number;
      org_id: number;
      org_name: string;
      service: string;
      label: string | null;
      masked_key: string;
      updated_at: string;
    }[]
  >([]);
  const [orgKeyEditing, setOrgKeyEditing] = useState<string | null>(null);
  const [orgKeyInput, setOrgKeyInput] = useState("");
  const [orgKeyLabelInput, setOrgKeyLabelInput] = useState("");
  const [orgKeySaving, setOrgKeySaving] = useState(false);
  const [orgKeyMsg, setOrgKeyMsg] = useState("");
  const [orgKeyRevealed, setOrgKeyRevealed] = useState<Record<string, string>>(
    {},
  );
  const [selectedOrgForKeys, setSelectedOrgForKeys] = useState<number | null>(
    null,
  );
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    projects: true,
    language: true,
    org: true,
    byok: true,
    orgkeys: true,
    apikeys: true,
    storage: true,
  });

  useEffect(() => {
    if (!user) return;
    fetch(`/api/projects?_t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        setProjects(data.projects || []);
        if (data.role) setUserRole(data.role);
        if (data.plan) setUserPlan(data.plan);
      });
    fetch("/api/team-members")
      .then((r) => r.json())
      .then((data) => setTeamMembers(data.members || []));
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((data) => {
        const orgList = data.orgs || [];
        setOrgs(orgList);
        orgList.forEach((org: Org) => loadOrgMembers(org.id));
      });
    fetch("/api/api-keys")
      .then((r) => r.json())
      .then((data) => {
        setApiKeys(data.keys || []);
        setPlatformKeys(data.platformKeys || []);
        setOrgKeys(data.orgKeys || []);
      });
    fetch("/api/storage-usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStorage(d);
      })
      .catch(() => {});
  }, [user]);

  function loadOrgMembers(orgId: number) {
    fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_members", org_id: orgId }),
    })
      .then((r) => r.json())
      .then((data) =>
        setOrgMembers((prev) => ({ ...prev, [orgId]: data.members || [] })),
      );
  }

  function handleSave() {
    document.cookie = `locale=${selectedLocale};path=/;max-age=31536000`;
    setSaved(true);
    if (selectedLocale !== locale) {
      const newPath = window.location.pathname.replace(
        `/${locale}`,
        `/${selectedLocale}`,
      );
      window.location.href = newPath;
    }
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setEditForm({
      name: project.name || "",
      website: project.website || "",
      ga_property_id: project.ga_property_id || "",
      description: project.description || "",
      domain: project.domain || "",
    });
    setProjectSaved(null);
  }

  async function saveProject(projectId: number) {
    setProjectSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_project",
          project_id: projectId,
          name: editForm.name || undefined,
          website: editForm.website,
          ga_property_id: editForm.ga_property_id || null,
          description: editForm.description,
          domain: editForm.domain || null,
        }),
      });
      if (res.ok) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  name: editForm.name || p.name,
                  website: editForm.website,
                  ga_property_id: editForm.ga_property_id || null,
                  description: editForm.description,
                  domain: editForm.domain || null,
                }
              : p,
          ),
        );
        setEditingId(null);
        setProjectSaved(projectId);
        setTimeout(() => setProjectSaved(null), 2000);
      }
    } finally {
      setProjectSaving(false);
    }
  }

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">{tc.loading}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{tc.loading}</h1>
          <a
            href="/auth/login"
            className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {tc.logIn}
          </a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user}>
      <div className="px-4 sm:px-6 py-6 w-full">
        <h1 className="text-2xl font-bold mb-4">{ts.title}</h1>

        {/* Settings Index Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            {
              key: "language",
              icon: "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129",
              label: ts.language,
            },
            {
              key: "org",
              icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
              label: ts.orgTitle,
              count: orgs.length,
            },
            {
              key: "byok",
              icon: "M6 8h12l1 11a2 2 0 01-2 2H7a2 2 0 01-2-2L6 8zm3 0V6a3 3 0 016 0v2m-6 0h6",
              label: ts.byokTitle,
              count: apiKeys.length,
            },
            ...(orgs.some(
              (o) => o.member_role === "admin" || o.member_role === "operator",
            )
              ? [
                  {
                    key: "orgkeys",
                    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
                    label: ts.orgKeysTitle || "Org API Keys",
                    count: orgKeys.length,
                  },
                ]
              : []),
            {
              key: "apikeys",
              icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
              label: ts.apiKeysTitle || "API Keys",
              count: platformKeys.filter((k) => !k.revoked_at).length,
            },
            {
              key: "storage",
              icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
              label: ts.storageTitle || "Storage & Usage",
            },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setCollapsed((prev) => ({
                  ...prev,
                  [item.key]: !prev[item.key],
                }));
                setTimeout(
                  () =>
                    document
                      .getElementById(`section-${item.key}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  50,
                );
              }}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all cursor-pointer ${
                !collapsed[item.key]
                  ? "border-red-300 bg-red-50 shadow-sm"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
              }`}
            >
              <svg
                className={`w-6 h-6 ${!collapsed[item.key] ? "text-red-600" : "text-gray-400"}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d={item.icon}
                />
              </svg>
              <span
                className={`text-xs font-medium ${!collapsed[item.key] ? "text-red-700" : "text-gray-600"}`}
              >
                {item.label}
              </span>
              {item.count !== undefined && (
                <span className="text-[10px] text-gray-400">{item.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Project Management */}
        <div
          id="section-projects"
          className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden"
        >
          <div className="p-6">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{ts.projectsTitle}</h2>
                <p className="text-sm text-gray-500">{ts.projectsDesc}</p>
              </div>
              <Link
                href={`/${locale}/dashboard/projects`}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-red-800 text-white text-sm font-medium hover:bg-red-900"
              >
                {ts.projectsTitle}
              </Link>
            </div>
          </div>
        </div>

        {/* Language Settings */}
        <div
          id="section-language"
          className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden"
        >
          <button
            onClick={() =>
              setCollapsed((prev) => ({ ...prev, language: !prev.language }))
            }
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.language}</h2>
              <p className="text-sm text-gray-500">{ts.languageDesc}</p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.language ? "" : "rotate-180"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {!collapsed.language && (
            <div className="px-6 pb-6 border-t border-gray-100 pt-4">
              <div className="space-y-2 mb-6">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="locale"
                    value="en"
                    checked={selectedLocale === "en"}
                    onChange={() => {
                      setSelectedLocale("en");
                      setSaved(false);
                    }}
                    className="text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium">{ts.english}</span>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="locale"
                    value="zh"
                    checked={selectedLocale === "zh"}
                    onChange={() => {
                      setSelectedLocale("zh");
                      setSaved(false);
                    }}
                    className="text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium">{ts.chinese}</span>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="locale"
                    value="zh-TW"
                    checked={selectedLocale === "zh-TW"}
                    onChange={() => {
                      setSelectedLocale("zh-TW");
                      setSaved(false);
                    }}
                    className="text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium">
                    {ts.chineseTW || "繁體中文"}
                  </span>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="radio"
                    name="locale"
                    value="fr"
                    checked={selectedLocale === "fr"}
                    onChange={() => {
                      setSelectedLocale("fr");
                      setSaved(false);
                    }}
                    className="text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium">
                    {ts.french || "Français"}
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  className="bg-red-800 hover:bg-red-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {tc.save}
                </button>
                {saved && (
                  <span className="text-sm text-green-600">{ts.saved}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Team & Organization */}
        <div
          id="section-org"
          className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden"
        >
          <button
            onClick={() =>
              setCollapsed((prev) => ({ ...prev, org: !prev.org }))
            }
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.orgTitle}</h2>
              <p className="text-sm text-gray-500">{ts.orgDesc}</p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.org ? "" : "rotate-180"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {!collapsed.org && (
            <div className="px-6 pb-6 border-t border-gray-100 pt-4">
              {userPlan === "starter" ? (
                <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg bg-gray-50">
                  <p className="text-sm text-gray-500 mb-3">
                    {ts.orgUpgradeHint}
                  </p>
                  <Link
                    href={`/${locale}/dashboard/billing`}
                    className="inline-block bg-red-800 hover:bg-red-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {ts.orgUpgradeBtn}
                  </Link>
                </div>
              ) : orgs.length === 0 ? (
                <>
                  <p className="text-sm text-gray-400 mb-4">{ts.orgNoOrg}</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder={ts.orgName}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                    />
                    <input
                      type="text"
                      value={newOrgDomain}
                      onChange={(e) => setNewOrgDomain(e.target.value)}
                      placeholder={ts.orgDomain + " (optional)"}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                    />
                    <button
                      onClick={async () => {
                        if (!newOrgName) return;
                        setOrgCreating(true);
                        try {
                          const res = await fetch("/api/organizations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "create",
                              name: newOrgName,
                              domain: newOrgDomain || null,
                            }),
                          });
                          if (res.ok) {
                            setOrgMsg(ts.orgCreated);
                            setOrgMsgType("success");
                            setNewOrgName("");
                            setNewOrgDomain("");
                            const data = await fetch("/api/organizations").then(
                              (r) => r.json(),
                            );
                            setOrgs(data.orgs || []);
                            (data.orgs || []).forEach((org: Org) =>
                              loadOrgMembers(org.id),
                            );
                          } else {
                            const err = await res.json();
                            setOrgMsg(err.error || "Failed");
                            setOrgMsgType("error");
                          }
                        } finally {
                          setOrgCreating(false);
                          setTimeout(() => setOrgMsg(""), 3000);
                        }
                      }}
                      disabled={orgCreating || !newOrgName}
                      className="bg-red-800 hover:bg-red-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      {orgCreating ? "..." : ts.orgCreate}
                    </button>
                  </div>
                  {orgMsg && (
                    <p
                      className={`text-sm mt-2 ${orgMsgType === "error" ? "text-red-500" : "text-green-600"}`}
                    >
                      {orgMsg}
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  {orgs.map((org) => (
                    <div
                      key={org.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {renamingOrgId === org.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={renameOrgName}
                                onChange={(e) =>
                                  setRenameOrgName(e.target.value)
                                }
                                className="px-2 py-1 border border-gray-300 rounded text-sm font-semibold focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                                autoFocus
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter" && renameOrgName) {
                                    await fetch("/api/organizations", {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        action: "rename",
                                        org_id: org.id,
                                        name: renameOrgName,
                                      }),
                                    });
                                    setRenamingOrgId(null);
                                    const data = await fetch(
                                      "/api/organizations",
                                    ).then((r) => r.json());
                                    setOrgs(data.orgs || []);
                                  }
                                  if (e.key === "Escape")
                                    setRenamingOrgId(null);
                                }}
                              />
                              <button
                                onClick={async () => {
                                  if (!renameOrgName) return;
                                  await fetch("/api/organizations", {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      action: "rename",
                                      org_id: org.id,
                                      name: renameOrgName,
                                    }),
                                  });
                                  setRenamingOrgId(null);
                                  const data = await fetch(
                                    "/api/organizations",
                                  ).then((r) => r.json());
                                  setOrgs(data.orgs || []);
                                }}
                                className="text-xs text-green-600 hover:text-green-800 cursor-pointer"
                              >
                                {tc.save}
                              </button>
                              <button
                                onClick={() => setRenamingOrgId(null)}
                                className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                              >
                                {tc.cancel}
                              </button>
                            </div>
                          ) : (
                            <>
                              <h3 className="font-semibold text-sm">
                                {org.name}{" "}
                                <span className="text-[10px] text-gray-400 font-normal">
                                  #{org.id}
                                </span>
                              </h3>
                              {org.member_role === "admin" && (
                                <button
                                  onClick={() => {
                                    setRenamingOrgId(org.id);
                                    setRenameOrgName(org.name);
                                  }}
                                  className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                                >
                                  {ts.orgRename || "Rename"}
                                </button>
                              )}
                            </>
                          )}
                          {org.domain && (
                            <span className="text-xs text-gray-400">
                              @{org.domain}
                            </span>
                          )}
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${org.member_role === "admin" ? "bg-purple-100 text-purple-800" : org.member_role === "operator" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}
                          >
                            {org.member_role === "admin"
                              ? ts.orgRoleAdmin
                              : org.member_role === "operator"
                                ? ts.orgRoleOperator
                                : ts.orgRoleMember}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>
                            {org.member_count} {ts.orgMembers}
                          </span>
                          <span>
                            {org.project_count} {ts.orgProjects}
                          </span>
                          {org.member_role === "admin" &&
                            orgMembers[org.id] &&
                            orgMembers[org.id].length <= 1 && (
                              <button
                                onClick={async () => {
                                  if (
                                    !confirm(
                                      ts.orgDeleteConfirm ||
                                        "Delete this organization?",
                                    )
                                  )
                                    return;
                                  const res = await fetch(
                                    "/api/organizations",
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        action: "delete",
                                        org_id: org.id,
                                      }),
                                    },
                                  );
                                  if (res.ok) {
                                    setOrgMsg(
                                      ts.orgDeleted || "Organization deleted",
                                    );
                                    const data = await fetch(
                                      "/api/organizations",
                                    ).then((r) => r.json());
                                    setOrgs(data.orgs || []);
                                    fetch(`/api/projects?_t=${Date.now()}`)
                                      .then((r) => r.json())
                                      .then((d) =>
                                        setProjects(d.projects || []),
                                      );
                                    setTimeout(() => setOrgMsg(""), 3000);
                                  } else {
                                    const data = await res.json();
                                    setOrgMsg(data.error || "Failed");
                                    setTimeout(() => setOrgMsg(""), 3000);
                                  }
                                }}
                                className="text-red-400 hover:text-red-600 cursor-pointer"
                              >
                                {tc.delete}
                              </button>
                            )}
                        </div>
                      </div>

                      {/* Org Members */}
                      {orgMembers[org.id] && orgMembers[org.id].length > 0 && (
                        <div className="overflow-x-auto mb-3">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-200 text-left">
                                <th className="pb-2 pr-4 font-medium text-gray-500 text-xs">
                                  {ts.teamEmail || "Email"}
                                </th>
                                <th className="pb-2 pr-4 font-medium text-gray-500 text-xs">
                                  {ts.teamName || "Name"}
                                </th>
                                <th className="pb-2 pr-4 font-medium text-gray-500 text-xs">
                                  {ts.teamRole || "Role"}
                                </th>
                                <th className="pb-2 font-medium text-gray-500 text-xs"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {orgMembers[org.id].map((member) => (
                                <tr
                                  key={member.email}
                                  className="border-b border-gray-100"
                                >
                                  <td className="py-2 pr-4 text-gray-700">
                                    {member.email}
                                  </td>
                                  <td className="py-2 pr-4 text-gray-500">
                                    {member.name || "-"}
                                  </td>
                                  <td className="py-2 pr-4">
                                    <span
                                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${member.role === "admin" ? "bg-purple-100 text-purple-800" : member.role === "operator" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}
                                    >
                                      {member.role === "admin"
                                        ? ts.orgRoleAdmin
                                        : member.role === "operator"
                                          ? ts.orgRoleOperator
                                          : ts.orgRoleMember}
                                    </span>
                                  </td>
                                  <td className="py-2 text-right space-x-2">
                                    {org.member_role === "admin" &&
                                      !(
                                        member.email === user?.email &&
                                        member.role === "admin"
                                      ) && (
                                        <button
                                          onClick={async () => {
                                            const newRole =
                                              member.role === "admin"
                                                ? "member"
                                                : "admin";
                                            await fetch("/api/organizations", {
                                              method: "POST",
                                              headers: {
                                                "Content-Type":
                                                  "application/json",
                                              },
                                              body: JSON.stringify({
                                                action: "update_role",
                                                org_id: org.id,
                                                member_email: member.email,
                                                role: newRole,
                                              }),
                                            });
                                            loadOrgMembers(org.id);
                                          }}
                                          className={`text-xs cursor-pointer ${member.role === "admin" ? "text-gray-500 hover:text-gray-700" : "text-purple-500 hover:text-purple-700"}`}
                                        >
                                          {member.role === "admin"
                                            ? ts.orgDemote || "Demote"
                                            : ts.orgPromote || "Promote"}
                                        </button>
                                      )}
                                    {org.member_role === "admin" &&
                                      member.role !== "admin" && (
                                        <button
                                          onClick={async () => {
                                            await fetch("/api/organizations", {
                                              method: "POST",
                                              headers: {
                                                "Content-Type":
                                                  "application/json",
                                              },
                                              body: JSON.stringify({
                                                action: "remove_member",
                                                org_id: org.id,
                                                member_email: member.email,
                                              }),
                                            });
                                            loadOrgMembers(org.id);
                                          }}
                                          className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                                        >
                                          {ts.orgRemove}
                                        </button>
                                      )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Add Member (only for org admins) */}
                      {org.member_role === "admin" && (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            value={
                              addMemberOrgId === org.id ? addMemberEmail : ""
                            }
                            onChange={(e) => {
                              setAddMemberEmail(e.target.value);
                              setAddMemberOrgId(org.id);
                            }}
                            onFocus={() => setAddMemberOrgId(org.id)}
                            placeholder={
                              ts.invitePlaceholder || "colleague@company.com"
                            }
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                          />
                          <button
                            onClick={async () => {
                              if (!addMemberEmail) return;
                              setAddingMember(true);
                              setOrgMsg("");
                              try {
                                const res = await fetch("/api/organizations", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    action: "add_member",
                                    org_id: org.id,
                                    email: addMemberEmail,
                                  }),
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  setOrgMsg(ts.orgMemberAdded);
                                  setAddMemberEmail("");
                                  loadOrgMembers(org.id);
                                  fetch("/api/organizations")
                                    .then((r) => r.json())
                                    .then((d) => setOrgs(d.orgs || []));
                                } else {
                                  setOrgMsg(data.error || "Failed");
                                }
                              } finally {
                                setAddingMember(false);
                                setTimeout(() => setOrgMsg(""), 3000);
                              }
                            }}
                            disabled={
                              addingMember ||
                              !addMemberEmail ||
                              addMemberOrgId !== org.id
                            }
                            className="bg-red-800 hover:bg-red-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            {addingMember ? "..." : ts.orgAddMember}
                          </button>
                        </div>
                      )}

                      {/* Assigned Projects */}
                      {(() => {
                        const orgProjects = projects.filter(
                          (p) => p.org_id === org.id,
                        );
                        return (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <h4 className="text-xs font-semibold text-gray-500 mb-2">
                              {ts.orgProjects || "Projects"} (
                              {orgProjects.length})
                            </h4>
                            {orgProjects.length > 0 && (
                              <div className="space-y-1 mb-2">
                                {orgProjects.map((p) => (
                                  <div
                                    key={p.id}
                                    className="flex items-center justify-between py-1"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-gray-700">
                                        {p.name}
                                      </span>
                                      {p.website && (
                                        <span className="text-xs text-gray-400 truncate max-w-[200px]">
                                          {p.website}
                                        </span>
                                      )}
                                    </div>
                                    {org.member_role === "admin" && (
                                      <button
                                        onClick={async () => {
                                          await fetch("/api/projects", {
                                            method: "POST",
                                            headers: {
                                              "Content-Type":
                                                "application/json",
                                            },
                                            body: JSON.stringify({
                                              action: "update_project",
                                              project_id: p.id,
                                              org_id: null,
                                            }),
                                          });
                                          setProjects((prev) =>
                                            prev.map((proj) =>
                                              proj.id === p.id
                                                ? { ...proj, org_id: null }
                                                : proj,
                                            ),
                                          );
                                          fetch("/api/organizations")
                                            .then((r) => r.json())
                                            .then((d) => setOrgs(d.orgs || []));
                                        }}
                                        className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                                      >
                                        {ts.orgUnassign || "Unassign"}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Assign Project to Org (only for org admins) */}
                            {org.member_role === "admin" &&
                              projects.filter((p) => !p.org_id).length > 0 && (
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <select
                                    value={
                                      assignOrgId === org.id
                                        ? (assignProjectId ?? "")
                                        : ""
                                    }
                                    onChange={(e) => {
                                      setAssignProjectId(
                                        e.target.value
                                          ? Number(e.target.value)
                                          : null,
                                      );
                                      setAssignOrgId(org.id);
                                    }}
                                    onFocus={() => setAssignOrgId(org.id)}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                                  >
                                    <option value="">
                                      {ts.orgAssignProject}
                                    </option>
                                    {projects
                                      .filter((p) => !p.org_id)
                                      .map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                  </select>
                                  <button
                                    onClick={async () => {
                                      if (
                                        !assignProjectId ||
                                        assignOrgId !== org.id
                                      )
                                        return;
                                      const res = await fetch(
                                        "/api/organizations",
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            action: "assign_project",
                                            org_id: org.id,
                                            project_id: assignProjectId,
                                          }),
                                        },
                                      );
                                      if (res.ok) {
                                        setOrgMsg(ts.orgProjectAssigned);
                                        setAssignProjectId(null);
                                        setProjects((prev) =>
                                          prev.map((p) =>
                                            p.id === assignProjectId
                                              ? { ...p, org_id: org.id }
                                              : p,
                                          ),
                                        );
                                        fetch("/api/organizations")
                                          .then((r) => r.json())
                                          .then((d) => setOrgs(d.orgs || []));
                                        setTimeout(() => setOrgMsg(""), 3000);
                                      }
                                    }}
                                    disabled={
                                      !assignProjectId || assignOrgId !== org.id
                                    }
                                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                                  >
                                    {ts.orgAssignProject}
                                  </button>
                                </div>
                              )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                  {orgMsg && <p className="text-sm text-green-600">{orgMsg}</p>}

                  {/* Create another org */}
                  <div className="border border-dashed border-gray-300 rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                        placeholder={ts.orgName}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                      />
                      <input
                        type="text"
                        value={newOrgDomain}
                        onChange={(e) => setNewOrgDomain(e.target.value)}
                        placeholder={ts.orgDomain + " (optional)"}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                      />
                      <button
                        onClick={async () => {
                          if (!newOrgName) return;
                          setOrgCreating(true);
                          try {
                            const res = await fetch("/api/organizations", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "create",
                                name: newOrgName,
                                domain: newOrgDomain || null,
                              }),
                            });
                            if (res.ok) {
                              setOrgMsg(ts.orgCreated);
                              setOrgMsgType("success");
                              setNewOrgName("");
                              setNewOrgDomain("");
                              const data = await fetch(
                                "/api/organizations",
                              ).then((r) => r.json());
                              setOrgs(data.orgs || []);
                              (data.orgs || []).forEach((o: Org) =>
                                loadOrgMembers(o.id),
                              );
                            } else {
                              const err = await res.json();
                              setOrgMsg(err.error || "Failed");
                              setOrgMsgType("error");
                            }
                          } finally {
                            setOrgCreating(false);
                            setTimeout(() => setOrgMsg(""), 3000);
                          }
                        }}
                        disabled={orgCreating || !newOrgName}
                        className="bg-red-800 hover:bg-red-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        {orgCreating ? "..." : ts.orgCreate}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Market */}
        <ByokSection
          ts={ts}
          tc={tc}
          apiKeys={apiKeys}
          setApiKeys={setApiKeys}
          byokEditing={byokEditing}
          setByokEditing={setByokEditing}
          byokKeyInput={byokKeyInput}
          setByokKeyInput={setByokKeyInput}
          byokLabelInput={byokLabelInput}
          setByokLabelInput={setByokLabelInput}
          byokSaving={byokSaving}
          setByokSaving={setByokSaving}
          byokMsg={byokMsg}
          setByokMsg={setByokMsg}
          byokRevealed={byokRevealed}
          setByokRevealed={setByokRevealed}
          byokRevealing={byokRevealing}
          setByokRevealing={setByokRevealing}
          userPlan={userPlan}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />

        {/* ── Organization API Keys (admin/operator only) ── */}
        {orgs.some(
          (o) => o.member_role === "admin" || o.member_role === "operator",
        ) && (
          <OrgKeysSection
            orgs={orgs}
            orgKeys={orgKeys}
            setOrgKeys={setOrgKeys}
            apiKeys={apiKeys}
            collapsed={collapsed.orgkeys}
            setCollapsed={(v) => setCollapsed((prev) => ({ ...prev, orgkeys: v }))}
            ts={ts}
            tc={tc}
          />
        )}

        {/* ── Platform API Keys ── */}
        <PlatformApiKeysSection
          platformKeys={platformKeys}
          setPlatformKeys={setPlatformKeys}
          collapsed={collapsed.apikeys}
          setCollapsed={(v) => setCollapsed((prev) => ({ ...prev, apikeys: v }))}
          ts={ts}
          tc={tc}
        />

        {/* Storage & Usage */}
        <div
          id="section-storage"
          className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden"
        >
          <button
            onClick={() =>
              setCollapsed((prev) => ({ ...prev, storage: !prev.storage }))
            }
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">
                {ts.storageTitle || "Storage & Usage"}
              </h2>
              <p className="text-sm text-gray-500">
                {ts.storageDesc ||
                  "Current resource usage across your workspace."}
              </p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${!collapsed.storage ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {!collapsed.storage && (
            <div className="px-6 pb-6">
              {!storage ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  {tc.loading}
                </p>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-400">
                        {ts.storageDb || "Database"}
                      </p>
                      <p className="text-lg font-bold text-gray-900">
                        {storage.database.totalSize}
                      </p>
                      <p className="text-xs text-gray-400">
                        {storage.database.tableCount} tables
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-400">
                        {ts.storageKb || "Knowledge Base"}
                      </p>
                      <p className="text-lg font-bold text-gray-900">
                        {storage.knowledgeBase.docCount}{" "}
                        <span className="text-sm font-normal text-gray-400">
                          docs
                        </span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {storage.knowledgeBase.chunkCount} chunks / ~
                        {Math.round(storage.knowledgeBase.totalTokens / 1000)}K
                        tokens
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-400">
                        {ts.storageBlob || "Blob Storage"}
                      </p>
                      {storage.blob.configured ? (
                        <>
                          <p className="text-lg font-bold text-gray-900">
                            {storage.blob.totalSizeMB}{" "}
                            <span className="text-sm font-normal text-gray-400">
                              MB
                            </span>
                          </p>
                          <p className="text-xs text-gray-400">
                            {storage.blob.totalFiles} files
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400">
                          {ts.storageNotConfigured || "Not configured"}
                        </p>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-400">
                        {ts.storageEmbeddings || "Embeddings"}
                      </p>
                      <p className="text-lg font-bold text-gray-900">
                        {(storage.embeddings.requestCount / 1000).toFixed(1)}K
                      </p>
                      <p className="text-xs text-gray-400">
                        / {(storage.embeddings.budget / 1000).toFixed(0)}K{" "}
                        {ts.storageMonthly || "monthly"}
                      </p>
                      {storage.embeddings.budget > 0 && (
                        <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${storage.embeddings.requestCount / storage.embeddings.budget > 0.8 ? "bg-red-500" : "bg-green-500"}`}
                            style={{
                              width: `${Math.min(100, (storage.embeddings.requestCount / storage.embeddings.budget) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Data counts */}
                  <div className="grid grid-cols-4 gap-3 mb-5">
                    {[
                      {
                        label: ts.storageProjects || "Projects",
                        value: storage.data.projects,
                      },
                      {
                        label: ts.storageAgents || "AI Employees",
                        value: storage.data.agents,
                      },
                      {
                        label: ts.storageContacts || "Contacts",
                        value: storage.data.contacts,
                      },
                      {
                        label: ts.storageLeads || "Leads",
                        value: storage.data.leads,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="text-center p-2 bg-gray-50 rounded-lg border border-gray-100"
                      >
                        <p className="text-lg font-bold text-gray-900">
                          {item.value.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-400">{item.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Database tables detail */}
                  {storage.database.tables.length > 0 && (
                    <details className="text-sm">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                        {ts.storageDbDetail || "Database table details"}
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-400 border-b border-gray-100">
                              <th className="py-1.5 pr-4">Table</th>
                              <th className="py-1.5 pr-4 text-right">Rows</th>
                              <th className="py-1.5 text-right">Size</th>
                            </tr>
                          </thead>
                          <tbody>
                            {storage.database.tables.map((t) => (
                              <tr
                                key={t.name}
                                className="border-b border-gray-50"
                              >
                                <td className="py-1.5 pr-4 font-mono text-gray-600">
                                  {t.name}
                                </td>
                                <td className="py-1.5 pr-4 text-right text-gray-500">
                                  {t.rows.toLocaleString()}
                                </td>
                                <td className="py-1.5 text-right text-gray-500">
                                  {t.size}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  <p className="text-xs text-gray-300 mt-3">
                    Plan: {storage.plan} | {ts.storageUpdated || "Updated"}:{" "}
                    {new Date().toLocaleDateString(locale)}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
