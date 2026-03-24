"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import { getDictionary, type Locale } from "@/lib/i18n";

interface PendingEmail {
  id: number;
  project_id: number;
  recipient_email: string;
  recipient_name: string;
  sender_email: string;
  sender_name: string;
  subject: string;
  body_html: string;
  provider: string;
  created_at: string;
}

export default function EmailReviewPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.emailReviewPage;
  const tc = dict.common;

  const [emails, setEmails] = useState<PendingEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState("");

  async function fetchEmails() {
    setLoading(true);
    try {
      const res = await fetch("/api/email-review");
      const data = await res.json();
      setEmails(data.emails || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    if (user) fetchEmails();
  }, [user]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === emails.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emails.map((e) => e.id)));
    }
  }

  async function handleApprove() {
    if (selected.size === 0) return;
    if (!confirm(t.confirmApprove.replace("{count}", String(selected.size)))) return;
    setActing(true);
    setMessage("");
    try {
      const res = await fetch("/api/email-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", ids: Array.from(selected) }),
      });
      const data = await res.json();
      setMessage(`${t.approved} (${data.sent} sent, ${data.failed} failed)`);
      setSelected(new Set());
      fetchEmails();
    } catch {
      setMessage("Error approving emails");
    }
    setActing(false);
  }

  async function handleReject() {
    if (selected.size === 0) return;
    if (!confirm(t.confirmReject.replace("{count}", String(selected.size)))) return;
    setActing(true);
    setMessage("");
    try {
      await fetch("/api/email-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", ids: Array.from(selected) }),
      });
      setMessage(t.rejected);
      setSelected(new Set());
      fetchEmails();
    } catch {
      setMessage("Error rejecting emails");
    }
    setActing(false);
  }

  const previewEmail = emails.find((e) => e.id === previewId);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <a href={`/auth/login?returnTo=/${locale}/dashboard/email-review`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
      </div>
    );
  }

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {message && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-2 rounded-lg text-sm">
            {message}
          </div>
        )}

        {loading ? (
          <div className="text-gray-400 text-sm py-8 text-center">{tc.loading}</div>
        ) : emails.length === 0 ? (
          <div className="text-gray-400 text-sm py-12 text-center">{t.noEmails}</div>
        ) : (
          <>
            {/* Action bar */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="text-xs px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {t.selectAll} ({selected.size}/{emails.length})
              </button>
              <button
                onClick={handleApprove}
                disabled={selected.size === 0 || acting}
                className="text-xs px-4 py-1.5 bg-red-800 text-white rounded-md hover:bg-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {acting ? t.approving : t.approveSelected} ({selected.size})
              </button>
              <button
                onClick={handleReject}
                disabled={selected.size === 0 || acting}
                className="text-xs px-4 py-1.5 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.rejectSelected} ({selected.size})
              </button>
            </div>

            {/* Email list */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t.recipient}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t.subject}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 hidden sm:table-cell">Provider</th>
                    <th className="w-20 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map((em) => (
                    <tr key={em.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selected.has(em.id) ? "bg-red-50" : ""}`}>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(em.id)}
                          onChange={() => toggleSelect(em.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 truncate max-w-[200px]">{em.recipient_name || em.recipient_email}</div>
                        {em.recipient_name && <div className="text-xs text-gray-400">{em.recipient_email}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-700 truncate max-w-[300px]">{em.subject}</td>
                      <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{em.provider}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setPreviewId(em.id)}
                          className="text-xs text-red-700 hover:text-red-900 font-medium"
                        >
                          {t.preview}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Preview modal */}
        {previewEmail && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPreviewId(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                <div>
                  <div className="font-medium text-gray-900">{previewEmail.recipient_name || previewEmail.recipient_email}</div>
                  <div className="text-xs text-gray-500">{previewEmail.subject}</div>
                </div>
                <button onClick={() => setPreviewId(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
              </div>
              <div className="p-5 overflow-y-auto max-h-[60vh]">
                <div className="text-xs text-gray-400 mb-3">
                  From: {previewEmail.sender_name} &lt;{previewEmail.sender_email}&gt; &middot; To: {previewEmail.recipient_email}
                </div>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: previewEmail.body_html || "" }} />
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
                <button onClick={() => setPreviewId(null)} className="text-xs px-4 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50">{t.close}</button>
                <button
                  onClick={() => {
                    setSelected((prev) => new Set(prev).add(previewEmail.id));
                    setPreviewId(null);
                  }}
                  className="text-xs px-4 py-1.5 bg-red-800 text-white rounded-md hover:bg-red-900"
                >
                  {t.approveSelected}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
