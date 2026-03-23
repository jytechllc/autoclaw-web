"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
  source_detail: string | null;
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
  return (
    <Suspense>
      <ContactsPageInner />
    </Suspense>
  );
}

function ContactsPageInner() {
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
  const [importingCSV, setImportingCSV] = useState(false);
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

  // Send email state
  const [sendTarget, setSendTarget] = useState<Contact | null>(null);
  const [emailTemplates, setEmailTemplates] = useState<{ id: number; name: string; subject: string; body_html: string; language: string; category: string }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [aiRecommending, setAiRecommending] = useState(false);
  const [aiRecommendMsg, setAiRecommendMsg] = useState("");

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

  const searchParams = useSearchParams();
  const [trialClaimed, setTrialClaimed] = useState(false);

  useEffect(() => {
    loadContacts();
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []));

    // Auto-claim trial leads if trialToken is present
    const trialToken = searchParams.get("trialToken") || localStorage.getItem("trialToken");
    if (trialToken && !trialClaimed) {
      fetch("/api/trial-leads/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: trialToken }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.claimed > 0) {
            setTrialClaimed(true);
            localStorage.removeItem("trialToken");
            loadContacts();
          }
        })
        .catch(() => {});
    }
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

  async function importCSV(file: File) {
    setImportingCSV(true);
    setMsg("");
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { setMsg(t.csvImportError); setImportingCSV(false); return; }
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const values = line.match(/(".*?"|[^,]*),?/g)?.map((v) => v.replace(/,?$/, "").replace(/^"|"$/g, "").trim()) || [];
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = values[i] || ""; });
        return row;
      });
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_csv", rows, filename: file.name, project_id: projectFilter || null }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(t.csvImportSuccess.replace("{count}", String(data.imported)));
        loadContacts();
      } else {
        setMsg(data.error || t.csvImportError);
      }
    } catch {
      setMsg(t.csvImportError);
    }
    setImportingCSV(false);
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

  // Detect likely language from email domain
  function detectLanguageFromEmail(email: string): string {
    const domain = email.split("@")[1]?.toLowerCase() || "";
    // Country-code TLD mapping
    if (domain.endsWith(".cn") || domain.endsWith(".com.cn")) return "zh";
    if (domain.endsWith(".tw") || domain.endsWith(".com.tw")) return "zh-TW";
    if (domain.endsWith(".hk") || domain.endsWith(".com.hk") || domain.endsWith(".mo")) return "zh-TW";
    if (domain.endsWith(".fr") || domain.endsWith(".co.fr")) return "fr";
    if (domain.endsWith(".jp") || domain.endsWith(".co.jp")) return "ja";
    if (domain.endsWith(".kr") || domain.endsWith(".co.kr")) return "ko";
    if (domain.endsWith(".de") || domain.endsWith(".at") || domain.endsWith(".ch")) return "de";
    if (domain.endsWith(".es") || domain.endsWith(".mx") || domain.endsWith(".ar") || domain.endsWith(".co") || domain.endsWith(".cl")) return "es";
    if (domain.endsWith(".pt") || domain.endsWith(".br") || domain.endsWith(".com.br")) return "pt";
    if (domain.endsWith(".it")) return "it";
    if (domain.endsWith(".ru") || domain.endsWith(".su")) return "ru";
    if (domain.endsWith(".vn")) return "vi";
    if (domain.endsWith(".th")) return "th";
    if (domain.endsWith(".id") || domain.endsWith(".co.id")) return "id";
    if (domain.endsWith(".my") || domain.endsWith(".sg")) return "zh"; // CN-heavy markets
    // Well-known Chinese email providers
    if (/\b(qq\.com|163\.com|126\.com|yeah\.net|sina\.com|sohu\.com|aliyun\.com|foxmail\.com)\b/.test(domain)) return "zh";
    // Default
    return "en";
  }

  function openSendEmail(contact: Contact) {
    setSendTarget(contact);
    setSelectedTemplateId("");
    setSendSubject("");
    setSendBody("");
    // Load templates if not loaded
    if (emailTemplates.length === 0) {
      fetch("/api/email-templates")
        .then((r) => r.json())
        .then((data) => setEmailTemplates(data.templates || []));
    }
  }

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const tpl = emailTemplates.find((t) => t.id === Number(templateId));
    if (!tpl || !sendTarget) return;
    // Apply merge tags
    const replaceTags = (text: string) =>
      text
        .replace(/\{\{firstName\}\}/gi, sendTarget.first_name || "there")
        .replace(/\{\{lastName\}\}/gi, sendTarget.last_name || "")
        .replace(/\{\{company\}\}/gi, sendTarget.company || "your company")
        .replace(/\{\{email\}\}/gi, sendTarget.email || "");
    setSendSubject(replaceTags(tpl.subject));
    setSendBody(replaceTags(tpl.body_html));
  }

  async function sendEmail() {
    if (!sendTarget || !sendSubject.trim() || !sendBody.trim()) return;
    setSendingEmail(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: sendTarget.email,
          toName: [sendTarget.first_name, sendTarget.last_name].filter(Boolean).join(" ") || undefined,
          subject: sendSubject,
          html: sendBody,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(t.sendSuccess);
        setSendTarget(null);
      } else {
        setMsg(t.sendError + (data.error ? `: ${data.error}` : ""));
      }
    } catch {
      setMsg(t.sendError);
    }
    setSendingEmail(false);
    setTimeout(() => setMsg(""), 5000);
  }

  async function aiRecommendTemplate() {
    if (!sendTarget || emailTemplates.length === 0) return;
    setAiRecommending(true);
    setAiRecommendMsg("");
    try {
      const res = await fetch("/api/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_recommend",
          contact: {
            email: sendTarget.email,
            first_name: sendTarget.first_name,
            last_name: sendTarget.last_name,
            company: sendTarget.company,
            position: sendTarget.position,
            emails_sent: sendTarget.emails_sent,
            emails_opened: sendTarget.emails_opened,
            emails_clicked: sendTarget.emails_clicked,
          },
          template_ids: emailTemplates.map((t) => t.id),
        }),
      });
      const data = await res.json();
      if (data.success && data.template_id) {
        applyTemplate(String(data.template_id));
        setAiRecommendMsg(t.aiRecommended.replace("{reason}", data.reason || ""));
      }
    } catch { /* ignore */ }
    setAiRecommending(false);
    setTimeout(() => setAiRecommendMsg(""), 8000);
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
    const map: Record<string, string> = { manual: t.manual, brevo: t.brevo, apollo: t.apollo, hunter: t.hunter, snov: t.snov, csv: t.csv || "CSV", import: "Import" };
    return map[s] || s;
  };

  const sourceBadgeColor = (s: string) => {
    const map: Record<string, string> = {
      manual: "bg-gray-100 text-gray-600",
      brevo: "bg-blue-100 text-blue-700",
      apollo: "bg-purple-100 text-purple-700",
      hunter: "bg-orange-100 text-orange-700",
      snov: "bg-green-100 text-green-700",
      csv: "bg-teal-100 text-teal-700",
    };
    return map[s] || "bg-gray-100 text-gray-600";
  };

  const projectName = (pid: number | null) => {
    if (!pid) return null;
    return projects.find((p) => p.id === pid)?.name || null;
  };

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
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
              className="border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {importing ? t.importingBrevo : t.importBrevo}
            </button>
            <label className={`border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 ${importingCSV ? "opacity-50 pointer-events-none" : ""}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
              {importingCSV ? t.importingCSV : t.importCSV}
              <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = ""; }} />
            </label>
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

        {/* Stats cards */}
        {!loading && contacts.length > 0 && (() => {
          const hotCount = contacts.filter((c) => { const q = contactQuality(c); return q.label === t.qualityHot; }).length;
          const warmCount = contacts.filter((c) => { const q = contactQuality(c); return q.label === t.qualityWarm; }).length;
          const vipCount = contacts.filter((c) => (c as Contact & { tier?: string }).tier === "vip").length;
          const syncedCount = contacts.filter((c) => c.stats_synced_at).length;
          return (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{t.total}</p>
                <p className="text-2xl font-bold text-gray-900">{total}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{t.qualityHot}</p>
                <p className="text-2xl font-bold text-red-600">{hotCount}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{t.qualityWarm}</p>
                <p className="text-2xl font-bold text-yellow-600">{warmCount}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{t.tierVIP}</p>
                <p className="text-2xl font-bold text-amber-600">{vipCount}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">{t.syncStats}</p>
                <p className="text-2xl font-bold text-blue-600">{syncedCount}<span className="text-sm font-normal text-gray-400">/{contacts.length}</span></p>
              </div>
            </div>
          );
        })()}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
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
            <option value="csv">{t.csv || "CSV"}</option>
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

        {/* Contacts table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">{tc.loading}</div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t.noContacts}</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto shadow-sm">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/80">
                  <th className="text-left px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[18%]">{t.email}</th>
                  <th className="text-left px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[8%]">{t.firstName}</th>
                  <th className="text-left px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[8%]">{t.lastName}</th>
                  <th className="text-left px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[12%]">{t.company}</th>
                  <th className="text-left px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[12%]">{t.position}</th>
                  <th className="text-left px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[13%]">{t.source}</th>
                  <th className="text-center px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[12%]">{t.engagement}</th>
                  <th className="text-center px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[6%]">{t.tier}</th>
                  <th className="text-center px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[6%]">{t.quality}</th>
                  <th className="text-right px-4 py-3.5 font-medium text-gray-500 text-xs uppercase tracking-wider w-[9%]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((c) => {
                  const q = contactQuality(c);
                  const openRate = c.emails_sent > 0 ? Math.round((c.emails_opened / c.emails_sent) * 100) : 0;
                  return (
                  <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-xs text-gray-700 truncate block">{c.email}</span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-700 truncate">{c.first_name || "—"}</td>
                    <td className="px-4 py-3.5 text-gray-700 truncate">{c.last_name || "—"}</td>
                    <td className="px-4 py-3.5 text-gray-700 truncate font-medium">{c.company || "—"}</td>
                    <td className="px-4 py-3.5 text-gray-500 truncate">{c.position || "—"}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap inline-block w-fit ${sourceBadgeColor(c.source)}`}>
                          {sourceLabel(c.source)}
                        </span>
                        {(c.source_detail || projectName(c.project_id)) && (
                          <span className="text-[10px] text-gray-400 truncate block max-w-[140px]" title={[projectName(c.project_id), c.source_detail].filter(Boolean).join(" · ")}>
                            {[projectName(c.project_id), c.source_detail].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {c.stats_synced_at ? (
                        <div className="flex items-center justify-center gap-3 text-xs">
                          <div className="flex items-center gap-1 text-gray-500" title={t.sent}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                            <span>{c.emails_sent}</span>
                          </div>
                          <div className="flex items-center gap-1 text-blue-500" title={t.opened}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            <span>{c.emails_opened}</span>
                          </div>
                          <div className="flex items-center gap-1 text-green-500" title={t.clicked}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" /></svg>
                            <span>{c.emails_clicked}</span>
                          </div>
                          {c.emails_sent > 0 && (
                            <span className={`font-medium ${openRate >= 50 ? "text-green-600" : openRate >= 20 ? "text-yellow-600" : "text-gray-400"}`}>
                              {openRate}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {(() => { const ti = tierLabel((c as Contact & { tier?: string }).tier); return (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ti.color}`}>{ti.label}</span>
                      ); })()}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${q.color}`}>{q.label}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <button onClick={() => openSendEmail(c)} className="text-xs text-blue-600 hover:text-blue-800 mr-3 cursor-pointer">{t.sendEmail}</button>
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

        {/* Send Email modal */}
        {sendTarget && (() => {
          const detectedLang = detectLanguageFromEmail(sendTarget.email);
          const langNames: Record<string, string> = { en: "English", zh: "简体中文", "zh-TW": "繁體中文", fr: "Français", ja: "日本語", ko: "한국어", de: "Deutsch", es: "Español", pt: "Português", it: "Italiano", ru: "Русский", vi: "Tiếng Việt", th: "ไทย", id: "Bahasa Indonesia" };
          // Sort templates: matching language first, then others
          const sorted = [...emailTemplates].sort((a, b) => {
            const aMatch = a.language === detectedLang ? 0 : 1;
            const bMatch = b.language === detectedLang ? 0 : 1;
            return aMatch - bMatch;
          });
          return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6">
              <h2 className="text-lg font-semibold mb-1">{t.sendEmail}</h2>
              <div className="flex items-center gap-2 mb-4">
                <p className="text-sm text-gray-500">
                  {sendTarget.first_name || sendTarget.email} {sendTarget.company ? `(${sendTarget.company})` : ""}
                </p>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                  {langNames[detectedLang] || detectedLang}
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">{t.selectTemplate}</label>
                    <button
                      onClick={aiRecommendTemplate}
                      disabled={aiRecommending || emailTemplates.length === 0}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 disabled:opacity-40 cursor-pointer font-medium transition-colors"
                    >
                      {aiRecommending ? t.aiRecommending : t.aiRecommend}
                    </button>
                  </div>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">{emailTemplates.length === 0 ? t.noTemplates : `— ${t.selectTemplate} —`}</option>
                    {sorted.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.language === detectedLang ? "★ " : ""}{`[${tpl.language.toUpperCase()}]`} {tpl.name} — {tpl.subject.substring(0, 50)}
                      </option>
                    ))}
                  </select>
                  {aiRecommendMsg && (
                    <p className="text-[11px] text-purple-600 mt-1">{aiRecommendMsg}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.email}: {sendTarget.email}</label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject *</label>
                  <input
                    type="text"
                    value={sendSubject}
                    onChange={(e) => setSendSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Body *</label>
                  <textarea
                    value={sendBody}
                    onChange={(e) => setSendBody(e.target.value)}
                    rows={8}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setSendTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tc.cancel}</button>
                <button
                  onClick={sendEmail}
                  disabled={sendingEmail || !sendSubject.trim() || !sendBody.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {sendingEmail ? t.sending : t.sendEmail}
                </button>
              </div>
            </div>
          </div>
          );
        })()}

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
