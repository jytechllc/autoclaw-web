"use client";

import React from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import type { UserProfile } from "@auth0/nextjs-auth0/client";

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

interface OrgManagementSectionProps {
  collapsed: boolean;
  setCollapsed: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  userPlan: string;
  locale: string;
  orgs: Org[];
  setOrgs: React.Dispatch<React.SetStateAction<Org[]>>;
  orgMembers: Record<number, OrgMember[]>;
  newOrgName: string;
  setNewOrgName: (v: string) => void;
  newOrgDomain: string;
  setNewOrgDomain: (v: string) => void;
  orgCreating: boolean;
  setOrgCreating: (v: boolean) => void;
  orgMsg: string;
  setOrgMsg: (v: string) => void;
  orgMsgType: "success" | "error";
  setOrgMsgType: (v: "success" | "error") => void;
  addMemberEmail: string;
  setAddMemberEmail: (v: string) => void;
  addMemberOrgId: number | null;
  setAddMemberOrgId: (v: number | null) => void;
  addingMember: boolean;
  setAddingMember: (v: boolean) => void;
  assignProjectId: number | null;
  setAssignProjectId: (v: number | null) => void;
  assignOrgId: number | null;
  setAssignOrgId: (v: number | null) => void;
  renamingOrgId: number | null;
  setRenamingOrgId: (v: number | null) => void;
  renameOrgName: string;
  setRenameOrgName: (v: string) => void;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  user: UserProfile | undefined;
  ts: Dictionary["settings"];
  tc: Dictionary["common"];
  loadOrgMembers: (orgId: number) => void;
}

export default function OrgManagementSection({
  collapsed,
  setCollapsed,
  userPlan,
  locale,
  orgs,
  setOrgs,
  orgMembers,
  newOrgName,
  setNewOrgName,
  newOrgDomain,
  setNewOrgDomain,
  orgCreating,
  setOrgCreating,
  orgMsg,
  setOrgMsg,
  orgMsgType,
  setOrgMsgType,
  addMemberEmail,
  setAddMemberEmail,
  addMemberOrgId,
  setAddMemberOrgId,
  addingMember,
  setAddingMember,
  assignProjectId,
  setAssignProjectId,
  assignOrgId,
  setAssignOrgId,
  renamingOrgId,
  setRenamingOrgId,
  renameOrgName,
  setRenameOrgName,
  projects,
  setProjects,
  user,
  ts,
  tc,
  loadOrgMembers,
}: OrgManagementSectionProps) {
  return (
        <div id="section-org" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => setCollapsed((prev) => ({ ...prev, org: !prev.org }))}
            className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold">{ts.orgTitle}</h2>
              <p className="text-sm text-gray-500">{ts.orgDesc}</p>
            </div>
            <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed && <div className="px-6 pb-6 border-t border-gray-100 pt-4">

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
                          <h3 className="font-semibold text-sm">{org.name} <span className="text-[10px] text-gray-400 font-normal">#{org.id}</span></h3>
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
  );
}
