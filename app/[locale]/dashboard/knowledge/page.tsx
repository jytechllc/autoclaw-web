"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useUser } from "@auth0/nextjs-auth0/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface KBDocument {
  id: number;
  title: string;
  doc_type: string;
  scope: string;
  source_url?: string;
  file_size: number;
  chunk_count: number;
  token_count: number;
  status: string;
  error_message?: string;
  org_name?: string;
  org_id?: number;
  project_id?: number;
  created_at: string;
}

interface Org {
  id: number;
  name: string;
}

interface Project {
  id: number;
  name: string;
}

type Tab = "all" | "org" | "personal" | "project";
type AddMode = null | "upload" | "url" | "text";

const DOC_TYPE_ICONS: Record<string, string> = {
  pdf: "📄",
  docx: "📝",
  text: "📃",
  url: "🔗",
  image: "🖼️",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgePage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.knowledgePage;

  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [usage, setUsage] = useState({ docCount: 0, totalSize: 0, maxDocs: 10, maxSizeMB: 500, totalTokens: 0, totalChunks: 0, blobUsedBytes: 0, blobFiles: 0 });
  const [plan, setPlan] = useState("starter");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");

  // Add form state
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [scope, setScope] = useState<string>("personal");
  const [orgId, setOrgId] = useState<number | null>(null);
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<number | null>(null);
  const [previewChunks, setPreviewChunks] = useState<{ chunk_index: number; content: string; token_count: number }[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editingDoc, setEditingDoc] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editDocType, setEditDocType] = useState("");
  const [editScope, setEditScope] = useState<"personal" | "org" | "project">("personal");
  const [editOrgId, setEditOrgId] = useState<number | null>(null);
  const [editProjectId, setEditProjectId] = useState<number | null>(null);
  const [editingChunk, setEditingChunk] = useState<{ docId: number; index: number } | null>(null);
  const [editChunkContent, setEditChunkContent] = useState("");
  const [chunkSaving, setChunkSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const scopeParam = tab === "all" ? "" : `?scope=${tab}`;
      const res = await fetch(`/api/knowledge-base${scopeParam}`);
      const data = await res.json();
      setDocuments(data.documents || []);
      const loadedOrgs = data.orgs || [];
      setOrgs(loadedOrgs);
      setProjects(data.projects || []);
      setUsage(data.usage || { docCount: 0, totalSize: 0, maxDocs: 10, maxSizeMB: 500, totalTokens: 0, totalChunks: 0, blobUsedBytes: 0, blobFiles: 0 });
      setPlan(data.plan || "starter");
      // Default to org scope if user belongs to an org
      if (!scopeInitialized && loadedOrgs.length > 0) {
        setScope("org");
        setOrgId(loadedOrgs[0].id);
        setScopeInitialized(true);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (user) fetchDocuments();
  }, [user, fetchDocuments]);

  async function handleFileUpload(files: File | File[]) {
    const fileList = Array.isArray(files) ? files : [files];
    setSubmitting(true);
    const errors: string[] = [];
    setUploadProgress({ current: 0, total: fileList.length, fileName: fileList[0]?.name || "", errors: [] });

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      setUploadProgress({ current: i + 1, total: fileList.length, fileName: f.name, errors: [...errors] });
      try {
        const formData = new FormData();
        formData.append("file", f);
        formData.append("scope", scope);
        if (orgId) formData.append("org_id", String(orgId));
        if (projectId) formData.append("project_id", String(projectId));

        const res = await fetch("/api/knowledge-base", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json();
          errors.push(`${f.name}: ${err.error || "Failed"}`);
        }
      } catch {
        errors.push(`${f.name}: Upload failed`);
      }
    }

    setUploadProgress(null);
    setSubmitting(false);
    if (errors.length > 0) {
      alert(errors.join("\n"));
    }
    setAddMode(null);
    fetchDocuments();
  }

  async function handleAddUrl() {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_url", url, scope, org_id: orgId, project_id: projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to add URL");
      } else if (data.status === "error") {
        // Doc saved with error status — show warning but refresh list (user can retry)
        alert(data.error || "Could not extract content from this URL. It has been saved and you can retry later.");
        setUrl("");
        setAddMode(null);
        fetchDocuments();
      } else {
        setUrl("");
        setAddMode(null);
        fetchDocuments();
      }
    } catch {
      alert("Failed to add URL");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddText() {
    if (!textContent.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_text", title: textTitle || "Untitled", text: textContent, scope, org_id: orgId, project_id: projectId }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add text");
      } else {
        setTextTitle("");
        setTextContent("");
        setAddMode(null);
        fetchDocuments();
      }
    } catch {
      alert("Failed to add text");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(docId: number) {
    if (!confirm(t.deleteConfirm)) return;
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", document_id: docId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Delete failed (${res.status}): ${data.error || "unknown error"}`);
        return;
      }
      fetchDocuments();
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleReprocess(docId: number) {
    try {
      await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprocess", document_id: docId }),
      });
      fetchDocuments();
    } catch {
      // ignore
    }
  }

  async function handlePreview(docId: number) {
    if (previewDocId === docId) {
      setPreviewDocId(null);
      setPreviewChunks([]);
      return;
    }
    setPreviewDocId(docId);
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_chunks", document_id: docId }),
      });
      const data = await res.json();
      setPreviewChunks(data.chunks || []);
    } catch {
      setPreviewChunks([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function startEdit(doc: KBDocument) {
    setEditingDoc(doc.id);
    setEditUrl(doc.source_url || "");
    setEditTitle(doc.title);
    setEditDocType(doc.doc_type);
    setEditContent("");
    setEditScope((doc.scope as "personal" | "org" | "project") || "personal");
    setEditOrgId(doc.org_id ?? null);
    setEditProjectId(doc.project_id ?? null);

    // For text/pdf/docx docs, load chunk content to allow editing
    if (doc.doc_type !== "url" && doc.chunk_count > 0) {
      try {
        const res = await fetch("/api/knowledge-base", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_chunks", document_id: doc.id }),
        });
        const data = await res.json();
        if (data.chunks && data.chunks.length > 0) {
          setEditContent(data.chunks.map((c: { content: string }) => c.content).join("\n\n"));
        }
      } catch { /* ignore */ }
    }
  }

  async function handleSaveEdit(docId: number) {
    setEditSaving(true);
    try {
      let res: Response;
      if (editDocType === "url") {
        res = await fetch("/api/knowledge-base", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "edit_url", document_id: docId, title: editTitle, url: editUrl }),
        });
      } else {
        res = await fetch("/api/knowledge-base", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "edit_doc", document_id: docId, title: editTitle, text: editContent || undefined }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to save");
        return;
      }
      // Persist scope/org/project changes
      const assignRes = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_project",
          document_id: docId,
          scope: editScope,
          org_id: editScope === "org" ? editOrgId : null,
          project_id: editScope === "project" ? editProjectId : null,
        }),
      });
      const assignData = await assignRes.json();
      if (!assignRes.ok) {
        alert(assignData.error || "Failed to update assignment");
        return;
      }
      setEditingDoc(null);
      fetchDocuments();
    } catch {
      alert("Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSaveChunk(docId: number, chunkIndex: number) {
    setChunkSaving(true);
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit_chunk", document_id: docId, chunk_index: chunkIndex, content: editChunkContent }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to save chunk");
      } else {
        setEditingChunk(null);
        // Refresh chunks preview
        handlePreview(docId);
      }
    } catch {
      alert("Failed to save chunk");
    } finally {
      setChunkSaving(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFileUpload(files);
  }

  const statusColor = (s: string) => {
    if (s === "ready") return "text-green-600 bg-green-50";
    if (s === "processing") return "text-yellow-600 bg-yellow-50";
    if (s === "error") return "text-red-600 bg-red-50";
    if (s === "queued") return "text-blue-600 bg-blue-50";
    return "text-gray-500 bg-gray-50";
  };

  const statusLabel = (s: string) => {
    if (s === "ready") return t.statusReady;
    if (s === "processing") return t.statusProcessing;
    if (s === "error") return t.statusError;
    if (s === "queued") return t.statusQueued || "Queued";
    return t.statusPending;
  };

  if (!user) {
    return (
      <DashboardShell user={{ email: null }}>
        <div className="p-6 text-center text-gray-500">{dict.dashboard.signInDashboard}</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell user={{ email: user.email }} plan={plan}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {/* LlamaIndex shared banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          <span>{t.kbLlamaindexBanner || "Documents are stored on shared LlamaIndex Cloud. Add your own LlamaIndex key in Settings → API Keys for dedicated storage and unlimited documents."}</span>
        </div>

        {/* Usage bar */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{t.usage}:</span>
            <span className="font-medium">{usage.docCount}/{usage.maxDocs} {t.documents}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{t.storage}:</span>
            <span className="font-medium">{formatSize(usage.totalSize)}/{usage.maxSizeMB >= 1000 ? `${(usage.maxSizeMB / 1000).toFixed(0)}GB` : `${usage.maxSizeMB}MB`}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{t.kbTokens || "Tokens"}:</span>
            <span className="font-medium">{usage.totalTokens.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{t.kbChunks || "Chunks"}:</span>
            <span className="font-medium">{usage.totalChunks.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">{locale === "zh" || locale === "zh-TW" ? "云存储" : "Cloud Storage"}:</span>
            <span className="font-medium">
              {usage.blobUsedBytes > 0 ? formatSize(usage.blobUsedBytes) : "0 MB"} / 500 MB
              {usage.blobFiles > 0 && <span className="text-gray-400 ml-1">({usage.blobFiles} {locale === "zh" || locale === "zh-TW" ? "文件" : "files"})</span>}
            </span>
          </div>
          {usage.docCount >= usage.maxDocs && (
            <span className="text-xs text-amber-600">{t.upgradeHint}</span>
          )}
        </div>

        {/* Tabs + Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(["all", "personal", "org", "project"] as Tab[]).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
                  tab === tb ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tb === "all" ? t.all : tb === "personal" ? t.personal : tb === "org" ? t.org : t.project}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAddMode("upload")} className="px-3 py-1.5 text-sm bg-red-800 text-white rounded-md hover:bg-red-900 transition-colors cursor-pointer">
              {t.upload}
            </button>
            <button onClick={() => setAddMode("url")} className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors cursor-pointer">
              {t.addUrl}
            </button>
            <button onClick={() => setAddMode("text")} className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors cursor-pointer">
              {t.addText}
            </button>
          </div>
        </div>

        {/* Add form */}
        {addMode && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            {/* Scope selector */}
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t.scope}</label>
                <select
                  value={scope}
                  onChange={(e) => { setScope(e.target.value); setOrgId(null); setProjectId(null); }}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                >
                  <option value="personal">{t.scopePersonal}</option>
                  <option value="org">{t.scopeOrg}</option>
                  <option value="project">{t.scopeProject}</option>
                </select>
              </div>
              {scope === "org" && orgs.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t.selectOrg}</label>
                  <select
                    value={orgId || ""}
                    onChange={(e) => setOrgId(parseInt(e.target.value) || null)}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                  >
                    <option value="">--</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}
              {scope === "org" && orgs.length === 0 && (
                <p className="text-xs text-amber-600 self-end pb-1.5">No organizations found. Join or create one in Settings first.</p>
              )}
              {scope === "project" && projects.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t.selectProject}</label>
                  <select
                    value={projectId || ""}
                    onChange={(e) => setProjectId(parseInt(e.target.value) || null)}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                  >
                    <option value="">--</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {scope === "project" && projects.length === 0 && (
                <p className="text-xs text-amber-600 self-end pb-1.5">{t.noDocuments ? "No projects found. Create a project first." : "No projects available."}</p>
              )}
            </div>

            {/* Upload */}
            {addMode === "upload" && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-red-400 bg-red-50" : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <div className="text-3xl mb-2">📁</div>
                <p className="text-sm font-medium text-gray-700">{t.dropHere}</p>
                <p className="text-xs text-gray-400 mt-1">{t.dropHint}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.csv,.png,.jpg,.jpeg,.gif,.webp"
                  multiple
                  className="hidden"
                  onChange={(e) => { const files = e.target.files; if (files && files.length > 0) handleFileUpload(Array.from(files)); }}
                />
              </div>
            )}

            {/* Upload Progress */}
            {uploadProgress && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {locale === "zh" || locale === "zh-TW" ? "上传中" : "Uploading"} ({uploadProgress.current}/{uploadProgress.total})
                  </span>
                  <span className="text-xs text-gray-400">{Math.round(uploadProgress.current / uploadProgress.total * 100)}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                  <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(uploadProgress.current / uploadProgress.total * 100)}%` }} />
                </div>
                <p className="text-xs text-gray-500 truncate">{uploadProgress.fileName}</p>
                {uploadProgress.errors.length > 0 && (
                  <div className="mt-2 text-xs text-red-500">
                    {uploadProgress.errors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* URL */}
            {addMode === "url" && (
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t.urlPlaceholder}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <button
                  onClick={handleAddUrl}
                  disabled={submitting || !url.trim()}
                  className="px-4 py-2 text-sm bg-red-800 text-white rounded-md hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? t.uploading : t.submit}
                </button>
              </div>
            )}

            {/* Text */}
            {addMode === "text" && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  placeholder={t.textTitlePlaceholder}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder={t.textContentPlaceholder}
                  rows={6}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y"
                />
                <button
                  onClick={handleAddText}
                  disabled={submitting || !textContent.trim()}
                  className="px-4 py-2 text-sm bg-red-800 text-white rounded-md hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? t.uploading : t.submit}
                </button>
              </div>
            )}

            <button onClick={() => setAddMode(null)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">
              {dict.common.cancel}
            </button>
          </div>
        )}

        {/* Document list */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">{dict.common.loading}</div>
        ) : documents.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📚</div>
            <p className="text-gray-600 font-medium">{t.noDocuments}</p>
            <p className="text-sm text-gray-400 mt-1">{t.noDocumentsDesc}</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {documents.map((doc) => (
              <div key={doc.id}>
                <div className="p-4 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                  <span className="text-xl mt-0.5">{DOC_TYPE_ICONS[doc.doc_type] || "📄"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 truncate max-w-xs">{doc.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor(doc.status)}`}>
                        {statusLabel(doc.status)}
                      </span>
                      {doc.scope === "org" && doc.org_name && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{doc.org_name}</span>
                      )}
                      {doc.scope === "project" && (
                        <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{t.project}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{doc.doc_type.toUpperCase()}</span>
                      <span>{formatSize(doc.file_size)}</span>
                      {doc.chunk_count > 0 && <span>{doc.chunk_count} {t.chunks}</span>}
                      {doc.token_count > 0 && <span>{doc.token_count.toLocaleString()} tokens</span>}
                      <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                    </div>
                    {doc.status === "error" && doc.error_message && (
                      <p className="text-xs text-red-500 mt-1">{doc.error_message}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {doc.chunk_count > 0 && (
                      <button
                        onClick={() => handlePreview(doc.id)}
                        className={`text-xs cursor-pointer ${previewDocId === doc.id ? "text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"}`}
                      >
                        {previewDocId === doc.id ? "Close" : "Preview"}
                      </button>
                    )}
                    <button
                      onClick={() => editingDoc === doc.id ? setEditingDoc(null) : startEdit(doc)}
                      className={`text-xs cursor-pointer ${editingDoc === doc.id ? "text-gray-900 font-medium" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      {editingDoc === doc.id ? dict.common.cancel : t.edit || "Edit"}
                    </button>
                    {doc.status === "error" && doc.doc_type === "url" && (
                      <button
                        onClick={() => handleReprocess(doc.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
                      >
                        {t.reprocess}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                    >
                      {dict.common.delete}
                    </button>
                  </div>
                </div>
                {editingDoc === doc.id && (
                  <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50">
                    <div className="space-y-2 pt-3">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">{t.textTitlePlaceholder || "Title"}</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">{t.scope || "Scope"}</label>
                          <select
                            value={editScope}
                            onChange={(e) => {
                              const newScope = e.target.value as "personal" | "org" | "project";
                              setEditScope(newScope);
                              if (newScope === "personal") { setEditOrgId(null); setEditProjectId(null); }
                              if (newScope === "org") { setEditProjectId(null); }
                              if (newScope === "project") { setEditOrgId(null); }
                            }}
                            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm cursor-pointer"
                          >
                            <option value="personal">{t.scopePersonal || "Personal"}</option>
                            {orgs.length > 0 && <option value="org">{t.scopeOrg || "Organization"}</option>}
                            {projects.length > 0 && <option value="project">{t.scopeProject || "Project"}</option>}
                          </select>
                        </div>
                        {editScope === "org" && orgs.length > 0 && (
                          <div className="sm:col-span-2">
                            <label className="text-xs text-gray-500 block mb-1">{t.scopeOrg || "Organization"}</label>
                            <select
                              value={editOrgId ?? ""}
                              onChange={(e) => setEditOrgId(e.target.value ? Number(e.target.value) : null)}
                              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm cursor-pointer"
                            >
                              <option value="">— {t.selectOrg || "Select organization"} —</option>
                              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          </div>
                        )}
                        {editScope === "project" && projects.length > 0 && (
                          <div className="sm:col-span-2">
                            <label className="text-xs text-gray-500 block mb-1">{t.scopeProject || "Project"}</label>
                            <select
                              value={editProjectId ?? ""}
                              onChange={(e) => setEditProjectId(e.target.value ? Number(e.target.value) : null)}
                              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm cursor-pointer"
                            >
                              <option value="">— {t.selectProject || "Select project"} —</option>
                              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                      {doc.doc_type === "url" && (
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">URL</label>
                          <input
                            type="url"
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                          />
                        </div>
                      )}
                      {doc.doc_type !== "url" && (
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">{t.contentLabel || "Content"}</label>
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={10}
                            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm font-mono resize-y"
                            placeholder={t.contentPlaceholder || "Document content..."}
                          />
                          <p className="text-[10px] text-gray-400 mt-1">{t.contentEditHint || "Editing content will re-process embeddings."}</p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveEdit(doc.id)}
                          disabled={editSaving || (doc.doc_type === "url" && !editUrl.trim())}
                          className="px-3 py-1.5 text-xs bg-red-800 text-white rounded-md hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {editSaving ? dict.common.loading : t.submit || "Save"}
                        </button>
                        <button
                          onClick={() => setEditingDoc(null)}
                          className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 cursor-pointer"
                        >
                          {dict.common.cancel}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {previewDocId === doc.id && (
                  <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50">
                    {previewLoading ? (
                      <p className="text-xs text-gray-400 py-3">{dict.common.loading}</p>
                    ) : previewChunks.length === 0 ? (
                      <p className="text-xs text-gray-400 py-3">No chunks found.</p>
                    ) : (
                      <div className="space-y-2 pt-3 max-h-96 overflow-y-auto">
                        {previewChunks.map((chunk) => (
                          <div key={chunk.chunk_index} className="bg-white rounded border border-gray-200 p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-mono text-gray-400">Chunk {chunk.chunk_index + 1}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400">{chunk.token_count} tokens</span>
                                <button
                                  onClick={() => {
                                    if (editingChunk?.docId === doc.id && editingChunk?.index === chunk.chunk_index) {
                                      setEditingChunk(null);
                                    } else {
                                      setEditingChunk({ docId: doc.id, index: chunk.chunk_index });
                                      setEditChunkContent(chunk.content);
                                    }
                                  }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer"
                                >
                                  {editingChunk?.docId === doc.id && editingChunk?.index === chunk.chunk_index ? dict.common.cancel : t.edit || "Edit"}
                                </button>
                              </div>
                            </div>
                            {editingChunk?.docId === doc.id && editingChunk?.index === chunk.chunk_index ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editChunkContent}
                                  onChange={(e) => setEditChunkContent(e.target.value)}
                                  rows={6}
                                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-y"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleSaveChunk(doc.id, chunk.chunk_index)}
                                    disabled={chunkSaving || !editChunkContent.trim()}
                                    className="px-2 py-1 text-[10px] bg-red-800 text-white rounded hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                                  >
                                    {chunkSaving ? dict.common.loading : t.submit || "Save"}
                                  </button>
                                  <button
                                    onClick={() => setEditingChunk(null)}
                                    className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700 cursor-pointer"
                                  >
                                    {dict.common.cancel}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-gray-700 leading-relaxed prose prose-xs prose-gray max-w-none prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:text-xs prose-pre:text-[11px] prose-pre:bg-gray-50 prose-pre:p-2 prose-a:text-red-600">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{chunk.content}</ReactMarkdown>
                              </div>
                            )}
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
    </DashboardShell>
  );
}
