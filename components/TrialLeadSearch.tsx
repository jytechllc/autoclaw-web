"use client";

import { useState } from "react";
import type { getDictionary } from "@/lib/i18n";

interface MaskedLead {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  position: string;
}

export default function TrialLeadSearch({
  t,
  locale,
}: {
  t: ReturnType<typeof getDictionary>["landing"];
  locale: string;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<MaskedLead[]>([]);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError("");
    setLeads([]);
    setSearched(false);
    try {
      const res = await fetch("/api/trial-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setError(t.trialRateLimited);
      } else if (!res.ok) {
        setError(t.trialError);
      } else {
        setLeads(data.leads || []);
        setSessionToken(data.sessionToken || null);
        if (data.sessionToken) {
          localStorage.setItem("trialToken", data.sessionToken);
        }
      }
    } catch {
      setError(t.trialError);
    }
    setLoading(false);
    setSearched(true);
  }

  const signupUrl = `/auth/login?returnTo=/${locale}/dashboard/contacts${sessionToken ? `?trialToken=${sessionToken}` : ""}`;

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl font-bold mb-3">{t.trialTitle}</h2>
        <p className="text-gray-500 text-lg max-w-2xl mx-auto">{t.trialSubtitle}</p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto mb-8">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.trialPlaceholder}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-8 py-3 rounded-lg font-medium text-base transition-colors cursor-pointer whitespace-nowrap"
        >
          {loading ? t.trialSearching : t.trialSearchBtn}
        </button>
      </form>

      {error && (
        <p className="text-center text-red-600 text-sm mb-4">{error}</p>
      )}

      {searched && leads.length === 0 && !error && (
        <p className="text-center text-gray-400 text-sm">{t.trialNoResults}</p>
      )}

      {leads.length > 0 && (
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">{t.trialResultsTitle}</h3>
            <span className="text-sm text-gray-400">{leads.length} {t.trialResultsCount}</span>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.trialName}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.trialCompany}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.trialPosition}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">{t.trialEmail}</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{lead.firstName} {lead.lastName}</td>
                    <td className="px-4 py-3 text-gray-600">{lead.company}</td>
                    <td className="px-4 py-3 text-gray-600">{lead.position}</td>
                    <td className="px-4 py-3 text-gray-400 blur-[3px] select-none">{lead.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {leads.map((lead, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="font-medium text-gray-800">{lead.firstName} {lead.lastName}</p>
                <p className="text-sm text-gray-500">{lead.position}</p>
                <p className="text-sm text-gray-500">{lead.company}</p>
                <p className="text-sm text-gray-400 blur-[3px] select-none mt-1">{lead.email}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-6 text-center bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-6">
            <p className="text-gray-600 mb-3">{t.trialMaskedHint}</p>
            <a
              href={signupUrl}
              className="inline-block bg-red-700 hover:bg-red-800 text-white px-8 py-3 rounded-lg font-medium text-base transition-colors"
            >
              {t.trialRevealBtn}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
