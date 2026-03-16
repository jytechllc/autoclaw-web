"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import { getDictionary, type Locale } from "@/lib/i18n";

interface Contact {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  position: string | null;
  phone: string | null;
  source: string;
  tags: string[];
  notes: string | null;
  project_id: number | null;
  brevo_id: number | null;
  emails_sent: number;
  emails_opened: number;
  emails_clicked: number;
  hard_bounces: number;
  soft_bounces: number;
  last_opened_at: string | null;
  stats_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: number;
  name: string;
}

export default function ContactsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.contactsPage;
  const tc = dict.common;

  const { user } = useUser();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Form state
  const [formEmail, setFormEmail] = useState("");
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formPosition, setFormPosition] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formProjectId, setFormProjectId] = useState("");
  const [formTier, setFormTier] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadContacts(p = page) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (sourceFilter) params.set("source", sourceFilter);
    if (projectFilter) params.set("project_id", projectFilter);
    if (tierFilter) params.set("tier", tierFilter);
    params.set("page", String(p));
    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json();
    setContacts(data.contacts || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setLoading(false);
  }

  useEffect(() => {
    loadContacts();
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []));
  }, []);

  useEffect(() => {
    setPage(1);
    const timer = setTimeout(() => loadContacts(1), 300);
    return () => clearTimeout(timer);
  }, [search, sourceFilter, projectFilter, tierFilter]);

  useEffect(() => {
    loadContacts(page);
  }, [page]);

  function openForm(contact?: Contact) {
    if (contact) {
      setEditing(contact);
      setFormEmail(contact.email);
      setFormFirstName(contact.first_name || "");
      setFormLastName(contact.last_name || "");
      setFormCompany(contact.company || "");
      setFormPosition(contact.position || "");
      setFormPhone(contact.phone || "");
      setFormNotes(contact.notes || "");
      setFormProjectId(contact.project_id?.toString() || "");
      setFormTier((contact as Contact & { tier?: string }).tier || "");
    } else {
      setEditing(null);
      setFormEmail("");
      setFormFirstName("");
      setFormLastName("");
      setFormCompany("");
      setFormPosition("");
      setFormPhone("");
      setFormNotes("");
      setFormProjectId("");
      setFormTier("");
    }
    setShowForm(true);
  }

  async function saveContact() {
    if (!formEmail.trim()) return;
    setSaving(true);
    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: editing ? "update" : "create",
        id: editing?.id,
        email: formEmail.trim(),
        first_name: formFirstName,
        last_name: formLastName,
        company: formCompany,
        position: formPosition,
        phone: formPhone,
        notes: formNotes,
        project_id: formProjectId ? Number(formProjectId) : null,
        tier: formTier || null,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setMsg(t.saved);
    setTimeout(() => setMsg(""), 3000);
    loadContacts();
  }

  async function deleteContact(id: number) {
    if (!confirm(t.deleteConfirm)) return;
    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    setMsg(t.deleted);
    setTimeout(() => setMsg(""), 3000);
    loadContacts();
  }

  async function importFromBrevo() {
    setImporting(true);
    setMsg("");
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_brevo" }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(t.importSuccess.replace("{count}", String(data.imported)));
        loadContacts();
      } else {
        setMsg(t.importError);
      }
    } catch {
      setMsg(t.importError);
    }
    setImporting(false);
    setTimeout(() => setMsg(""), 5000);
  }

  async function syncStats() {
    setSyncing(true);
    setMsg("");
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_stats" }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(t.syncSuccess.replace("{count}", String(data.synced)));
        loadContacts(page);
      }
    } catch { /* ignore */ }
    setSyncing(false);
    setTimeout(() => setMsg(""), 5000);
  }

  function contactQuality(c: Contact): { label: string; color: string } {
    if (!c.stats_synced_at) return { label: t.neverSynced, color: "bg-gray-100 text-gray-500" };
    if (c.emails_sent === 0) return { label: t.qualityInactive, color: "bg-gray-100 text-gray-500" };
    const openRate = c.emails_opened / c.emails_sent;
    if (openRate >= 0.5 || c.emails_clicked > 0) return { label: t.qualityHot, color: "bg-red-100 text-red-700" };
    if (openRate >= 0.2) return { label: t.qualityWarm, color: "bg-yellow-100 text-yellow-700" };
    return { label: t.qualityCold, color: "bg-blue-100 text-blue-600" };
  }

  const tierLabel = (tier: string | null | undefined) => {
    const map: Record<string, { label: string; color: string }> = {
      vip: { label: t.tierVIP, color: "bg-amber-100 text-amber-800" },
      a: { label: t.tierA, color: "bg-red-100 text-red-700" },
      b: { label: t.tierB, color: "bg-blue-100 text-blue-700" },
      c: { label: t.tierC, color: "bg-gray-100 text-gray-600" },
      d: { label: t.tierD, color: "bg-gray-100 text-gray-400" },
    };
    return map[tier || ""] || { label: t.tierUnassigned, color: "bg-gray-50 text-gray-400" };
  };

  const sourceLabel = (s: string) => {
    const map: Record<string, string> = { manual: t.manual, brevo: t.brevo, apollo: t.apollo, hunter: t.hunter, snov: t.snov, import: "Import" };
    return map[s] || s;
  };

  const sourceBadgeColor = (s: string) => {
    const map: Record<string, string> = {
      manual: "bg-gray-100 text-gray-600",
      brevo: "bg-blue-100 text-blue-700",
      apollo: "bg-purple-100 text-purple-700",
      hunter: "bg-orange-100 text-orange-700",
      snov: "bg-green-100 text-green-700",
    };
    return map[s] || "bg-gray-100 text-gray-600";
  };

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{t.title}</h1>
            <p className="text-sm text-gray-500">{t.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={syncStats}
              disabled={syncing}
              className="border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {syncing ? t.syncing : t.syncStats}
            </button>
            <button
              onClick={importFromBrevo}
              disabled={importing}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {importing ? t.importingBrevo : t.importBrevo}
            </button>
            <button
              onClick={() => openForm()}
              className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {t.addContact}
            </button>
          </div>
        </div>

        {msg && (
          <div className="mb-4 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm border border-green-200">
            {msg}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">{t.allContacts}</option>
            <option value="manual">{t.manual}</option>
            <option value="brevo">{t.brevo}</option>
            <option value="apollo">{t.apollo}</option>
            <option value="hunter">{t.hunter}</option>
            <option value="snov">{t.snov}</option>
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">{t.allProjects}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">{t.allTiers}</option>
            <option value="vip">{t.tierVIP}</option>
            <option value="a">{t.tierA}</option>
            <option value="b">{t.tierB}</option>
            <option value="c">{t.tierC}</option>
            <option value="d">{t.tierD}</option>
            <option value="unassigned">{t.tierUnassigned}</option>
          </select>
        </div>

        {/* Stats bar */}
        <div className="text-xs text-gray-400 mb-3">
          {t.total}: {total}
        </div>

        {/* Contacts table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">{tc.loading}</div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t.noContacts}</div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.email}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.firstName}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.lastName}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.company}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.position}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.source}</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">{t.engagement}</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">{t.tier}</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">{t.quality}</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const q = contactQuality(c);
                  const openRate = c.emails_sent > 0 ? Math.round((c.emails_opened / c.emails_sent) * 100) : 0;
                  return (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{c.email}</td>
                    <td className="px-4 py-3">{c.first_name || "—"}</td>
                    <td className="px-4 py-3">{c.last_name || "—"}</td>
                    <td className="px-4 py-3">{c.company || "—"}</td>
                    <td className="px-4 py-3">{c.position || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sourceBadgeColor(c.source)}`}>
                        {sourceLabel(c.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.stats_synced_at ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                          <span title={t.sent}>📤{c.emails_sent}</span>
                          <span title={t.opened}>👁{c.emails_opened}</span>
                          <span title={t.clicked}>🖱{c.emails_clicked}</span>
                          {c.emails_sent > 0 && <span className="text-gray-400">({openRate}%)</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(() => { const ti = tierLabel((c as Contact & { tier?: string }).tier); return (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ti.color}`}>{ti.label}</span>
                      ); })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${q.color}`}>{q.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openForm(c)} className="text-xs text-red-600 hover:text-red-800 mr-3 cursor-pointer">{t.editContact}</button>
                      <button onClick={() => deleteContact(c.id)} className="text-xs text-gray-400 hover:text-red-600 cursor-pointer">{tc.delete}</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              &larr;
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page <= 4) {
                pageNum = i + 1;
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`px-3 py-1.5 text-sm rounded-lg cursor-pointer ${
                    page === pageNum
                      ? "bg-red-700 text-white"
                      : "border border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              &rarr;
            </button>
          </div>
        )}

        {/* Add/Edit modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <h2 className="text-lg font-semibold mb-4">{editing ? t.editContact : t.addContact}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.email} *</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.firstName}</label>
                    <input type="text" value={formFirstName} onChange={(e) => setFormFirstName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.lastName}</label>
                    <input type="text" value={formLastName} onChange={(e) => setFormLastName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.company}</label>
                    <input type="text" value={formCompany} onChange={(e) => setFormCompany(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.position}</label>
                    <input type="text" value={formPosition} onChange={(e) => setFormPosition(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.phone}</label>
                  <input type="tel" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.project}</label>
                  <select value={formProjectId} onChange={(e) => setFormProjectId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.tier}</label>
                  <select value={formTier} onChange={(e) => setFormTier(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                    <option value="">{t.tierUnassigned}</option>
                    <option value="vip">{t.tierVIP}</option>
                    <option value="a">{t.tierA}</option>
                    <option value="b">{t.tierB}</option>
                    <option value="c">{t.tierC}</option>
                    <option value="d">{t.tierD}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.notes}</label>
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tc.cancel}</button>
                <button onClick={saveContact} disabled={saving || !formEmail.trim()} className="bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                  {saving ? "..." : tc.save}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
