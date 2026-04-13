"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import ReactMarkdown from "react-markdown";

type Tab = "candidates" | "positions" | "pipeline";

interface Candidate {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  resume_url: string | null;
  linkedin_url: string | null;
  skills: string | null;
  experience: string | null;
  current_company: string | null;
  status: string;
  source: string;
  tags: string | null;
  notes: string | null;
  position_id: number | null;
  position_title?: string | null;
  created_at: string;
}

interface Position {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_type?: string;
  required_skills: string | null;
  status: string;
  visa_sponsorship?: boolean;
  candidate_count?: number;
  created_at: string;
}

interface Interview {
  id: number;
  candidate_id: number;
  interviewer: string;
  scheduled_at: string;
  duration_minutes: number;
  feedback: string | null;
  rating: number | null;
}

const STATUSES = ["new", "screening", "interview", "offer", "hired", "rejected"] as const;
const PIPELINE_STATUSES = ["new", "screening", "interview", "offer", "hired"] as const;
const SOURCES = ["manual", "linkedin", "referral", "job_board"] as const;

function StatusBadge({ status, t }: { status: string; t: Record<string, string> }) {
  const colors: Record<string, string> = {
    new: "bg-blue-50 text-blue-700",
    screening: "bg-yellow-50 text-yellow-700",
    interview: "bg-purple-50 text-purple-700",
    offer: "bg-green-50 text-green-700",
    hired: "bg-green-100 text-green-800",
    rejected: "bg-red-50 text-red-600",
    draft: "bg-gray-100 text-gray-600",
    open: "bg-green-50 text-green-700",
    closed: "bg-red-50 text-red-600",
  };
  const labels: Record<string, string> = {
    new: t.statusNew, screening: t.statusScreening, interview: t.statusInterview,
    offer: t.statusOffer, hired: t.statusHired, rejected: t.statusRejected,
    draft: t.statusDraft, open: t.statusOpen, closed: t.statusClosed,
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-600"}`}>
      {labels[status] || status}
    </span>
  );
}

