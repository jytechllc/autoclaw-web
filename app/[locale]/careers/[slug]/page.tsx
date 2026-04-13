"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";

interface Position {
  id: number;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  required_skills: string | null;
  salary_type?: string;
  visa_sponsorship?: boolean;
  created_at: string;
}

interface OrgInfo {
  name: string;
  slug: string;
}

const T: Record<string, Record<string, string>> = {
  en: {
    careers: "Careers",
    openPositions: "Open Positions",
    noPositions: "No open positions at the moment. Check back later!",
    apply: "Apply Now",
    applyFor: "Apply for",
    department: "Department",
    location: "Location",
    salary: "Salary Range",
    skills: "Required Skills",
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    phone: "Phone",
    resumeUrl: "Resume URL",
    uploadResume: "Upload Resume (PDF, DOC)",
    uploading: "Uploading...",
    uploadFailed: "Upload failed. Please try again.",
    linkedinUrl: "LinkedIn URL",
    coverLetter: "Cover Letter / Message",
    submit: "Submit Application",
    submitting: "Submitting...",
    submitted: "Application submitted! We will review your profile and get back to you.",
    error: "Failed to submit. Please try again.",
    alreadyApplied: "You have already applied for this position.",
    backToPositions: "Back to all positions",
    poweredBy: "Powered by AutoClaw",
    loading: "Loading...",
    notFound: "Organization not found.",
  },
  zh: {
    careers: "招聘",
    openPositions: "开放职位",
    noPositions: "目前没有开放职位，请稍后再来！",
    apply: "立即申请",
    applyFor: "申请职位：",
    department: "部门",
    location: "地点",
    salary: "薪资范围",
    skills: "所需技能",
    firstName: "名",
    lastName: "姓",
    email: "邮箱",
    phone: "电话",
    resumeUrl: "简历链接",
    uploadResume: "上传简历（PDF、DOC）",
    uploading: "上传中...",
    uploadFailed: "上传失败，请重试。",
    linkedinUrl: "LinkedIn 链接",
    coverLetter: "求职信 / 留言",
    submit: "提交申请",
    submitting: "提交中...",
    submitted: "申请已提交！我们会审核您的资料并尽快联系您。",
    error: "提交失败，请重试。",
    alreadyApplied: "您已经申请过此职位。",
    backToPositions: "返回所有职位",
    poweredBy: "由 AutoClaw 提供技术支持",
    loading: "加载中...",
    notFound: "未找到该组织。",
  },
  "zh-TW": {
    careers: "招募",
    openPositions: "開放職位",
    noPositions: "目前沒有開放職位，請稍後再來！",
    apply: "立即申請",
    applyFor: "申請職位：",
    department: "部門",
    location: "地點",
    salary: "薪資範圍",
    skills: "所需技能",
    firstName: "名",
    lastName: "姓",
    email: "電子郵件",
    phone: "電話",
    resumeUrl: "履歷連結",
    uploadResume: "上傳履歷（PDF、DOC）",
    uploading: "上傳中...",
    uploadFailed: "上傳失敗，請重試。",
    linkedinUrl: "LinkedIn 連結",
    coverLetter: "求職信 / 留言",
    submit: "提交申請",
    submitting: "提交中...",
    submitted: "申請已提交！我們會審核您的資料並儘快聯繫您。",
    error: "提交失敗，請重試。",
    alreadyApplied: "您已經申請過此職位。",
    backToPositions: "返回所有職位",
    poweredBy: "由 AutoClaw 提供技術支援",
    loading: "載入中...",
    notFound: "未找到該組織。",
  },
  fr: {
    careers: "Carrières",
    openPositions: "Postes ouverts",
    noPositions: "Aucun poste ouvert pour le moment. Revenez plus tard !",
    apply: "Postuler",
    applyFor: "Postuler pour",
    department: "Département",
    location: "Lieu",
    salary: "Fourchette salariale",
    skills: "Compétences requises",
    firstName: "Prénom",
    lastName: "Nom",
    email: "E-mail",
    phone: "Téléphone",
    resumeUrl: "URL du CV",
    uploadResume: "Télécharger le CV (PDF, DOC)",
    uploading: "Téléchargement...",
    uploadFailed: "Échec du téléchargement. Veuillez réessayer.",
    linkedinUrl: "URL LinkedIn",
    coverLetter: "Lettre de motivation / Message",
    submit: "Envoyer la candidature",
    submitting: "Envoi en cours...",
    submitted: "Candidature envoyée ! Nous examinerons votre profil et reviendrons vers vous.",
    error: "Échec de l'envoi. Veuillez réessayer.",
    alreadyApplied: "Vous avez déjà postulé à ce poste.",
    backToPositions: "Retour aux postes",
    poweredBy: "Propulsé par AutoClaw",
    loading: "Chargement...",
    notFound: "Organisation introuvable.",
  },
};

