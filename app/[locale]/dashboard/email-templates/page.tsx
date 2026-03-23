"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import { getDictionary, type Locale } from "@/lib/i18n";

function RichTextEditor({ value, onChange, minHeight = 260 }: { value: string; onChange: (html: string) => void; minHeight?: number }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Sync external value changes
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
    isInternalChange.current = false;
  }, [value]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    handleInput();
  };

  const insertLink = () => {
    const url = prompt("URL:");
    if (url) exec("createLink", url);
  };

  const btnClass = "px-2 py-1 text-xs rounded hover:bg-gray-200 text-gray-700 cursor-pointer select-none";

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-red-500">
      <div className="flex flex-wrap gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        <button type="button" onClick={() => exec("bold")} className={btnClass} title="Bold"><b>B</b></button>
        <button type="button" onClick={() => exec("italic")} className={btnClass} title="Italic"><i>I</i></button>
        <button type="button" onClick={() => exec("underline")} className={btnClass} title="Underline"><u>U</u></button>
        <span className="w-px bg-gray-300 mx-1" />
        <button type="button" onClick={() => exec("insertUnorderedList")} className={btnClass} title="Bullet List">&#8226; List</button>
        <button type="button" onClick={() => exec("insertOrderedList")} className={btnClass} title="Numbered List">1. List</button>
        <span className="w-px bg-gray-300 mx-1" />
        <button type="button" onClick={insertLink} className={btnClass} title="Insert Link">Link</button>
        <button type="button" onClick={() => exec("unlink")} className={btnClass} title="Remove Link">Unlink</button>
        <span className="w-px bg-gray-300 mx-1" />
        <button type="button" onClick={() => exec("formatBlock", "h2")} className={btnClass} title="Heading">H</button>
        <button type="button" onClick={() => exec("formatBlock", "p")} className={btnClass} title="Paragraph">P</button>
        <button type="button" onClick={() => exec("removeFormat")} className={btnClass} title="Clear Formatting">Clear</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        className="px-4 py-3 text-sm text-gray-800 leading-relaxed outline-none overflow-auto [&_a]:text-blue-600 [&_a]:underline [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
        style={{ minHeight }}
        dangerouslySetInnerHTML={{ __html: value }}
        suppressContentEditableWarning
      />
    </div>
  );
}

interface Template {
  id: number;
  name: string;
  subject: string;
  body_html: string;
  language: string;
  category: string;
  tags: string[];
  project_id: number | null;
  project_name: string | null;
  agent_id: number | null;
  is_ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: number;
  name: string;
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "fr", label: "Français" },
];

