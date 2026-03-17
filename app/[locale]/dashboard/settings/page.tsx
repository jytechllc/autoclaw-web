"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

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
  const [editForm, setEditForm] = useState({ name: "", website: "", ga_property_id: "", description: "", domain: "" });
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectSaved, setProjectSaved] = useState<number | null>(null);
  const [teamMembers, setTeamMembers] = useState<{ email: string; name: string; project_role: string; created_at: string; project_ids: number[] }[]>([]);
  const [projectInviteEmail, setProjectInviteEmail] = useState<Record<number, string>>({});
  const [projectInviting, setProjectInviting] = useState<Record<number, boolean>>({});
  const [projectInviteMsg, setProjectInviteMsg] = useState<Record<number, string>>({});
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
  const [apiKeys, setApiKeys] = useState<{ id: number; service: string; masked_key: string; label: string | null; updated_at: string }[]>([]);
  const [byokEditing, setByokEditing] = useState<string | null>(null);
  const [byokKeyInput, setByokKeyInput] = useState("");
  const [byokLabelInput, setByokLabelInput] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [byokMsg, setByokMsg] = useState("");
  const [byokRevealed, setByokRevealed] = useState<Record<string, string>>({});
  const [byokRevealing, setByokRevealing] = useState<string | null>(null);
  const [platformKeys, setPlatformKeys] = useState<{ id: number; key_prefix: string; name: string | null; scopes: string[]; last_used_at: string | null; expires_at: string | null; created_at: string; revoked_at: string | null }[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read", "write"]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);
  const [orgKeys, setOrgKeys] = useState<{ id: number; org_id: number; org_name: string; service: string; label: string | null; masked_key: string; updated_at: string }[]>([]);
  const [orgKeyEditing, setOrgKeyEditing] = useState<string | null>(null);
  const [orgKeyInput, setOrgKeyInput] = useState("");
  const [orgKeyLabelInput, setOrgKeyLabelInput] = useState("");
  const [orgKeySaving, setOrgKeySaving] = useState(false);
  const [orgKeyMsg, setOrgKeyMsg] = useState("");
  const [orgKeyRevealed, setOrgKeyRevealed] = useState<Record<string, string>>({});
  const [selectedOrgForKeys, setSelectedOrgForKeys] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    projects: true,
    language: true,
    org: true,
    byok: true,
    orgkeys: true,
    apikeys: true,
  });

  useEffect(() => {
    if (!user) return;
    fetch(`/api/projects?_t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => { setProjects(data.projects || []); if (data.role) setUserRole(data.role); if (data.plan) setUserPlan(data.plan); });
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
      .then((data) => { setApiKeys(data.keys || []); setPlatformKeys(data.platformKeys || []); setOrgKeys(data.orgKeys || []); });
  }, [user]);

  function loadOrgMembers(orgId: number) {
    fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_members", org_id: orgId }),
    })
      .then((r) => r.json())
      .then((data) => setOrgMembers((prev) => ({ ...prev, [orgId]: data.members || [] })));
  }

  function handleSave() {
    document.cookie = `locale=${selectedLocale};path=/;max-age=31536000`;
    setSaved(true);
    if (selectedLocale !== locale) {
      const newPath = window.location.pathname.replace(`/${locale}`, `/${selectedLocale}`);
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
              ? { ...p, name: editForm.name || p.name, website: editForm.website, ga_property_id: editForm.ga_property_id || null, description: editForm.description, domain: editForm.domain || null }
              : p
          )
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
          <a href="/auth/login" className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
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
            { key: "language", icon: "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129", label: ts.language },
            { key: "org", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", label: ts.orgTitle, count: orgs.length },
            { key: "byok", icon: "M6 8h12l1 11a2 2 0 01-2 2H7a2 2 0 01-2-2L6 8zm3 0V6a3 3 0 016 0v2m-6 0h6", label: ts.byokTitle, count: apiKeys.length },
            ...(orgs.some((o) => o.member_role === "admin" || o.member_role === "operator") ? [{ key: "orgkeys", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", label: ts.orgKeysTitle || "Org API Keys", count: orgKeys.length }] : []),
            { key: "apikeys", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4", label: ts.apiKeysTitle || "API Keys", count: platformKeys.filter((k) => !k.revoked_at).length },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setCollapsed((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
                setTimeout(() => document.getElementById(`section-${item.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all cursor-pointer ${
                !collapsed[item.key] ? "border-red-300 bg-red-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
              }`}
            >
              <svg className={`w-6 h-6 ${!collapsed[item.key] ? "text-red-600" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
              </svg>
              <span className={`text-xs font-medium ${!collapsed[item.key] ? "text-red-700" : "text-gray-600"}`}>{item.label}</span>
              {item.count !== undefined && (
                <span className="text-[10px] text-gray-400">{item.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Project Management */}
        <div id="section-projects" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
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
        <div id="section-language" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, language: !prev.language }))}
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.language}</h2>
              <p className="text-sm text-gray-500">{ts.languageDesc}</p>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.language ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed.language && <div className="px-6 pb-6 border-t border-gray-100 pt-4">

          <div className="space-y-2 mb-6">
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="locale"
                value="en"
                checked={selectedLocale === "en"}
                onChange={() => { setSelectedLocale("en"); setSaved(false); }}
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
                onChange={() => { setSelectedLocale("zh"); setSaved(false); }}
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
                onChange={() => { setSelectedLocale("zh-TW"); setSaved(false); }}
                className="text-red-600 focus:ring-red-500"
              />
              <span className="text-sm font-medium">{ts.chineseTW || "繁體中文"}</span>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="locale"
                value="fr"
                checked={selectedLocale === "fr"}
                onChange={() => { setSelectedLocale("fr"); setSaved(false); }}
                className="text-red-600 focus:ring-red-500"
              />
              <span className="text-sm font-medium">{ts.french || "Français"}</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              className="bg-red-800 hover:bg-red-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {tc.save}
            </button>
            {saved && <span className="text-sm text-green-600">{ts.saved}</span>}
          </div>
        </div>}
        </div>

        {/* Team & Organization */}
        <div id="section-org" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, org: !prev.org }))}
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.orgTitle}</h2>
              <p className="text-sm text-gray-500">{ts.orgDesc}</p>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.org ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed.org && <div className="px-6 pb-6 border-t border-gray-100 pt-4">

          {userPlan === "starter" ? (
            <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg bg-gray-50">
              <p className="text-sm text-gray-500 mb-3">{ts.orgUpgradeHint}</p>
              <Link href={`/${locale}/dashboard/billing`} className="inline-block bg-red-800 hover:bg-red-900 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
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
                        body: JSON.stringify({ action: "create", name: newOrgName, domain: newOrgDomain || null }),
                      });
                      if (res.ok) {
                        setOrgMsg(ts.orgCreated);
                        setOrgMsgType("success");
                        setNewOrgName("");
                        setNewOrgDomain("");
                        const data = await fetch("/api/organizations").then((r) => r.json());
                        setOrgs(data.orgs || []);
                        (data.orgs || []).forEach((org: Org) => loadOrgMembers(org.id));
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
              {orgMsg && <p className={`text-sm mt-2 ${orgMsgType === "error" ? "text-red-500" : "text-green-600"}`}>{orgMsg}</p>}
            </>
          ) : (
            <div className="space-y-4">
              {orgs.map((org) => (
                <div key={org.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {renamingOrgId === org.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={renameOrgName}
                            onChange={(e) => setRenameOrgName(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm font-semibold focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                            autoFocus
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && renameOrgName) {
                                await fetch("/api/organizations", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "rename", org_id: org.id, name: renameOrgName }),
                                });
                                setRenamingOrgId(null);
                                const data = await fetch("/api/organizations").then((r) => r.json());
                                setOrgs(data.orgs || []);
                              }
                              if (e.key === "Escape") setRenamingOrgId(null);
                            }}
                          />
                          <button
                            onClick={async () => {
                              if (!renameOrgName) return;
                              await fetch("/api/organizations", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "rename", org_id: org.id, name: renameOrgName }),
                              });
                              setRenamingOrgId(null);
                              const data = await fetch("/api/organizations").then((r) => r.json());
                              setOrgs(data.orgs || []);
                            }}
                            className="text-xs text-green-600 hover:text-green-800 cursor-pointer"
                          >{tc.save}</button>
                          <button onClick={() => setRenamingOrgId(null)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">{tc.cancel}</button>
                        </div>
                      ) : (
                        <>
                          <h3 className="font-semibold text-sm">{org.name}</h3>
                          {org.member_role === "admin" && (
                            <button
                              onClick={() => { setRenamingOrgId(org.id); setRenameOrgName(org.name); }}
                              className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                            >{ts.orgRename || "Rename"}</button>
                          )}
                        </>
                      )}
                      {org.domain && <span className="text-xs text-gray-400">@{org.domain}</span>}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${org.member_role === "admin" ? "bg-purple-100 text-purple-800" : org.member_role === "operator" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}>
                        {org.member_role === "admin" ? ts.orgRoleAdmin : org.member_role === "operator" ? ts.orgRoleOperator : ts.orgRoleMember}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>{org.member_count} {ts.orgMembers}</span>
                      <span>{org.project_count} {ts.orgProjects}</span>
                      {org.member_role === "admin" && orgMembers[org.id] && orgMembers[org.id].length <= 1 && (
                        <button
                          onClick={async () => {
                            if (!confirm(ts.orgDeleteConfirm || "Delete this organization?")) return;
                            const res = await fetch("/api/organizations", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete", org_id: org.id }),
                            });
                            if (res.ok) {
                              setOrgMsg(ts.orgDeleted || "Organization deleted");
                              const data = await fetch("/api/organizations").then((r) => r.json());
                              setOrgs(data.orgs || []);
                              fetch(`/api/projects?_t=${Date.now()}`).then((r) => r.json()).then((d) => setProjects(d.projects || []));
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
                            <th className="pb-2 pr-4 font-medium text-gray-500 text-xs">{ts.teamEmail || "Email"}</th>
                            <th className="pb-2 pr-4 font-medium text-gray-500 text-xs">{ts.teamName || "Name"}</th>
                            <th className="pb-2 pr-4 font-medium text-gray-500 text-xs">{ts.teamRole || "Role"}</th>
                            <th className="pb-2 font-medium text-gray-500 text-xs"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {orgMembers[org.id].map((member) => (
                            <tr key={member.email} className="border-b border-gray-100">
                              <td className="py-2 pr-4 text-gray-700">{member.email}</td>
                              <td className="py-2 pr-4 text-gray-500">{member.name || "-"}</td>
                              <td className="py-2 pr-4">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${member.role === "admin" ? "bg-purple-100 text-purple-800" : member.role === "operator" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"}`}>
                                  {member.role === "admin" ? ts.orgRoleAdmin : member.role === "operator" ? ts.orgRoleOperator : ts.orgRoleMember}
                                </span>
                              </td>
                              <td className="py-2 text-right space-x-2">
                                {org.member_role === "admin" && !(member.email === user?.email && member.role === "admin") && (
                                  <button
                                    onClick={async () => {
                                      const newRole = member.role === "admin" ? "member" : "admin";
                                      await fetch("/api/organizations", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "update_role", org_id: org.id, member_email: member.email, role: newRole }),
                                      });
                                      loadOrgMembers(org.id);
                                    }}
                                    className={`text-xs cursor-pointer ${member.role === "admin" ? "text-gray-500 hover:text-gray-700" : "text-purple-500 hover:text-purple-700"}`}
                                  >
                                    {member.role === "admin" ? (ts.orgDemote || "Demote") : (ts.orgPromote || "Promote")}
                                  </button>
                                )}
                                {org.member_role === "admin" && member.role !== "admin" && (
                                  <button
                                    onClick={async () => {
                                      await fetch("/api/organizations", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "remove_member", org_id: org.id, member_email: member.email }),
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
                        value={addMemberOrgId === org.id ? addMemberEmail : ""}
                        onChange={(e) => { setAddMemberEmail(e.target.value); setAddMemberOrgId(org.id); }}
                        onFocus={() => setAddMemberOrgId(org.id)}
                        placeholder={ts.invitePlaceholder || "colleague@company.com"}
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
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "add_member", org_id: org.id, email: addMemberEmail }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setOrgMsg(ts.orgMemberAdded);
                              setAddMemberEmail("");
                              loadOrgMembers(org.id);
                              fetch("/api/organizations").then((r) => r.json()).then((d) => setOrgs(d.orgs || []));
                            } else {
                              setOrgMsg(data.error || "Failed");
                            }
                          } finally {
                            setAddingMember(false);
                            setTimeout(() => setOrgMsg(""), 3000);
                          }
                        }}
                        disabled={addingMember || !addMemberEmail || addMemberOrgId !== org.id}
                        className="bg-red-800 hover:bg-red-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        {addingMember ? "..." : ts.orgAddMember}
                      </button>
                    </div>
                  )}

                  {/* Assigned Projects */}
                  {(() => {
                    const orgProjects = projects.filter((p) => p.org_id === org.id);
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <h4 className="text-xs font-semibold text-gray-500 mb-2">{ts.orgProjects || "Projects"} ({orgProjects.length})</h4>
                        {orgProjects.length > 0 && (
                          <div className="space-y-1 mb-2">
                            {orgProjects.map((p) => (
                              <div key={p.id} className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-gray-700">{p.name}</span>
                                  {p.website && <span className="text-xs text-gray-400 truncate max-w-[200px]">{p.website}</span>}
                                </div>
                                {org.member_role === "admin" && (
                                  <button
                                    onClick={async () => {
                                      await fetch("/api/projects", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "update_project", project_id: p.id, org_id: null }),
                                      });
                                      setProjects((prev) => prev.map((proj) => proj.id === p.id ? { ...proj, org_id: null } : proj));
                                      fetch("/api/organizations").then((r) => r.json()).then((d) => setOrgs(d.orgs || []));
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
                        {org.member_role === "admin" && projects.filter((p) => !p.org_id).length > 0 && (
                          <div className="flex flex-col sm:flex-row gap-2">
                            <select
                              value={assignOrgId === org.id ? (assignProjectId ?? "") : ""}
                              onChange={(e) => { setAssignProjectId(e.target.value ? Number(e.target.value) : null); setAssignOrgId(org.id); }}
                              onFocus={() => setAssignOrgId(org.id)}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                            >
                              <option value="">{ts.orgAssignProject}</option>
                              {projects.filter((p) => !p.org_id).map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={async () => {
                                if (!assignProjectId || assignOrgId !== org.id) return;
                                const res = await fetch("/api/organizations", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "assign_project", org_id: org.id, project_id: assignProjectId }),
                                });
                                if (res.ok) {
                                  setOrgMsg(ts.orgProjectAssigned);
                                  setAssignProjectId(null);
                                  setProjects((prev) => prev.map((p) => p.id === assignProjectId ? { ...p, org_id: org.id } : p));
                                  fetch("/api/organizations").then((r) => r.json()).then((d) => setOrgs(d.orgs || []));
                                  setTimeout(() => setOrgMsg(""), 3000);
                                }
                              }}
                              disabled={!assignProjectId || assignOrgId !== org.id}
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
                          body: JSON.stringify({ action: "create", name: newOrgName, domain: newOrgDomain || null }),
                        });
                        if (res.ok) {
                          setOrgMsg(ts.orgCreated);
                          setOrgMsgType("success");
                          setNewOrgName("");
                          setNewOrgDomain("");
                          const data = await fetch("/api/organizations").then((r) => r.json());
                          setOrgs(data.orgs || []);
                          (data.orgs || []).forEach((o: Org) => loadOrgMembers(o.id));
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

        </div>}
        </div>

        {/* Market */}
        <div id="section-byok" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, byok: !prev.byok }))}
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.byokTitle}</h2>
              <p className="text-sm text-gray-500">{ts.byokDesc}</p>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.byok ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed.byok && <div className="px-6 pb-6 border-t border-gray-100 pt-4">

          <div className="space-y-3">
            {([
              { service: "openai", name: ts.byokOpenai, hint: ts.byokOpenaiHint, tier: "freemium" as const, tierInfo: ts.byokOpenaiTier },
              { service: "anthropic", name: ts.byokAnthropic, hint: ts.byokAnthropicHint, tier: "freemium" as const, tierInfo: ts.byokAnthropicTier },
              { service: "google", name: ts.byokGoogle, hint: ts.byokGoogleHint, tier: "free" as const, tierInfo: ts.byokGoogleTier },
              { service: "alibaba", name: ts.byokAlibaba, hint: ts.byokAlibabaHint, tier: "free" as const, tierInfo: ts.byokAlibabaTier },
              { service: "cerebras", name: ts.byokCerebras, hint: ts.byokCerebrasHint, tier: "free" as const, tierInfo: ts.byokCerebrasTier },
              { service: "vercel", name: ts.byokVercel, hint: ts.byokVercelHint, tier: "free" as const, tierInfo: ts.byokVercelTier },
              { service: "clawhub", name: ts.byokClawhub, hint: ts.byokClawhubHint, tier: "free" as const, tierInfo: ts.byokClawhubTier },
              { service: "xpilot", name: ts.byokXpilot, hint: ts.byokXpilotHint, tier: "free" as const, tierInfo: ts.byokXpilotTier },
              { service: "blob_token", name: ts.byokBlobToken, hint: ts.byokBlobTokenHint, tier: "free" as const, tierInfo: ts.byokBlobTokenTier },
              { service: "brevo", name: ts.byokBravo, hint: ts.byokBrevoHint, tier: "free" as const, tierInfo: ts.byokBrevoTier },
              { service: "sendgrid", name: ts.byokSendGrid, hint: ts.byokSendGridHint, tier: "free" as const, tierInfo: ts.byokSendGridTier },
              ...(userPlan === "enterprise" || userPlan === "scale" ? [
                { service: "apollo" as const, name: ts.byokApollo, hint: ts.byokApolloHint, tier: "freemium" as const, tierInfo: ts.byokApolloTier },
                { service: "apify" as const, name: ts.byokApify, hint: ts.byokApifyHint, tier: "freemium" as const, tierInfo: ts.byokApifyTier },
                { service: "hunter" as const, name: ts.byokHunter, hint: ts.byokHunterHint, tier: "freemium" as const, tierInfo: ts.byokHunterTier },
              ] : []),
            ] as { service: string; name: string; hint: string; tier: "free" | "freemium" | "paid"; tierInfo: string }[]).map((svc) => {
              const existing = apiKeys.find((k) => k.service === svc.service);
              const isEditing = byokEditing === svc.service;

              return (
                <div key={svc.service} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{svc.name}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${existing ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                        {existing ? ts.byokMasked : ts.byokNotSet}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${svc.tier === "free" ? "bg-blue-100 text-blue-700" : svc.tier === "freemium" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                        {svc.tier === "free" ? ts.byokTierFree : svc.tier === "freemium" ? ts.byokTierFreemium : ts.byokTierPaid}
                      </span>
                    </div>
                    {!isEditing && (
                      <button
                        onClick={() => {
                          setByokEditing(svc.service);
                          setByokKeyInput("");
                          setByokLabelInput(existing?.label || "");
                        }}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                      >
                        {existing ? ts.edit : ts.byokSave}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{svc.hint}</p>
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                    {svc.tierInfo}
                  </p>

                  {existing && !isEditing && (
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-600 font-mono">{byokRevealed[svc.service] || existing.masked_key}</p>
                      <button
                        onClick={async () => {
                          if (byokRevealed[svc.service]) {
                            setByokRevealed((prev) => { const n = { ...prev }; delete n[svc.service]; return n; });
                            return;
                          }
                          setByokRevealing(svc.service);
                          try {
                            const res = await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "reveal", service: svc.service }),
                            });
                            const data = await res.json();
                            if (res.ok && data.api_key) {
                              setByokRevealed((prev) => ({ ...prev, [svc.service]: data.api_key }));
                            }
                          } catch { /* ignore */ } finally { setByokRevealing(null); }
                        }}
                        disabled={byokRevealing === svc.service}
                        className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                      >
                        {byokRevealing === svc.service ? "..." : byokRevealed[svc.service] ? ts.byokHide : ts.byokReveal}
                      </button>
                    </div>
                  )}

                  {isEditing && (
                    <div className="space-y-2 mt-2">
                      <input
                        type="password"
                        value={byokKeyInput}
                        onChange={(e) => setByokKeyInput(e.target.value)}
                        placeholder={ts.byokPlaceholder}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={byokLabelInput}
                        onChange={(e) => setByokLabelInput(e.target.value)}
                        placeholder={ts.byokLabel}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            if (!byokKeyInput) return;
                            setByokSaving(true);
                            try {
                              const res = await fetch("/api/api-keys", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "upsert", service: svc.service, api_key: byokKeyInput, label: byokLabelInput || null }),
                              });
                              if (res.ok) {
                                setByokMsg(ts.byokSaved);
                                setByokEditing(null);
                                setByokKeyInput("");
                                const data = await fetch("/api/api-keys").then((r) => r.json());
                                setApiKeys(data.keys || []);
                              }
                            } finally {
                              setByokSaving(false);
                              setTimeout(() => setByokMsg(""), 3000);
                            }
                          }}
                          disabled={byokSaving || !byokKeyInput}
                          className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {byokSaving ? "..." : ts.byokSave}
                        </button>
                        <button
                          onClick={() => setByokEditing(null)}
                          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                        >
                          {tc.cancel}
                        </button>
                        {existing && (
                          <button
                            onClick={async () => {
                              await fetch("/api/api-keys", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "delete", service: svc.service }),
                              });
                              setByokMsg(ts.byokDeleted);
                              setByokEditing(null);
                              const data = await fetch("/api/api-keys").then((r) => r.json());
                              setApiKeys(data.keys || []);
                              setTimeout(() => setByokMsg(""), 3000);
                            }}
                            className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                          >
                            {ts.byokDelete}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* X (Twitter) - 4 keys grouped */}
            {(() => {
              const twitterKeys = [
                { service: "twitter_api_key" as const, name: ts.byokTwitterApiKey },
                { service: "twitter_api_secret" as const, name: ts.byokTwitterApiSecret },
                { service: "twitter_access_token" as const, name: ts.byokTwitterAccessToken },
                { service: "twitter_access_token_secret" as const, name: ts.byokTwitterAccessTokenSecret },
              ];
              const twitterConfigured = twitterKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
              const isEditingTwitter = byokEditing === "twitter";

              return (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{ts.byokTwitter}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${twitterConfigured.length === 4 ? "bg-green-100 text-green-800" : twitterConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                        {twitterConfigured.length === 4 ? ts.byokMasked : twitterConfigured.length > 0 ? `${twitterConfigured.length}/4` : ts.byokNotSet}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{ts.byokTierFreemium}</span>
                    </div>
                    {!isEditingTwitter && (
                      <button
                        onClick={() => {
                          setByokEditing("twitter");
                          setByokKeyInput("");
                        }}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                      >
                        {twitterConfigured.length > 0 ? ts.edit : ts.byokSave}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{ts.byokTwitterHint}</p>
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                    {ts.byokTwitterTier}
                  </p>

                  {!isEditingTwitter && twitterConfigured.length > 0 && (
                    <div className="space-y-1">
                      {twitterKeys.map((tk) => {
                        const existing = apiKeys.find((a) => a.service === tk.service);
                        return existing ? (
                          <div key={tk.service} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-36">{tk.name}:</span>
                            <span className="text-sm text-gray-600 font-mono">{existing.masked_key}</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}

                  {isEditingTwitter && (
                    <div className="space-y-2 mt-2">
                      {twitterKeys.map((tk) => {
                        const existing = apiKeys.find((a) => a.service === tk.service);
                        return (
                          <div key={tk.service}>
                            <label className="text-xs text-gray-500 mb-1 block">{tk.name}</label>
                            <input
                              type="password"
                              defaultValue=""
                              placeholder={existing ? "••••••••  (leave blank to keep)" : ts.byokPlaceholder}
                              data-twitter-key={tk.service}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                            />
                          </div>
                        );
                      })}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={async () => {
                            setByokSaving(true);
                            try {
                              const inputs = document.querySelectorAll<HTMLInputElement>("[data-twitter-key]");
                              let saved = false;
                              for (const input of inputs) {
                                const service = input.getAttribute("data-twitter-key");
                                const value = input.value.trim();
                                if (value && service) {
                                  const res = await fetch("/api/api-keys", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "upsert", service, api_key: value }),
                                  });
                                  if (res.ok) saved = true;
                                }
                              }
                              if (saved) {
                                setByokMsg(ts.byokSaved);
                                setByokEditing(null);
                                const data = await fetch("/api/api-keys").then((r) => r.json());
                                setApiKeys(data.keys || []);
                              }
                            } finally {
                              setByokSaving(false);
                              setTimeout(() => setByokMsg(""), 3000);
                            }
                          }}
                          disabled={byokSaving}
                          className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {byokSaving ? "..." : ts.byokSave}
                        </button>
                        <button
                          onClick={() => setByokEditing(null)}
                          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                        >
                          {tc.cancel}
                        </button>
                        {twitterConfigured.length > 0 && (
                          <button
                            onClick={async () => {
                              for (const tk of twitterKeys) {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "delete", service: tk.service }),
                                });
                              }
                              setByokMsg(ts.byokDeleted);
                              setByokEditing(null);
                              const data = await fetch("/api/api-keys").then((r) => r.json());
                              setApiKeys(data.keys || []);
                              setTimeout(() => setByokMsg(""), 3000);
                            }}
                            className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                          >
                            {ts.byokDelete}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Snov.io - 2 keys grouped (enterprise/scale only) */}
            {(userPlan === "enterprise" || userPlan === "scale") && (() => {
              const snovKeys = [
                { service: "snov_api_id" as const, name: ts.byokSnovApiId },
                { service: "snov_api_secret" as const, name: ts.byokSnovApiSecret },
              ];
              const snovConfigured = snovKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
              const isEditingSnov = byokEditing === "snov";

              return (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{ts.byokSnov}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${snovConfigured.length === 2 ? "bg-green-100 text-green-800" : snovConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                        {snovConfigured.length === 2 ? ts.byokMasked : snovConfigured.length > 0 ? `${snovConfigured.length}/2` : ts.byokNotSet}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{ts.byokTierFreemium}</span>
                    </div>
                    {!isEditingSnov && (
                      <button
                        onClick={() => { setByokEditing("snov"); setByokKeyInput(""); setByokLabelInput(""); }}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                      >
                        {snovConfigured.length > 0 ? ts.edit : ts.byokSave}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{ts.byokSnovHint}</p>
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                    {ts.byokSnovTier}
                  </p>

                  {!isEditingSnov && snovConfigured.length > 0 && (
                    <div className="text-xs text-gray-500 space-y-0.5">
                      {snovConfigured.map((sk) => (
                        <div key={sk.service}>{sk.name}: ••••••••</div>
                      ))}
                    </div>
                  )}

                  {isEditingSnov && (
                    <div className="space-y-2 mt-2">
                      {snovKeys.map((sk) => {
                        const existing = apiKeys.find((k) => k.service === sk.service);
                        return (
                          <div key={sk.service}>
                            <label className="text-xs text-gray-500 mb-0.5 block">{sk.name}</label>
                            <input
                              type="password"
                              defaultValue=""
                              placeholder={existing ? "••••••••  (leave blank to keep)" : ts.byokPlaceholder}
                              data-snov-key={sk.service}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                            />
                          </div>
                        );
                      })}
                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={async () => {
                            setByokSaving(true);
                            let saved = false;
                            for (const sk of snovKeys) {
                              const input = document.querySelector<HTMLInputElement>(`[data-snov-key="${sk.service}"]`);
                              const val = input?.value?.trim();
                              if (val) {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "upsert", service: sk.service, api_key: val }),
                                });
                                saved = true;
                              }
                            }
                            if (saved) {
                              setByokMsg(ts.byokSaved);
                              setByokEditing(null);
                              const data = await fetch("/api/api-keys").then((r) => r.json());
                              setApiKeys(data.keys || []);
                            }
                            setByokSaving(false);
                          }}
                          disabled={byokSaving}
                          className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {byokSaving ? "..." : ts.byokSave}
                        </button>
                        <button
                          onClick={() => setByokEditing(null)}
                          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 cursor-pointer"
                        >
                          {tc.cancel}
                        </button>
                        {snovConfigured.length > 0 && (
                          <button
                            onClick={async () => {
                              for (const sk of snovKeys) {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "delete", service: sk.service }),
                                });
                              }
                              setByokMsg(ts.byokDeleted);
                              setByokEditing(null);
                              const data = await fetch("/api/api-keys").then((r) => r.json());
                              setApiKeys(data.keys || []);
                            }}
                            className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                          >
                            {ts.byokDelete}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Cloudflare Worker - 2 keys grouped */}
            {(() => {
              const workerKeys = [
                { service: "worker_url" as const, name: ts.byokWorkerUrl, hint: ts.byokWorkerUrlHint },
                { service: "worker_secret" as const, name: ts.byokWorkerSecret, hint: ts.byokWorkerSecretHint },
              ];
              const workerConfigured = workerKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
              const isEditingWorker = byokEditing === "worker";

              return (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{ts.byokWorker}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${workerConfigured.length === 2 ? "bg-green-100 text-green-800" : workerConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                        {workerConfigured.length === 2 ? ts.byokMasked : workerConfigured.length > 0 ? `${workerConfigured.length}/2` : ts.byokNotSet}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{ts.byokTierFree}</span>
                    </div>
                    {!isEditingWorker && (
                      <button
                        onClick={() => {
                          setByokEditing("worker");
                          setByokKeyInput("");
                        }}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                      >
                        {workerConfigured.length > 0 ? ts.edit : ts.byokSave}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{ts.byokWorkerHint}</p>
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                    {ts.byokWorkerTier}
                  </p>

                  {!isEditingWorker && workerConfigured.length > 0 && (
                    <div className="space-y-1">
                      {workerKeys.map((wk) => {
                        const existing = apiKeys.find((a) => a.service === wk.service);
                        return existing ? (
                          <div key={wk.service} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-36">{wk.name}:</span>
                            <span className="text-sm text-gray-600 font-mono">{existing.masked_key}</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}

                  {isEditingWorker && (
                    <div className="space-y-2 mt-2">
                      {workerKeys.map((wk) => {
                        const existing = apiKeys.find((a) => a.service === wk.service);
                        return (
                          <div key={wk.service}>
                            <label className="text-xs text-gray-500 mb-1 block">{wk.name}</label>
                            <input
                              type={wk.service === "worker_url" ? "text" : "password"}
                              defaultValue=""
                              placeholder={existing ? "••••••••  (leave blank to keep)" : wk.service === "worker_url" ? "https://my-worker.workers.dev" : ts.byokPlaceholder}
                              data-worker-key={wk.service}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                            />
                          </div>
                        );
                      })}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={async () => {
                            setByokSaving(true);
                            try {
                              const inputs = document.querySelectorAll<HTMLInputElement>("[data-worker-key]");
                              let saved = false;
                              for (const input of inputs) {
                                const service = input.getAttribute("data-worker-key");
                                const value = input.value.trim();
                                if (value && service) {
                                  const res = await fetch("/api/api-keys", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "upsert", service, api_key: value }),
                                  });
                                  if (res.ok) saved = true;
                                }
                              }
                              if (saved) {
                                setByokMsg(ts.byokSaved);
                                setByokEditing(null);
                                const data = await fetch("/api/api-keys").then((r) => r.json());
                                setApiKeys(data.keys || []);
                              }
                            } finally {
                              setByokSaving(false);
                              setTimeout(() => setByokMsg(""), 3000);
                            }
                          }}
                          disabled={byokSaving}
                          className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {byokSaving ? "..." : ts.byokSave}
                        </button>
                        <button
                          onClick={() => setByokEditing(null)}
                          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                        >
                          {tc.cancel}
                        </button>
                        {workerConfigured.length > 0 && (
                          <button
                            onClick={async () => {
                              for (const wk of workerKeys) {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "delete", service: wk.service }),
                                });
                              }
                              setByokMsg(ts.byokDeleted);
                              setByokEditing(null);
                              const data = await fetch("/api/api-keys").then((r) => r.json());
                              setApiKeys(data.keys || []);
                              setTimeout(() => setByokMsg(""), 3000);
                            }}
                            className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                          >
                            {ts.byokDelete}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {/* TikTok - 2 keys grouped */}
            {(() => {
              const tiktokKeys = [
                { service: "tiktok_client_key" as const, name: ts.byokTiktokClientKey },
                { service: "tiktok_client_secret" as const, name: ts.byokTiktokClientSecret },
              ];
              const tiktokConfigured = tiktokKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
              const isEditingTiktok = byokEditing === "tiktok";

              return (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{ts.byokTiktok}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tiktokConfigured.length === 2 ? "bg-green-100 text-green-800" : tiktokConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                        {tiktokConfigured.length === 2 ? ts.byokMasked : tiktokConfigured.length > 0 ? `${tiktokConfigured.length}/2` : ts.byokNotSet}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{ts.byokTierFree}</span>
                    </div>
                    {!isEditingTiktok && (
                      <button
                        onClick={() => { setByokEditing("tiktok"); setByokKeyInput(""); }}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                      >
                        {tiktokConfigured.length > 0 ? ts.edit : ts.byokSave}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{ts.byokTiktokHint}</p>
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                    {ts.byokTiktokTier}
                  </p>

                  {!isEditingTiktok && tiktokConfigured.length > 0 && (
                    <div className="space-y-1">
                      {tiktokKeys.map((tk) => {
                        const existing = apiKeys.find((a) => a.service === tk.service);
                        return existing ? (
                          <div key={tk.service} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-36">{tk.name}:</span>
                            <span className="text-sm text-gray-600 font-mono">{existing.masked_key}</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}

                  {isEditingTiktok && (
                    <div className="space-y-2 mt-2">
                      {tiktokKeys.map((tk) => {
                        const existing = apiKeys.find((a) => a.service === tk.service);
                        return (
                          <div key={tk.service}>
                            <label className="text-xs text-gray-500 mb-1 block">{tk.name}</label>
                            <input
                              type="password"
                              defaultValue=""
                              placeholder={existing ? "••••••••  (leave blank to keep)" : ts.byokPlaceholder}
                              data-tiktok-key={tk.service}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                            />
                          </div>
                        );
                      })}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={async () => {
                            setByokSaving(true);
                            try {
                              const inputs = document.querySelectorAll<HTMLInputElement>("[data-tiktok-key]");
                              let saved = false;
                              for (const input of inputs) {
                                const service = input.getAttribute("data-tiktok-key");
                                const value = input.value.trim();
                                if (value && service) {
                                  const res = await fetch("/api/api-keys", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "upsert", service, api_key: value }),
                                  });
                                  if (res.ok) saved = true;
                                }
                              }
                              if (saved) {
                                setByokMsg(ts.byokSaved);
                                setByokEditing(null);
                                const data = await fetch("/api/api-keys").then((r) => r.json());
                                setApiKeys(data.keys || []);
                              }
                            } finally {
                              setByokSaving(false);
                              setTimeout(() => setByokMsg(""), 3000);
                            }
                          }}
                          disabled={byokSaving}
                          className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {byokSaving ? "..." : ts.byokSave}
                        </button>
                        <button
                          onClick={() => setByokEditing(null)}
                          className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                        >
                          {tc.cancel}
                        </button>
                        {tiktokConfigured.length > 0 && (
                          <button
                            onClick={async () => {
                              for (const tk of tiktokKeys) {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "delete", service: tk.service }),
                                });
                              }
                              setByokMsg(ts.byokDeleted);
                              setByokEditing(null);
                              const data = await fetch("/api/api-keys").then((r) => r.json());
                              setApiKeys(data.keys || []);
                              setTimeout(() => setByokMsg(""), 3000);
                            }}
                            className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                          >
                            {ts.byokDelete}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {byokMsg && <p className="text-sm text-green-600 mt-3">{byokMsg}</p>}
        </div>}
        </div>

        {/* ── Organization API Keys (admin/operator only) ── */}
        {orgs.some((o) => o.member_role === "admin" || o.member_role === "operator") && (
        <div id="section-orgkeys" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, orgkeys: !prev.orgkeys }))}
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.orgKeysTitle || "Organization API Keys"}</h2>
              <p className="text-sm text-gray-500">{ts.orgKeysDesc}</p>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.orgkeys ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed.orgkeys && <div className="px-6 pb-6 border-t border-gray-100 pt-4">
            {/* Org selector (only orgs where user is admin/operator) */}
            {(() => {
              const adminOrgs = orgs.filter((o) => o.member_role === "admin" || o.member_role === "operator");
              return adminOrgs.length > 1 ? (
                <div className="mb-4">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">{ts.orgKeysSelectOrg}</label>
                  <select
                    value={selectedOrgForKeys || adminOrgs[0]?.id || ""}
                    onChange={(e) => setSelectedOrgForKeys(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-xs"
                  >
                    {adminOrgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              ) : null;
            })()}

            {(() => {
              const adminOrgs = orgs.filter((o) => o.member_role === "admin" || o.member_role === "operator");
              const activeOrgId = selectedOrgForKeys || adminOrgs[0]?.id;
              if (!activeOrgId) return null;
              const activeOrg = orgs.find((o) => o.id === activeOrgId);

              const services = [
                { service: "openai", name: ts.byokOpenai, hint: ts.byokOpenaiHint, tier: "freemium" as const, tierInfo: ts.byokOpenaiTier },
                { service: "anthropic", name: ts.byokAnthropic, hint: ts.byokAnthropicHint, tier: "freemium" as const, tierInfo: ts.byokAnthropicTier },
                { service: "google", name: ts.byokGoogle, hint: ts.byokGoogleHint, tier: "free" as const, tierInfo: ts.byokGoogleTier },
                { service: "alibaba", name: ts.byokAlibaba, hint: ts.byokAlibabaHint, tier: "free" as const, tierInfo: ts.byokAlibabaTier },
                { service: "cerebras", name: ts.byokCerebras, hint: ts.byokCerebrasHint, tier: "free" as const, tierInfo: ts.byokCerebrasTier },
                { service: "vercel", name: ts.byokVercel, hint: ts.byokVercelHint, tier: "free" as const, tierInfo: ts.byokVercelTier },
                { service: "clawhub", name: ts.byokClawhub, hint: ts.byokClawhubHint, tier: "free" as const, tierInfo: ts.byokClawhubTier },
                { service: "xpilot", name: ts.byokXpilot, hint: ts.byokXpilotHint, tier: "free" as const, tierInfo: ts.byokXpilotTier },
                { service: "blob_token", name: ts.byokBlobToken, hint: ts.byokBlobTokenHint, tier: "free" as const, tierInfo: ts.byokBlobTokenTier },
                { service: "brevo", name: ts.byokBravo, hint: ts.byokBrevoHint, tier: "free" as const, tierInfo: ts.byokBrevoTier },
                { service: "sendgrid", name: ts.byokSendGrid, hint: ts.byokSendGridHint, tier: "free" as const, tierInfo: ts.byokSendGridTier },
                { service: "apollo", name: ts.byokApollo || "Apollo", hint: ts.byokApolloHint, tier: "freemium" as const, tierInfo: ts.byokApolloTier },
                { service: "apify", name: ts.byokApify || "Apify", hint: ts.byokApifyHint, tier: "freemium" as const, tierInfo: ts.byokApifyTier },
                { service: "hunter", name: ts.byokHunter || "Hunter", hint: ts.byokHunterHint, tier: "freemium" as const, tierInfo: ts.byokHunterTier },
              ];

              // Helper: copy a personal key to org
              const copyPersonalToOrg = async (service: string) => {
                try {
                  const revealRes = await fetch("/api/api-keys", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "reveal", service }),
                  });
                  const revealData = await revealRes.json();
                  if (!revealRes.ok || !revealData.api_key) return false;

                  const upsertRes = await fetch("/api/api-keys", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "org_upsert", org_id: activeOrgId, service, api_key: revealData.api_key, label: "Copied from personal" }),
                  });
                  return upsertRes.ok;
                } catch { return false; }
              };

              // Personal keys that exist but org doesn't have
              const personalOnlyServices = services.filter(
                (svc) => apiKeys.some((k) => k.service === svc.service) && !orgKeys.some((k) => k.org_id === activeOrgId && k.service === svc.service)
              );

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400">
                      {activeOrg?.name} — {ts.orgKeysDesc?.split(".")[0] || "Shared keys for the organization"}
                    </p>
                    {personalOnlyServices.length > 0 && (
                      <button
                        onClick={async () => {
                          setOrgKeySaving(true);
                          let count = 0;
                          for (const svc of personalOnlyServices) {
                            const ok = await copyPersonalToOrg(svc.service);
                            if (ok) count++;
                          }
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setOrgKeys(data.orgKeys || []);
                          setOrgKeySaving(false);
                          setOrgKeyMsg(ts.orgKeysCopiedAll?.replace("{count}", String(count)) || `Copied ${count} keys from personal`);
                          setTimeout(() => setOrgKeyMsg(""), 3000);
                        }}
                        disabled={orgKeySaving}
                        className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                        {ts.orgKeysCopyAll || `Copy all personal keys (${personalOnlyServices.length})`}
                      </button>
                    )}
                  </div>
                  {services.map((svc) => {
                    const existing = orgKeys.find((k) => k.org_id === activeOrgId && k.service === svc.service);
                    const personalKey = apiKeys.find((k) => k.service === svc.service);
                    const editKey = `org_${activeOrgId}_${svc.service}`;
                    const isEditing = orgKeyEditing === editKey;

                    return (
                      <div key={svc.service} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold">{svc.name}</h3>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${existing ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                              {existing ? ts.byokMasked : ts.byokNotSet}
                            </span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${svc.tier === "free" ? "bg-blue-100 text-blue-700" : svc.tier === "freemium" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                              {svc.tier === "free" ? ts.byokTierFree : svc.tier === "freemium" ? ts.byokTierFreemium : ts.byokTierPaid}
                            </span>
                          </div>
                        </div>
                        {svc.hint && <p className="text-xs text-gray-400 mb-1">{svc.hint}</p>}
                        {svc.tierInfo && <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                          {svc.tierInfo}
                        </p>}

                        <div className="flex items-center justify-between">
                          {!isEditing && (
                            <div className="flex items-center gap-2">
                              {!existing && personalKey && (
                                <button
                                  onClick={async () => {
                                    setOrgKeySaving(true);
                                    const ok = await copyPersonalToOrg(svc.service);
                                    if (ok) {
                                      const data = await fetch("/api/api-keys").then((r) => r.json());
                                      setOrgKeys(data.orgKeys || []);
                                      setOrgKeyMsg(ts.orgKeysCopied?.replace("{service}", svc.name) || `Copied ${svc.name} from personal`);
                                      setTimeout(() => setOrgKeyMsg(""), 3000);
                                    }
                                    setOrgKeySaving(false);
                                  }}
                                  disabled={orgKeySaving}
                                  className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                                  {ts.orgKeysCopyFromPersonal || "Copy from personal"}
                                </button>
                              )}
                              <button
                                onClick={() => { setOrgKeyEditing(editKey); setOrgKeyInput(""); setOrgKeyLabelInput(existing?.label || ""); }}
                                className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                              >
                                {existing ? ts.edit : ts.byokSave}
                              </button>
                            </div>
                          )}
                        </div>

                        {existing && !isEditing && (
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-gray-600 font-mono">{orgKeyRevealed[editKey] || existing.masked_key}</p>
                            <button
                              onClick={async () => {
                                if (orgKeyRevealed[editKey]) {
                                  setOrgKeyRevealed((prev) => { const n = { ...prev }; delete n[editKey]; return n; });
                                  return;
                                }
                                try {
                                  const res = await fetch("/api/api-keys", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "org_reveal", org_id: activeOrgId, service: svc.service }),
                                  });
                                  const data = await res.json();
                                  if (res.ok && data.api_key) {
                                    setOrgKeyRevealed((prev) => ({ ...prev, [editKey]: data.api_key }));
                                  }
                                } catch { /* ignore */ }
                              }}
                              className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                            >
                              {orgKeyRevealed[editKey] ? ts.byokHide : ts.byokReveal}
                            </button>
                          </div>
                        )}

                        {isEditing && (
                          <div className="mt-2 space-y-2">
                            <input
                              type="text"
                              value={orgKeyInput}
                              onChange={(e) => setOrgKeyInput(e.target.value)}
                              placeholder={ts.byokPlaceholder}
                              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                disabled={orgKeySaving || !orgKeyInput}
                                onClick={async () => {
                                  setOrgKeySaving(true);
                                  try {
                                    await fetch("/api/api-keys", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ action: "org_upsert", org_id: activeOrgId, service: svc.service, api_key: orgKeyInput, label: orgKeyLabelInput || null }),
                                    });
                                    setOrgKeyMsg(ts.orgKeysSaved || "Saved!");
                                    setOrgKeyEditing(null);
                                    const data = await fetch("/api/api-keys").then((r) => r.json());
                                    setOrgKeys(data.orgKeys || []);
                                  } catch { /* ignore */ } finally { setOrgKeySaving(false); setTimeout(() => setOrgKeyMsg(""), 3000); }
                                }}
                                className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                              >
                                {orgKeySaving ? "..." : ts.byokSave}
                              </button>
                              <button onClick={() => setOrgKeyEditing(null)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">{tc.cancel}</button>
                              {existing && (
                                <button
                                  onClick={async () => {
                                    await fetch("/api/api-keys", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ action: "org_delete", org_id: activeOrgId, service: svc.service }),
                                    });
                                    setOrgKeyEditing(null);
                                    setOrgKeyMsg(ts.orgKeysDeleted || "Deleted.");
                                    const data = await fetch("/api/api-keys").then((r) => r.json());
                                    setOrgKeys(data.orgKeys || []);
                                    setTimeout(() => setOrgKeyMsg(""), 3000);
                                  }}
                                  className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                                >
                                  {ts.byokDelete}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {orgKeyMsg && <p className="text-sm text-green-600 mt-3">{orgKeyMsg}</p>}
          </div>}
        </div>
        )}

        {/* ── Platform API Keys ── */}
        <div id="section-apikeys" className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, apikeys: !prev.apikeys }))}
            className="w-full px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <h2 className="text-lg font-semibold">{ts.apiKeysTitle || "Platform API Keys"}</h2>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {platformKeys.filter((k) => !k.revoked_at).length}
              </span>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.apikeys ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed.apikeys && <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-gray-500">{ts.apiKeysDesc || "Create API keys to access AutoClaw resources programmatically via the REST API."}</p>

            {/* Show newly created key */}
            {newKeyResult && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 mb-2">{ts.apiKeyCreated || "API key created! Copy it now — it won't be shown again."}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-green-300 rounded px-3 py-2 text-sm font-mono break-all select-all">{newKeyResult}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(newKeyResult); }}
                    className="px-3 py-2 text-sm bg-green-700 text-white rounded hover:bg-green-800 cursor-pointer shrink-0"
                  >
                    {ts.copy || "Copy"}
                  </button>
                </div>
                <button
                  onClick={() => setNewKeyResult(null)}
                  className="text-xs text-green-600 mt-2 cursor-pointer hover:text-green-800"
                >
                  {ts.apiKeyDismiss || "I've copied it, dismiss"}
                </button>
              </div>
            )}

            {/* Create new key form */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium">{ts.apiKeyCreate || "Create new key"}</h3>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[150px]">
                  <label className="text-xs text-gray-500 block mb-1">{ts.apiKeyName || "Name"}</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder={ts.apiKeyNamePlaceholder || "e.g. My App"}
                    className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{ts.apiKeyScopes || "Scopes"}</label>
                  <div className="flex gap-2">
                    {["read", "write", "admin"].map((s) => (
                      <label key={s} className="flex items-center gap-1 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newKeyScopes.includes(s)}
                          onChange={(e) => {
                            if (e.target.checked) setNewKeyScopes((prev) => [...prev, s]);
                            else setNewKeyScopes((prev) => prev.filter((x) => x !== s));
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="capitalize">{s}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setCreatingKey(true);
                    try {
                      const res = await fetch("/api/api-keys", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "create", name: newKeyName || null, scopes: newKeyScopes }),
                      });
                      const data = await res.json();
                      if (data.key) {
                        setNewKeyResult(data.key);
                        setNewKeyName("");
                        // Refresh list
                        const refreshed = await fetch("/api/api-keys").then((r) => r.json());
                        setPlatformKeys(refreshed.platformKeys || []);
                      }
                    } finally {
                      setCreatingKey(false);
                    }
                  }}
                  disabled={creatingKey || newKeyScopes.length === 0}
                  className="px-4 py-1.5 text-sm bg-red-800 text-white rounded-md hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {creatingKey ? tc.loading : ts.apiKeyGenerate || "Generate Key"}
                </button>
              </div>
            </div>

            {/* Existing keys list */}
            {platformKeys.length > 0 && (
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                {platformKeys.map((pk) => (
                  <div key={pk.id} className={`px-4 py-3 flex items-center justify-between ${pk.revoked_at ? "opacity-50 bg-gray-50" : "bg-white"}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-gray-700">{pk.key_prefix}...</code>
                        {pk.name && <span className="text-sm text-gray-600">{pk.name}</span>}
                        {pk.revoked_at && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{ts.apiKeyRevoked || "Revoked"}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span>{(pk.scopes || []).join(", ")}</span>
                        <span>{ts.apiKeyCreatedAt || "Created"}: {new Date(pk.created_at).toLocaleDateString()}</span>
                        {pk.last_used_at && <span>{ts.apiKeyLastUsed || "Last used"}: {new Date(pk.last_used_at).toLocaleDateString()}</span>}
                        {pk.expires_at && <span>{ts.apiKeyExpires || "Expires"}: {new Date(pk.expires_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    {!pk.revoked_at && (
                      <button
                        onClick={async () => {
                          if (!confirm(ts.apiKeyRevokeConfirm || "Revoke this API key? This action cannot be undone.")) return;
                          await fetch("/api/api-keys", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "revoke", key_id: pk.id }),
                          });
                          const refreshed = await fetch("/api/api-keys").then((r) => r.json());
                          setPlatformKeys(refreshed.platformKeys || []);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 cursor-pointer shrink-0"
                      >
                        {ts.apiKeyRevoke || "Revoke"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {platformKeys.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">{ts.apiKeyNone || "No API keys yet. Create one to get started."}</p>
            )}

            {/* API docs hint */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">
                {ts.apiKeyDocsHint || "Use your API key with"} <code className="bg-blue-100 px-1 rounded">Authorization: Bearer ac_live_...</code> {ts.apiKeyDocsHint2 || "to access"} <code className="bg-blue-100 px-1 rounded">/api/v1/*</code> {ts.apiKeyDocsHint3 || "endpoints."}
              </p>
            </div>
          </div>}
        </div>

      </div>
    </DashboardShell>
  );
}