export default function CareersPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const slug = params.slug as string;
  const t = T[locale] || T.en;

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resumeUrl, setResumeUrl] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/careers?slug=${encodeURIComponent(slug)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setOrg(data.org);
        setPositions(data.positions || []);
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [slug]);

  async function handleUploadResume(file: File) {
    setResumeUploading(true);
    setResumeFile(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("slug", slug);
      const res = await fetch("/api/public/careers/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) {
        setResumeUrl(data.url);
      } else {
        setError(data.error || (t.uploadFailed || "Upload failed"));
        setResumeFile(null);
      }
    } catch {
      setError(t.uploadFailed || "Upload failed");
      setResumeFile(null);
    } finally {
      setResumeUploading(false);
    }
  }

  async function handleSubmit() {
    if (!selectedPosition || !firstName || !email) return;
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/public/careers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        position_id: selectedPosition.id,
        first_name: firstName, last_name: lastName || undefined,
        email, phone: phone || undefined,
        resume_url: resumeUrl || undefined, linkedin_url: linkedinUrl || undefined,
        cover_letter: coverLetter || undefined,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setSubmitted(true);
    } else {
      setError(data.error === "You have already applied for this position" ? t.alreadyApplied : t.error);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <p className="text-gray-500">{t.loading}</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">{t.notFound}</p>
          <Link href={`/${locale}`} className="text-red-700 hover:underline">← Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{org?.name}</h1>
          <p className="text-gray-500 mt-1">{t.careers} — {t.openPositions}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Application form (when a position is selected) */}
        {showForm && selectedPosition && !submitted && (
          <div className="mb-8 bg-white rounded-xl border shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">{t.applyFor} {selectedPosition.title}</h2>
              <button onClick={() => { setShowForm(false); setSelectedPosition(null); setError(""); }} className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">
                ← {t.backToPositions}
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={`${t.firstName} *`} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" required />
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t.lastName} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`${t.email} *`} type="email" className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" required />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phone} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
                <div className="relative">
                  <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:border-red-400 transition">
                    <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                    <span className={resumeFile ? "text-gray-800" : "text-gray-400"}>
                      {resumeUploading ? (t.uploading || "Uploading...") : resumeFile ? resumeFile.name : (t.uploadResume || "Upload Resume (PDF, DOC)")}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadResume(f); }}
                      disabled={resumeUploading}
                    />
                  </label>
                  {resumeUrl && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 text-xs">✓</span>}
                </div>
                <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder={t.linkedinUrl} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} placeholder={t.coverLetter} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 resize-none" />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                onClick={handleSubmit}
                disabled={submitting || !firstName || !email}
                className="bg-red-800 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 transition cursor-pointer"
              >
                {submitting ? t.submitting : t.submit}
              </button>
            </div>
          </div>
        )}

        {/* Success message */}
        {submitted && (
          <div className="mb-8 bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <svg className="w-12 h-12 text-green-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-green-800 font-medium">{t.submitted}</p>
            <button onClick={() => { setSubmitted(false); setShowForm(false); setSelectedPosition(null); setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setResumeUrl(""); setLinkedinUrl(""); setCoverLetter(""); }}
              className="mt-3 text-sm text-green-700 hover:underline cursor-pointer"
            >
              ← {t.backToPositions}
            </button>
          </div>
        )}

        {/* Positions list */}
        {!showForm && !submitted && (
          <>
            {positions.length === 0 ? (
              <div className="text-center py-16 text-gray-400">{t.noPositions}</div>
            ) : (
              <div className="space-y-4">
                {positions.map((p) => (
                  <div key={p.id} id={`position-${p.id}`} className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden scroll-mt-4">
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-gray-900 mb-1">{p.title}</h3>
                          <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-3">
                            {p.department && <span className="flex items-center gap-1">📂 {p.department}</span>}
                            {p.location && <span className="flex items-center gap-1">📍 {p.location}</span>}
                            {(p.salary_min || p.salary_max) && (
                              <span className="flex items-center gap-1">
                                💰 {p.salary_min ? `$${p.salary_min.toLocaleString()}` : "?"} – {p.salary_max ? `$${p.salary_max.toLocaleString()}` : "?"}
                                {" "}/{p.salary_type === "hourly" ? "hr" : p.salary_type === "monthly" ? "mo" : "yr"}
                              </span>
                            )}
                            {p.visa_sponsorship && (
                              <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                                ✓ H1B / Visa Sponsorship
                              </span>
                            )}
                          </div>
                          {p.required_skills && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {p.required_skills.split(",").map((s, i) => (
                                <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{s.trim()}</span>
                              ))}
                            </div>
                          )}
                          {p.description && (
                            <div className="text-sm text-gray-600 prose prose-sm max-w-none">
                              <ReactMarkdown>{p.description}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => { setSelectedPosition(p); setShowForm(true); setSubmitted(false); setError(""); }}
                          className="shrink-0 bg-red-800 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-900 transition cursor-pointer"
                        >
                          {t.apply}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-16 py-6 text-center text-xs text-gray-400">
        {t.poweredBy}
      </footer>
    </div>
  );
}
