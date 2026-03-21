"use client";

import { useState } from "react";

interface PlatformKey {
  id: number;
  key_prefix: string;
  name: string | null;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface PlatformApiKeysSectionProps {
  platformKeys: PlatformKey[];
  setPlatformKeys: React.Dispatch<React.SetStateAction<PlatformKey[]>>;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  ts: Record<string, any>;
  tc: Record<string, any>;
}

export default function PlatformApiKeysSection({ platformKeys, setPlatformKeys, collapsed, setCollapsed, ts, tc }: PlatformApiKeysSectionProps) {
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read", "write"]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);

  return (
    <div id="section-apikeys" className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
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
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && <div className="px-6 pb-6 space-y-4">
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
  );
}