export default function EmailTemplatesPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.emailTemplatesPage;
  const tc = dict.common;

  const { user } = useUser();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [preview, setPreview] = useState<Template | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formLanguage, setFormLanguage] = useState<string>(locale);
  const [formCategory, setFormCategory] = useState("custom");
  const [formProjectId, setFormProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  // AI Generate state
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const [aiProjectId, setAiProjectId] = useState("");
  const [aiLanguage, setAiLanguage] = useState<string>(locale);
  const [aiContext, setAiContext] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Editor mode: "visual" for WYSIWYG, "source" for HTML code
  const [editorMode, setEditorMode] = useState<"visual" | "source">("visual");

  // Translate state
  const [translateSource, setTranslateSource] = useState<Template | null>(null);
  const [translateLang, setTranslateLang] = useState("");
  const [translating, setTranslating] = useState(false);

  async function loadTemplates() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (langFilter) params.set("language", langFilter);
    if (catFilter) params.set("category", catFilter);
    const res = await fetch(`/api/email-templates?${params}`);
    const data = await res.json();
    setTemplates(data.templates || []);
    setLoading(false);
  }

  useEffect(() => {
    loadTemplates();
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadTemplates(), 300);
    return () => clearTimeout(timer);
  }, [search, langFilter, catFilter]);

  function openForm(template?: Template) {
    if (template) {
      setEditing(template);
      setFormName(template.name);
      setFormSubject(template.subject);
      setFormBody(template.body_html);
      setFormLanguage(template.language);
      setFormCategory(template.category);
      setFormProjectId(template.project_id?.toString() || "");
    } else {
      setEditing(null);
      setFormName("");
      setFormSubject("");
      setFormBody("");
      setFormLanguage(locale);
      setFormCategory("custom");
      setFormProjectId("");
    }
    setEditorMode("visual");
    setShowForm(true);
  }

  async function saveTemplate() {
    if (!formName.trim() || !formSubject.trim() || !formBody.trim()) return;
    setSaving(true);
    await fetch("/api/email-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: editing ? "update" : "create",
        id: editing?.id,
        name: formName.trim(),
        subject: formSubject.trim(),
        body_html: formBody.trim(),
        language: formLanguage,
        category: formCategory,
        project_id: formProjectId ? Number(formProjectId) : null,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setMsg(t.saved);
    setTimeout(() => setMsg(""), 3000);
    loadTemplates();
  }

  async function deleteTemplate(id: number) {
    if (!confirm(t.deleteConfirm)) return;
    await fetch("/api/email-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    setMsg(t.deleted);
    setTimeout(() => setMsg(""), 3000);
    loadTemplates();
  }

  async function duplicateTemplate(tpl: Template) {
    await fetch("/api/email-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "duplicate",
        name: `${tpl.name} (copy)`,
        subject: tpl.subject,
        body_html: tpl.body_html,
        language: tpl.language,
        category: tpl.category,
        project_id: tpl.project_id,
        tags: tpl.tags,
      }),
    });
    setMsg(t.duplicated);
    setTimeout(() => setMsg(""), 3000);
    loadTemplates();
  }

  async function aiGenerateTemplates() {
    setAiGenerating(true);
    try {
      const res = await fetch("/api/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_generate",
          project_id: aiProjectId ? Number(aiProjectId) : null,
          language: aiLanguage,
          business_description: aiContext,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(t.aiGenerateSuccess.replace("{count}", String(data.count)));
        setShowAiGenerate(false);
        setAiContext("");
        loadTemplates();
      } else {
        setMsg(t.aiGenerateError + (data.error ? `: ${data.error}` : ""));
      }
    } catch {
      setMsg(t.aiGenerateError);
    }
    setAiGenerating(false);
    setTimeout(() => setMsg(""), 5000);
  }

  function openTranslate(tpl: Template) {
    setTranslateSource(tpl);
    // Default to English if source is not English, otherwise Chinese
    setTranslateLang(tpl.language === "en" ? "zh" : "en");
  }

  async function translateTemplate() {
    if (!translateSource || !translateLang) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_translate",
          id: translateSource.id,
          target_language: translateLang,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(t.translateSuccess);
        setTranslateSource(null);
        loadTemplates();
      } else {
        setMsg(t.translateError + (data.error ? `: ${data.error}` : ""));
      }
    } catch {
      setMsg(t.translateError);
    }
    setTranslating(false);
    setTimeout(() => setMsg(""), 5000);
  }

  // All supported target languages (beyond the 4 UI languages)
  const ALL_LANGUAGES = [
    ...LANGUAGES,
    { value: "ja", label: "日本語" },
    { value: "ko", label: "한국어" },
    { value: "de", label: "Deutsch" },
    { value: "es", label: "Español" },
    { value: "pt", label: "Português" },
    { value: "it", label: "Italiano" },
    { value: "ru", label: "Русский" },
    { value: "ar", label: "العربية" },
    { value: "vi", label: "Tiếng Việt" },
    { value: "th", label: "ไทย" },
    { value: "id", label: "Bahasa Indonesia" },
  ];

  const categoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      cold_outreach: t.cold_outreach,
      follow_up: t.follow_up,
      newsletter: t.newsletter,
      custom: t.custom,
    };
    return map[cat] || cat;
  };

  const categoryColor = (cat: string) => {
    const map: Record<string, string> = {
      cold_outreach: "bg-blue-100 text-blue-700",
      follow_up: "bg-orange-100 text-orange-700",
      newsletter: "bg-green-100 text-green-700",
      custom: "bg-gray-100 text-gray-600",
    };
    return map[cat] || "bg-gray-100 text-gray-600";
  };

  const langLabel = (lang: string) => LANGUAGES.find((l) => l.value === lang)?.label || lang;

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-[1400px] mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{t.title}</h1>
            <p className="text-sm text-gray-500">{t.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAiGenerate(true)}
              className="border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {t.aiGenerate}
            </button>
            <button
              onClick={() => openForm()}
              className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {t.createTemplate}
            </button>
          </div>
        </div>

        {msg && (
          <div className="mb-4 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm border border-green-200">
            {msg}
          </div>
        )}

        {/* Stats */}
        {!loading && templates.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{t.templateCount.replace("{count}", String(templates.length))}</p>
              <p className="text-2xl font-bold text-gray-900">{templates.length}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{t.aiGenerated}</p>
              <p className="text-2xl font-bold text-purple-600">{templates.filter((t) => t.is_ai_generated).length}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{t.language}</p>
              <p className="text-2xl font-bold text-blue-600">{new Set(templates.map((t) => t.language)).size}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{t.category}</p>
              <p className="text-2xl font-bold text-green-600">{new Set(templates.map((t) => t.category)).size}</p>
            </div>
          </div>
        )}

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
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">{t.allLanguages}</option>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">{t.allCategories}</option>
            <option value="cold_outreach">{t.cold_outreach}</option>
            <option value="follow_up">{t.follow_up}</option>
            <option value="newsletter">{t.newsletter}</option>
            <option value="custom">{t.custom}</option>
          </select>
        </div>

        {/* Template cards */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">{tc.loading}</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t.noTemplates}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div key={tpl.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{tpl.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{tpl.subject}</p>
                  </div>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    {tpl.is_ai_generated && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">AI</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${categoryColor(tpl.category)}`}>
                      {categoryLabel(tpl.category)}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-gray-500 line-clamp-3 mb-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: tpl.body_html.substring(0, 200) }} />

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                    {langLabel(tpl.language)}
                  </span>
                  {tpl.project_name && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium truncate max-w-[120px]">
                      {tpl.project_name}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-300 ml-auto">
                    {new Date(tpl.updated_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                  <button onClick={() => setPreview(tpl)} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">{t.preview}</button>
                  <button onClick={() => openForm(tpl)} className="text-xs text-red-600 hover:text-red-800 cursor-pointer">{t.editTemplate}</button>
                  <button onClick={() => duplicateTemplate(tpl)} className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer">{t.duplicateTemplate}</button>
                  <button onClick={() => openTranslate(tpl)} className="text-xs text-purple-600 hover:text-purple-800 cursor-pointer">{t.translate}</button>
                  <button onClick={() => deleteTemplate(tpl.id)} className="text-xs text-gray-400 hover:text-red-600 cursor-pointer ml-auto">{tc.delete}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preview modal */}
        {preview && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              {/* Email header */}
              <div className="p-5 border-b border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">{preview.name}</h2>
                  <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer text-xl">&times;</button>
                </div>
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
                  <p className="text-gray-500"><span className="font-medium text-gray-700">{t.subject}:</span> {preview.subject}</p>
                </div>
              </div>
              {/* Email body rendered as HTML */}
              <div className="p-6">
                <div className="text-sm text-gray-800 leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_br]:block" dangerouslySetInnerHTML={{ __html: preview.body_html }} />
              </div>
              <div className="px-5 pb-4">
                <p className="text-xs text-gray-400">{t.mergeTagsHelp}</p>
              </div>
            </div>
          </div>
        )}

        {/* Translate modal */}
        {translateSource && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-1">{t.translateTo}</h2>
              <p className="text-sm text-gray-500 mb-4">
                {translateSource.name} ({langLabel(translateSource.language)})
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.selectTargetLang}</label>
                  <select
                    value={translateLang}
                    onChange={(e) => setTranslateLang(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {ALL_LANGUAGES.filter((l) => l.value !== translateSource.language).map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] text-gray-400 mb-1">{t.subject}</p>
                  <p className="text-sm text-gray-700">{translateSource.subject}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setTranslateSource(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tc.cancel}</button>
                <button
                  onClick={translateTemplate}
                  disabled={translating || !translateLang}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {translating ? t.translating : t.translate}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI Generate modal */}
        {showAiGenerate && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <h2 className="text-lg font-semibold mb-1">{t.aiGenerate}</h2>
              <p className="text-sm text-gray-500 mb-4">{t.aiGenerateDesc}</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.project}</label>
                  <select value={aiProjectId} onChange={(e) => setAiProjectId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.language}</label>
                  <select value={aiLanguage} onChange={(e) => setAiLanguage(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.businessContext}</label>
                  <textarea
                    value={aiContext}
                    onChange={(e) => setAiContext(e.target.value)}
                    rows={3}
                    placeholder={t.businessContextPlaceholder}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowAiGenerate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tc.cancel}</button>
                <button
                  onClick={aiGenerateTemplates}
                  disabled={aiGenerating}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {aiGenerating ? t.aiGenerating : t.aiGenerate}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create/Edit modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto p-6">
              <h2 className="text-lg font-semibold mb-4">{editing ? t.editTemplate : t.createTemplate}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.name} *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t.subject} *</label>
                  <input
                    type="text"
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-600">{t.body} *</label>
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setEditorMode("visual")}
                        className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${editorMode === "visual" ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500 hover:text-gray-700"}`}
                      >
                        {t.editTemplate}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorMode("source")}
                        className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer ${editorMode === "source" ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500 hover:text-gray-700"}`}
                      >
                        HTML
                      </button>
                    </div>
                  </div>
                  {editorMode === "visual" ? (
                    <RichTextEditor value={formBody} onChange={setFormBody} />
                  ) : (
                    <textarea
                      value={formBody}
                      onChange={(e) => setFormBody(e.target.value)}
                      rows={12}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none font-mono"
                    />
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">{t.mergeTagsHelp}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.language}</label>
                    <select value={formLanguage} onChange={(e) => setFormLanguage(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                      {LANGUAGES.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t.category}</label>
                    <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                      <option value="cold_outreach">{t.cold_outreach}</option>
                      <option value="follow_up">{t.follow_up}</option>
                      <option value="newsletter">{t.newsletter}</option>
                      <option value="custom">{t.custom}</option>
                    </select>
                  </div>
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
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tc.cancel}</button>
                <button onClick={saveTemplate} disabled={saving || !formName.trim() || !formSubject.trim() || !formBody.trim()} className="bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
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