export default function RecruitingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.recruitingPage;
  const tc = dict.common;

  const { user, isLoading: userLoading } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get("tab") as Tab) || "candidates");

  // Candidates state
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
  const [expandedCandidate, setExpandedCandidate] = useState<number | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);

  // Positions state
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [showPositionForm, setShowPositionForm] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);

  // Pipeline state
  const [pipeline, setPipeline] = useState<Record<string, Candidate[]>>({});
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [showRejected, setShowRejected] = useState(false);

  // AI generation state
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Compliance check state
  const [complianceResult, setComplianceResult] = useState<{ positionId: number; status: string; issues: { severity: string; category: string; message: string; suggestion: string; fix?: Record<string, unknown> | null; applied?: boolean }[]; summary: string } | null>(null);
  const [complianceChecking, setComplianceChecking] = useState<number | null>(null);

  // Careers link state
  const [careersSlug, setCareersSlug] = useState<string | null>(null);
  const [slugInput, setSlugInput] = useState("");
  const [showSlugForm, setShowSlugForm] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Record<string, string | number | null>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `?tab=${tab}`);
  };

  const fetchCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    const params = new URLSearchParams({ tab: "candidates", page: String(page), search });
    if (statusFilter) params.set("status", statusFilter);
    if (positionFilter) params.set("position_id", positionFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    const res = await fetch(`/api/recruiting?${params}`).then((r) => r.json()).catch(() => ({ candidates: [] }));
    setCandidates(res.candidates || []);
    setTotal(res.total || 0);
    setTotalPages(res.totalPages || 1);
    setCandidatesLoading(false);
  }, [page, search, statusFilter, positionFilter, sourceFilter]);

  const fetchPositions = useCallback(async () => {
    setPositionsLoading(true);
    const res = await fetch("/api/recruiting?tab=positions").then((r) => r.json()).catch(() => ({ positions: [] }));
    setPositions(res.positions || []);
    setPositionsLoading(false);
  }, []);

  const fetchPipeline = useCallback(async () => {
    setPipelineLoading(true);
    const res = await fetch("/api/recruiting?tab=pipeline").then((r) => r.json()).catch(() => ({ pipeline: {} }));
    setPipeline(res.pipeline || {});
    setPipelineLoading(false);
  }, []);

  const fetchInterviews = useCallback(async (candidateId: number) => {
    const res = await fetch(`/api/recruiting?tab=interviews&candidate_id=${candidateId}`).then((r) => r.json()).catch(() => ({ interviews: [] }));
    setInterviews(res.interviews || []);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchPositions();
    // Fetch careers slug
    fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_careers_link" }),
    }).then((r) => r.json()).then((d) => { if (d.slug) setCareersSlug(d.slug); }).catch(() => {});
  }, [user, fetchPositions]);

  useEffect(() => {
    if (!user) return;
    if (activeTab === "candidates") fetchCandidates();
    if (activeTab === "pipeline") fetchPipeline();
  }, [user, activeTab, fetchCandidates, fetchPipeline]);

  useEffect(() => {
    if (expandedCandidate) fetchInterviews(expandedCandidate);
  }, [expandedCandidate, fetchInterviews]);

  // Search debounce
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function saveCandidate(data: Record<string, unknown>) {
    setSaving(true);
    const action = editingCandidate ? "update_candidate" : "create_candidate";
    const payload = editingCandidate ? { ...data, action, id: editingCandidate.id } : { ...data, action };
    const res = await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    setSaving(false);
    if (res.candidate) {
      showToast(t.candidateSaved);
      setShowCandidateForm(false);
      setEditingCandidate(null);
      fetchCandidates();
      if (activeTab === "pipeline") fetchPipeline();
    }
  }

  async function deleteCandidate(id: number) {
    if (!confirm(t.confirmDelete)) return;
    await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_candidate", id }),
    });
    showToast(t.candidateDeleted);
    fetchCandidates();
    if (activeTab === "pipeline") fetchPipeline();
  }

  async function moveCandidate(id: number, status: string) {
    await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move_candidate", id, status }),
    });
    fetchPipeline();
    fetchCandidates();
  }

  async function savePosition(data: Record<string, unknown>) {
    setSaving(true);
    const action = editingPosition ? "update_position" : "create_position";
    const payload = editingPosition ? { ...data, action, id: editingPosition.id } : { ...data, action };
    const res = await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    setSaving(false);
    if (res.position) {
      showToast(t.positionSaved);
      setShowPositionForm(false);
      setEditingPosition(null);
      fetchPositions();
    }
  }

  async function deletePosition(id: number) {
    if (!confirm(t.confirmDelete)) return;
    await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_position", id }),
    });
    showToast(t.positionDeleted);
    fetchPositions();
  }

  async function saveInterview(data: Record<string, unknown>) {
    setSaving(true);
    const res = await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => r.json());
    setSaving(false);
    if (res.interview) {
      showToast(t.interviewSaved);
      if (expandedCandidate) fetchInterviews(expandedCandidate);
    }
  }

  async function deleteInterview(id: number) {
    if (!confirm(t.confirmDelete)) return;
    await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_interview", id }),
    });
    showToast(t.interviewDeleted);
    if (expandedCandidate) fetchInterviews(expandedCandidate);
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    try {
      const res = await fetch("/api/recruiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_positions", prompt: aiPrompt }),
      });
      const data = await res.json();
      if (data.positions) {
        const complianceMsg = data.compliance_notes?.length
          ? `\n\n⚠️ ${t.complianceWarning || "Compliance Notes"}:\n${(data.compliance_notes as string[]).join("\n")}`
          : "";
        if (complianceMsg) {
          alert(`${data.positions.length} ${t.positionSaved}${complianceMsg}`);
        } else {
          showToast(`${data.positions.length} ${t.positionSaved}`);
        }
        setShowAiGenerate(false);
        setAiPrompt("");
        fetchPositions();
        switchTab("positions");
      } else {
        showToast(data.error || "Generation failed");
      }
    } catch {
      showToast("Generation failed");
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleSetSlug() {
    if (!slugInput.trim()) return;
    const res = await fetch("/api/recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_slug", slug: slugInput }),
    });
    const data = await res.json();
    if (data.slug) {
      setCareersSlug(data.slug);
      setShowSlugForm(false);
      showToast("Careers page link set!");
    } else {
      showToast(data.error || "Failed to set slug");
    }
  }

  async function handleComplianceCheck(positionId: number) {
    setComplianceChecking(positionId);
    setComplianceResult(null);
    try {
      const res = await fetch("/api/recruiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_compliance", position_id: positionId }),
      });
      const data = await res.json();
      if (data.compliance) {
        setComplianceResult({ positionId, ...data.compliance });
      } else {
        showToast(data.error || "Check failed");
      }
    } catch {
      showToast("Compliance check failed");
    } finally {
      setComplianceChecking(null);
    }
  }

  if (userLoading) return <DashboardShell user={{ email: null }}><div className="p-8 text-gray-400">{tc.loading}</div></DashboardShell>;
  if (!user) return <DashboardShell user={{ email: null }}><div className="p-8 text-gray-400">Please log in.</div></DashboardShell>;

  return (
    <DashboardShell user={user}>
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{t.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => setShowAiGenerate(!showAiGenerate)}
              className="bg-gradient-to-r from-purple-600 to-red-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition cursor-pointer flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              {t.aiGenerate || "AI Generate"}
            </button>
            {careersSlug ? (
              <a
                href={`/${locale}/careers/${careersSlug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600 cursor-pointer"
              >
                🔗 {t.careersPage || "Careers Page"}
              </a>
            ) : (
              <button
                onClick={() => setShowSlugForm(!showSlugForm)}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600 cursor-pointer"
              >
                {t.setupCareersPage || "Setup Careers Page"}
              </button>
            )}
          </div>
        </div>

        {/* AI Generate Panel */}
        {showAiGenerate && (
          <div className="mb-4 bg-gradient-to-r from-purple-50 to-red-50 border border-purple-200 rounded-xl p-4 sm:p-5">
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              {t.aiGenerateTitle || "Generate positions with AI"}
            </h3>
            <p className="text-xs text-gray-500 mb-3">{t.aiGenerateDesc || "Describe what positions you need. AI will use your project info and knowledge base to create detailed job postings."}</p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={t.aiGeneratePlaceholder || 'e.g. "Recruit 5-6 sales representatives for our Bay Area office"'}
              rows={3}
              className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-white"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAiGenerate}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition cursor-pointer"
              >
                {aiGenerating ? (t.aiGenerating || "Generating...") : (t.aiGenerateBtn || "Generate Positions")}
              </button>
              <button onClick={() => setShowAiGenerate(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">{t.cancel}</button>
            </div>
          </div>
        )}

        {/* Slug Setup */}
        {showSlugForm && (
          <div className="mb-4 bg-white border rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-2">{t.setupCareersPage || "Setup Careers Page"}</h3>
            <p className="text-xs text-gray-500 mb-3">{t.slugDesc || "Set a URL slug for your public careers page. Open positions will be visible at this link."}</p>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-400">/{locale}/careers/</span>
              <input
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="your-company"
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 w-48"
              />
              <button onClick={handleSetSlug} disabled={!slugInput.trim()} className="bg-red-800 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-red-900 disabled:opacity-50 cursor-pointer">{t.save}</button>
              <button onClick={() => setShowSlugForm(false)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">{t.cancel}</button>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm animate-in fade-in">
            {toast}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {(["candidates", "positions", "pipeline"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === tab
                  ? "border-red-600 text-red-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t[tab]}
            </button>
          ))}
        </div>

        {/* ── Candidates Tab ── */}
        {activeTab === "candidates" && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex flex-wrap gap-2 flex-1">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t.searchCandidates}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-48 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                />
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm cursor-pointer">
                  <option value="">{t.allStatuses}</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{(t as Record<string, string>)[`status${s.charAt(0).toUpperCase() + s.slice(1)}`]}</option>)}
                </select>
                <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm cursor-pointer">
                  <option value="">{t.allSources}</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{(t as Record<string, string>)[`source${s.charAt(0).toUpperCase() + s.slice(1).replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`]}</option>)}
                </select>
                {positions.length > 0 && (
                  <select value={positionFilter} onChange={(e) => { setPositionFilter(e.target.value); setPage(1); }} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm cursor-pointer">
                    <option value="">{t.allPositions}</option>
                    {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                )}
              </div>
              <button onClick={() => { setEditingCandidate(null); setFormData({}); setShowCandidateForm(true); }} className="bg-red-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-red-900 transition-colors cursor-pointer shrink-0">
                + {t.addCandidate}
              </button>
            </div>

            {/* Candidate Form Modal */}
            {showCandidateForm && (
              <CandidateForm
                t={t}
                positions={positions}
                initial={editingCandidate}
                saving={saving}
                onSave={saveCandidate}
                onCancel={() => { setShowCandidateForm(false); setEditingCandidate(null); }}
              />
            )}

            {/* Table */}
            {candidatesLoading ? (
              <div className="text-center py-12 text-gray-400">{tc.loading}</div>
            ) : candidates.length === 0 ? (
              <div className="text-center py-12 text-gray-400 bg-white border rounded-xl">{t.noCandidates}</div>
            ) : (
              <>
                <div className="bg-white border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500 text-xs bg-gray-50">
                          <th className="px-4 py-2.5">{t.firstName}</th>
                          <th className="px-4 py-2.5">{t.email}</th>
                          <th className="px-4 py-2.5 hidden md:table-cell">{t.position}</th>
                          <th className="px-4 py-2.5">{t.candidateStatus}</th>
                          <th className="px-4 py-2.5 hidden md:table-cell">{t.source}</th>
                          <th className="px-4 py-2.5 hidden lg:table-cell">{t.currentCompany}</th>
                          <th className="px-4 py-2.5 text-right">{t.actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c) => (
                          <>
                            <tr
                              key={c.id}
                              className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                              onClick={() => setExpandedCandidate(expandedCandidate === c.id ? null : c.id)}
                            >
                              <td className="px-4 py-2.5 font-medium text-gray-800">{c.first_name} {c.last_name || ""}</td>
                              <td className="px-4 py-2.5 text-gray-600">{c.email || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">{c.position_title || "—"}</td>
                              <td className="px-4 py-2.5"><StatusBadge status={c.status} t={t} /></td>
                              <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell capitalize">{c.source}</td>
                              <td className="px-4 py-2.5 text-gray-600 hidden lg:table-cell">{c.current_company || "—"}</td>
                              <td className="px-4 py-2.5 text-right">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingCandidate(c); setShowCandidateForm(true); }}
                                  className="text-xs text-blue-600 hover:underline mr-2 cursor-pointer"
                                >
                                  {t.editCandidate}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteCandidate(c.id); }}
                                  className="text-xs text-red-500 hover:underline cursor-pointer"
                                >
                                  {t.delete}
                                </button>
                              </td>
                            </tr>
                            {expandedCandidate === c.id && (
                              <tr key={`${c.id}-detail`}>
                                <td colSpan={7} className="px-4 py-4 bg-gray-50 border-b">
                                  <CandidateDetail candidate={c} interviews={interviews} t={t} onSaveInterview={saveInterview} onDeleteInterview={deleteInterview} saving={saving} />
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-3 py-1 border rounded-lg disabled:opacity-40 cursor-pointer">Prev</button>
                    <span>Page {page} / {totalPages} ({total})</span>
                    <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="px-3 py-1 border rounded-lg disabled:opacity-40 cursor-pointer">Next</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Positions Tab ── */}
        {activeTab === "positions" && (
          <div className="space-y-4">
            {/* Careers public link banner */}
            {careersSlug && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-green-800">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
                  <span>{t.careersPageLive || "Your public careers page is live:"}</span>
                  <a href={`/${locale}/careers/${careersSlug}`} target="_blank" rel="noreferrer" className="font-medium underline hover:text-green-900">
                    {typeof window !== "undefined" ? window.location.origin : ""}/{locale}/careers/{careersSlug}
                  </a>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${locale}/careers/${careersSlug}`); showToast(t.linkCopied || "Link copied!"); }}
                  className="shrink-0 text-xs px-3 py-1.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition cursor-pointer"
                >
                  {t.copyLink || "Copy Link"}
                </button>
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={() => { setEditingPosition(null); setShowPositionForm(true); }} className="bg-red-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-red-900 transition-colors cursor-pointer">
                + {t.addPosition}
              </button>
            </div>

            {showPositionForm && (
              <PositionForm
                t={t}
                initial={editingPosition}
                saving={saving}
                onSave={savePosition}
                onCancel={() => { setShowPositionForm(false); setEditingPosition(null); }}
              />
            )}

            {positionsLoading ? (
              <div className="text-center py-12 text-gray-400">{tc.loading}</div>
            ) : positions.length === 0 ? (
              <div className="text-center py-12 text-gray-400 bg-white border rounded-xl">{t.noPositions}</div>
            ) : (
              <div className="space-y-4">
                {positions.map((p) => (
                  <div key={p.id} className="bg-white border rounded-xl hover:shadow-md transition-shadow overflow-hidden">
                    {/* Header */}
                    <div className="p-5 pb-3">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-lg font-bold text-gray-900">{p.title}</h3>
                        <StatusBadge status={p.status} t={t} />
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-3">
                        {p.department && <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded">📂 {p.department}</span>}
                        {p.location && <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded">📍 {p.location}</span>}
                        {(p.salary_min || p.salary_max) && (
                          <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded">
                            💰 {p.salary_min ? `$${p.salary_min.toLocaleString()}` : "?"} – {p.salary_max ? `$${p.salary_max.toLocaleString()}` : "?"}
                            {" "}/{(t as Record<string, string>)[`salary${(p.salary_type || "yearly").charAt(0).toUpperCase() + (p.salary_type || "yearly").slice(1)}`] || p.salary_type || "yr"}
                          </span>
                        )}
                        {p.visa_sponsorship && (
                          <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-medium">{t.visaSponsorship || "H1B Sponsorship"} ✓</span>
                        )}
                        <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded">👤 {t.candidateCount}: {p.candidate_count || 0}</span>
                      </div>
                      {p.required_skills && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {p.required_skills.split(",").map((s, i) => (
                            <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs">{s.trim()}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Description */}
                    {p.description && (
                      <div className="px-5 pb-4">
                        <div className="text-sm text-gray-600 prose prose-sm max-w-none max-h-[200px] overflow-y-auto border-t border-gray-100 pt-3">
                          <ReactMarkdown>{p.description}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                    {/* Footer */}
                    <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-xs text-gray-400">{t.createdAt}: {new Date(p.created_at).toLocaleDateString()}</span>
                      <div className="flex gap-3 items-center">
                        {careersSlug && p.status === "open" && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${locale}/careers/${careersSlug}#position-${p.id}`); showToast(t.linkCopied || "Link copied!"); }}
                            className="text-xs text-green-600 hover:underline cursor-pointer flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
                            {t.copyLink || "Copy Link"}
                          </button>
                        )}
                        <button
                          onClick={() => handleComplianceCheck(p.id)}
                          disabled={complianceChecking === p.id}
                          className="text-xs text-purple-600 hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
                          {complianceChecking === p.id ? (t.checking || "Checking...") : (t.checkCompliance || "AI Compliance")}
                        </button>
                        <button onClick={() => { setEditingPosition(p); setShowPositionForm(true); }} className="text-xs text-blue-600 hover:underline cursor-pointer">{t.editPosition}</button>
                        <button onClick={() => deletePosition(p.id)} className="text-xs text-red-500 hover:underline cursor-pointer">{t.delete}</button>
                      </div>
                    </div>
                    {/* Compliance Result */}
                    {complianceResult && complianceResult.positionId === p.id && (
                      <div className={`px-5 py-4 border-t text-sm ${
                        complianceResult.status === "compliant" ? "bg-green-50" : complianceResult.status === "warning" ? "bg-yellow-50" : "bg-red-50"
                      }`}>
                        <div className="flex items-center justify-between mb-3">
                          <span className={`font-semibold text-xs ${
                            complianceResult.status === "compliant" ? "text-green-700" : complianceResult.status === "warning" ? "text-yellow-700" : "text-red-700"
                          }`}>
                            {complianceResult.status === "compliant" ? "✓ " : complianceResult.status === "warning" ? "⚠ " : "✕ "}
                            {complianceResult.summary}
                          </span>
                          <div className="flex items-center gap-2">
                            {complianceResult.issues?.some((issue) => issue.fix && !issue.applied) && (
                              <button
                                onClick={async () => {
                                  const allFixes: Record<string, unknown> = {};
                                  for (const issue of complianceResult.issues) {
                                    if (issue.fix && !issue.applied) Object.assign(allFixes, issue.fix);
                                  }
                                  if (Object.keys(allFixes).length === 0) return;
                                  await fetch("/api/recruiting", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "update_position", id: p.id, ...allFixes }),
                                  });
                                  setComplianceResult({
                                    ...complianceResult,
                                    issues: complianceResult.issues.map((issue) => issue.fix ? { ...issue, applied: true } : issue),
                                  });
                                  fetchPositions();
                                  showToast(t.positionSaved);
                                }}
                                className="text-xs px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition cursor-pointer font-medium"
                              >
                                {t.applyAllFixes || "Apply All Fixes"}
                              </button>
                            )}
                            <button onClick={() => setComplianceResult(null)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">✕</button>
                          </div>
                        </div>
                        {complianceResult.issues?.length > 0 && (
                          <div className="space-y-2">
                            {complianceResult.issues.map((issue, i) => (
                              <div key={i} className={`text-xs rounded-lg px-3 py-2.5 ${
                                issue.applied ? "bg-green-100 text-green-800" : issue.severity === "error" ? "bg-red-100 text-red-800" : issue.severity === "warning" ? "bg-yellow-100 text-yellow-800" : "bg-blue-50 text-blue-800"
                              }`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <span className="font-medium">[{issue.category}]</span> {issue.message}
                                    {issue.suggestion && <p className="mt-0.5 opacity-80">→ {issue.suggestion}</p>}
                                    {issue.fix && (
                                      <p className="mt-1 font-mono text-[10px] opacity-60">
                                        {Object.entries(issue.fix).map(([k, v]) => `${k}: ${typeof v === "string" && String(v).length > 60 ? String(v).slice(0, 60) + "..." : String(v)}`).join(", ")}
                                      </p>
                                    )}
                                  </div>
                                  {issue.fix && !issue.applied && (
                                    <button
                                      onClick={async () => {
                                        await fetch("/api/recruiting", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ action: "update_position", id: p.id, ...issue.fix }),
                                        });
                                        const updated = [...complianceResult.issues];
                                        updated[i] = { ...updated[i], applied: true };
                                        setComplianceResult({ ...complianceResult, issues: updated });
                                        fetchPositions();
                                        showToast(t.positionSaved);
                                      }}
                                      className="shrink-0 text-[10px] px-2 py-1 bg-white border border-current rounded hover:opacity-80 transition cursor-pointer font-medium"
                                    >
                                      {t.applyFix || "Apply"}
                                    </button>
                                  )}
                                  {issue.applied && (
                                    <span className="shrink-0 text-[10px] text-green-700 font-medium">✓ {t.applied || "Applied"}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Pipeline Tab ── */}
        {activeTab === "pipeline" && (
          <div>
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowRejected(!showRejected)} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition cursor-pointer">
                {showRejected ? t.hideRejected : t.showRejected}
              </button>
            </div>

            {pipelineLoading ? (
              <div className="text-center py-12 text-gray-400">{tc.loading}</div>
            ) : (
              <div className={`hidden md:grid gap-3 ${showRejected ? "grid-cols-6" : "grid-cols-5"}`}>
                {(showRejected ? STATUSES : PIPELINE_STATUSES).map((status) => {
                  const items = pipeline[status] || [];
                  const headerColors: Record<string, string> = {
                    new: "bg-blue-50 text-blue-800",
                    screening: "bg-yellow-50 text-yellow-800",
                    interview: "bg-purple-50 text-purple-800",
                    offer: "bg-green-50 text-green-800",
                    hired: "bg-green-100 text-green-900",
                    rejected: "bg-red-50 text-red-800",
                  };
                  return (
                    <div key={status} className="flex flex-col">
                      <div className={`rounded-t-lg px-3 py-2 ${headerColors[status] || "bg-gray-100"}`}>
                        <span className="font-semibold text-sm">
                          {(t as Record<string, string>)[`status${status.charAt(0).toUpperCase() + status.slice(1)}`]}
                        </span>
                        <span className="ml-2 text-xs opacity-70">({items.length})</span>
                      </div>
                      <div className="bg-gray-50 rounded-b-lg border border-gray-200 border-t-0 p-2 space-y-2 min-h-[200px] flex-1">
                        {items.map((c) => (
                          <div key={c.id} className="bg-white rounded-md border border-gray-200 p-3 shadow-sm">
                            <p className="font-medium text-sm text-gray-800">{c.first_name} {c.last_name || ""}</p>
                            {c.position_title && <p className="text-xs text-gray-500 mt-0.5">{c.position_title}</p>}
                            {c.current_company && <p className="text-xs text-gray-400">{c.current_company}</p>}
                            <div className="flex gap-1 mt-2">
                              {STATUSES.indexOf(status) > 0 && (
                                <button
                                  onClick={() => moveCandidate(c.id, STATUSES[STATUSES.indexOf(status) - 1])}
                                  className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded transition cursor-pointer"
                                  title={`← ${(t as Record<string, string>)[`status${STATUSES[STATUSES.indexOf(status) - 1].charAt(0).toUpperCase() + STATUSES[STATUSES.indexOf(status) - 1].slice(1)}`]}`}
                                >
                                  ←
                                </button>
                              )}
                              {STATUSES.indexOf(status) < STATUSES.length - 1 && (
                                <button
                                  onClick={() => moveCandidate(c.id, STATUSES[STATUSES.indexOf(status) + 1])}
                                  className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded transition cursor-pointer"
                                  title={`→ ${(t as Record<string, string>)[`status${STATUSES[STATUSES.indexOf(status) + 1].charAt(0).toUpperCase() + STATUSES[STATUSES.indexOf(status) + 1].slice(1)}`]}`}
                                >
                                  →
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mobile pipeline */}
            <div className="md:hidden space-y-4">
              {(showRejected ? STATUSES : PIPELINE_STATUSES).map((status) => {
                const items = pipeline[status] || [];
                if (items.length === 0) return null;
                return (
                  <div key={status}>
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">
                      {(t as Record<string, string>)[`status${status.charAt(0).toUpperCase() + status.slice(1)}`]} ({items.length})
                    </h3>
                    <div className="space-y-2">
                      {items.map((c) => (
                        <div key={c.id} className="bg-white rounded-lg border p-3 flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm">{c.first_name} {c.last_name || ""}</p>
                            {c.position_title && <p className="text-xs text-gray-500">{c.position_title}</p>}
                          </div>
                          <div className="flex gap-1">
                            {STATUSES.indexOf(status) > 0 && (
                              <button onClick={() => moveCandidate(c.id, STATUSES[STATUSES.indexOf(status) - 1])} className="text-xs px-2 py-1 bg-gray-100 rounded cursor-pointer">←</button>
                            )}
                            {STATUSES.indexOf(status) < STATUSES.length - 1 && (
                              <button onClick={() => moveCandidate(c.id, STATUSES[STATUSES.indexOf(status) + 1])} className="text-xs px-2 py-1 bg-gray-100 rounded cursor-pointer">→</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

// ── Candidate Form ──
function CandidateForm({ t, positions, initial, saving, onSave, onCancel }: {
  t: Record<string, string>;
  positions: Position[];
  initial: Candidate | null;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(initial?.first_name || "");
  const [lastName, setLastName] = useState(initial?.last_name || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [resumeUrl, setResumeUrl] = useState(initial?.resume_url || "");
  const [linkedinUrl, setLinkedinUrl] = useState(initial?.linkedin_url || "");
  const [skills, setSkills] = useState(initial?.skills || "");
  const [experience, setExperience] = useState(initial?.experience || "");
  const [currentCompany, setCurrentCompany] = useState(initial?.current_company || "");
  const [positionId, setPositionId] = useState<string>(initial?.position_id ? String(initial.position_id) : "");
  const [source, setSource] = useState(initial?.source || "manual");
  const [notes, setNotes] = useState(initial?.notes || "");

  return (
    <div className="bg-white border rounded-xl p-4 sm:p-6 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial ? t.editCandidate : t.addCandidate}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t.firstName} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t.lastName} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email} type="email" className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phone} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} placeholder={t.resumeUrl} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder={t.linkedinUrl} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} placeholder={t.currentCompany} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <select value={positionId} onChange={(e) => setPositionId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer">
          <option value="">{t.allPositions}</option>
          {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer">
          {SOURCES.map((s) => <option key={s} value={s}>{(t as Record<string, string>)[`source${s.charAt(0).toUpperCase() + s.slice(1).replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`]}</option>)}
        </select>
      </div>
      <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={t.skills} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
      <textarea value={experience} onChange={(e) => setExperience(e.target.value)} placeholder={t.experience} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 resize-none" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.notes} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 resize-none" />
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onSave({
            first_name: firstName, last_name: lastName || undefined, email, phone: phone || undefined,
            resume_url: resumeUrl || undefined, linkedin_url: linkedinUrl || undefined,
            skills: skills || undefined, experience: experience || undefined,
            current_company: currentCompany || undefined,
            position_id: positionId ? Number(positionId) : undefined,
            source, notes: notes || undefined,
          })}
          disabled={saving || !firstName || !email}
          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
        >
          {saving ? "..." : t.save}
        </button>
        <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">{t.cancel}</button>
      </div>
    </div>
  );
}

// ── Position Form ──
function PositionForm({ t, initial, saving, onSave, onCancel }: {
  t: Record<string, string>;
  initial: Position | null;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [department, setDepartment] = useState(initial?.department || "");
  const [location, setLocation] = useState(initial?.location || "");
  const [salaryMin, setSalaryMin] = useState(initial?.salary_min ? String(initial.salary_min) : "");
  const [salaryMax, setSalaryMax] = useState(initial?.salary_max ? String(initial.salary_max) : "");
  const [requiredSkills, setRequiredSkills] = useState(initial?.required_skills || "");
  const [status, setStatus] = useState(initial?.status || "draft");
  const [salaryType, setSalaryType] = useState(initial?.salary_type || "yearly");
  const [visaSponsorship, setVisaSponsorship] = useState(initial?.visa_sponsorship || false);
  const [aiRewriting, setAiRewriting] = useState(false);

  async function handleAiRewrite() {
    setAiRewriting(true);
    try {
      const res = await fetch("/api/recruiting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite_description",
          title, description, department, location,
          salary_min: salaryMin ? Number(salaryMin) : undefined,
          salary_max: salaryMax ? Number(salaryMax) : undefined,
          salary_type: salaryType, required_skills: requiredSkills,
          visa_sponsorship: visaSponsorship,
        }),
      });
      const data = await res.json();
      if (data.description) {
        setDescription(data.description);
      }
    } catch { /* ignore */ }
    setAiRewriting(false);
  }

  return (
    <div className="bg-white border rounded-xl p-4 sm:p-6 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial ? t.editPosition : t.addPosition}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.positionTitle} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder={t.department} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t.location} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer">
          <option value="draft">{t.statusDraft}</option>
          <option value="open">{t.statusOpen}</option>
          <option value="closed">{t.statusClosed}</option>
        </select>
        <div className="flex gap-2">
          <input value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder={t.salaryMin} type="number" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
          <input value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder={t.salaryMax} type="number" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
        </div>
        <select value={salaryType} onChange={(e) => setSalaryType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer">
          <option value="hourly">{t.salaryHourly || "Hourly"}</option>
          <option value="monthly">{t.salaryMonthly || "Monthly"}</option>
          <option value="yearly">{t.salaryYearly || "Yearly"}</option>
        </select>
      </div>
      <input value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} placeholder={t.requiredSkills} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={visaSponsorship} onChange={(e) => setVisaSponsorship(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer" />
        <span className="text-sm text-gray-700">{t.visaSponsorship || "H1B / Visa Sponsorship Available"}</span>
      </label>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700">{t.description}</label>
          <button
            type="button"
            onClick={handleAiRewrite}
            disabled={aiRewriting || !title}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 disabled:opacity-50 transition cursor-pointer font-medium border border-purple-200"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
            {aiRewriting ? (t.aiRewriting || "Rewriting...") : description ? (t.aiRewrite || "AI Rewrite") : (t.aiWrite || "AI Write")}
          </button>
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.description} rows={12} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 resize-y min-h-[200px]" />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onSave({
            title, description: description || undefined, department: department || undefined,
            location: location || undefined, salary_min: salaryMin ? Number(salaryMin) : undefined,
            salary_max: salaryMax ? Number(salaryMax) : undefined, salary_type: salaryType,
            required_skills: requiredSkills || undefined, status, visa_sponsorship: visaSponsorship,
          })}
          disabled={saving || !title}
          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
        >
          {saving ? "..." : t.save}
        </button>
        <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">{t.cancel}</button>
      </div>
    </div>
  );
}

// ── Candidate Detail (expanded row) ──
function CandidateDetail({ candidate, interviews, t, onSaveInterview, onDeleteInterview, saving }: {
  candidate: Candidate;
  interviews: Interview[];
  t: Record<string, string>;
  onSaveInterview: (data: Record<string, unknown>) => void;
  onDeleteInterview: (id: number) => void;
  saving: boolean;
}) {
  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [interviewer, setInterviewer] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState("60");

  return (
    <div className="space-y-4">
      {/* Candidate fields */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {candidate.phone && <div><span className="text-gray-400">{t.phone}:</span> <span className="text-gray-700">{candidate.phone}</span></div>}
        {candidate.skills && <div><span className="text-gray-400">{t.skills}:</span> <span className="text-gray-700">{candidate.skills}</span></div>}
        {candidate.experience && <div className="col-span-2"><span className="text-gray-400">{t.experience}:</span> <span className="text-gray-700">{candidate.experience}</span></div>}
        {candidate.linkedin_url && <div className="col-span-2"><span className="text-gray-400">{t.linkedinUrl}:</span> <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{candidate.linkedin_url}</a></div>}
        {candidate.resume_url && (
          <div className="col-span-2">
            <a href={candidate.resume_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
              {t.resumeUrl}
            </a>
          </div>
        )}
        {candidate.notes && <div className="col-span-4"><span className="text-gray-400">{t.notes}:</span> <span className="text-gray-700">{candidate.notes}</span></div>}
      </div>

      {/* Interviews */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-sm text-gray-800">{t.interviews}</h4>
          <button onClick={() => setShowInterviewForm(!showInterviewForm)} className="text-xs text-red-700 hover:underline cursor-pointer">
            + {t.addInterview}
          </button>
        </div>

        {showInterviewForm && (
          <div className="bg-white border rounded-lg p-3 mb-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder={t.interviewer} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs outline-none" />
              <input value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} type="datetime-local" className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs outline-none" />
              <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t.durationMinutes} type="number" className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs outline-none" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onSaveInterview({ action: "create_interview", candidate_id: candidate.id, interviewer, scheduled_at: scheduledAt, duration_minutes: Number(duration) || 60 });
                  setShowInterviewForm(false);
                  setInterviewer("");
                  setScheduledAt("");
                }}
                disabled={saving || !interviewer || !scheduledAt}
                className="bg-red-800 text-white px-3 py-1 rounded text-xs disabled:opacity-50 cursor-pointer"
              >
                {t.save}
              </button>
              <button onClick={() => setShowInterviewForm(false)} className="px-3 py-1 border rounded text-xs cursor-pointer">{t.cancel}</button>
            </div>
          </div>
        )}

        {interviews.length === 0 ? (
          <p className="text-xs text-gray-400">{t.noInterviews}</p>
        ) : (
          <div className="space-y-2">
            {interviews.map((iv) => (
              <div key={iv.id} className="bg-white border rounded-lg p-3 flex items-start justify-between">
                <div className="text-xs space-y-0.5">
                  <p className="font-medium text-gray-800">{iv.interviewer}</p>
                  <p className="text-gray-500">{new Date(iv.scheduled_at).toLocaleString()} · {iv.duration_minutes} min</p>
                  {iv.rating && <p className="text-yellow-600">{"★".repeat(iv.rating)}{"☆".repeat(5 - iv.rating)}</p>}
                  {iv.feedback && <p className="text-gray-600 mt-1">{iv.feedback}</p>}
                </div>
                <button onClick={() => onDeleteInterview(iv.id)} className="text-xs text-red-500 hover:underline cursor-pointer">{t.delete}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
