"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { getDictionary, type Locale } from "@/lib/i18n";

interface Project {
  id: number;
  name: string;
  website: string;
  description: string;
  ga_property_id: string | null;
  domain: string | null;
  created_at?: string;
}

const EMPTY_FORM = {
  name: "",
  website: "",
  ga_property_id: "",
  description: "",
  domain: "",
};

export default function ProjectsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const tc = dict.common;
  const ts = dict.settings;
  const ta = dict.agentsPage;
  const { user, isLoading: userLoading } = useUser();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    loadProjects();
  }, [user]);

  async function loadProjects() {
    setLoadingProjects(true);
    try {
      const data = await fetch(`/api/projects?_t=${Date.now()}`).then((r) => r.json());
      setProjects(data.projects || []);
    } finally {
      setLoadingProjects(false);
    }
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setEditForm({
      name: project.name || "",
      website: project.website || "",
      ga_property_id: project.ga_property_id || "",
      description: project.description || "",
      domain: project.domain || "",
    });
    setSavedId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_project",
          name: createForm.name.trim(),
          website: createForm.website,
          description: createForm.description,
          domain: createForm.domain || null,
          ga_property_id: createForm.ga_property_id || null,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.project) {
        setProjects((prev) => [data.project, ...prev]);
        setCreateForm(EMPTY_FORM);
        setShowCreateForm(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function saveProject(projectId: number) {
    setSavingId(projectId);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_project",
          project_id: projectId,
          name: editForm.name || undefined,
          website: editForm.website,
          ga_property_id: editForm.ga_property_id || null,
          description: editForm.description,
          domain: editForm.domain || null,
        }),
      });
      if (!res.ok) return;
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId
            ? {
                ...project,
                name: editForm.name || project.name,
                website: editForm.website,
                ga_property_id: editForm.ga_property_id || null,
                description: editForm.description,
                domain: editForm.domain || null,
              }
            : project
        )
      );
      setEditingId(null);
      setSavedId(projectId);
      window.setTimeout(() => setSavedId(null), 2000);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteProject(projectId: number) {
    if (!window.confirm(`Delete project #${projectId}?`)) return;
    setDeletingId(projectId);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_project", project_id: projectId }),
      });
      if (!res.ok) return;
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      if (editingId === projectId) cancelEdit();
    } finally {
      setDeletingId(null);
    }
  }

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">{tc.loading}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{tc.loading}</h1>
          <a href="/auth/login" className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user}>
      <div className="px-4 sm:px-6 py-6 w-full max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{ts.projectsTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">{ts.projectsDesc}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/${locale}/dashboard/agents`} className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
              {tc.agents}
            </Link>
            <Link href={`/${locale}/dashboard/settings`} className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700">
              {tc.settings}
            </Link>
            <button
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="px-4 py-2 text-sm rounded-lg bg-red-800 hover:bg-red-900 text-white font-medium cursor-pointer"
            >
              {showCreateForm ? tc.cancel : ta.newProject}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{tc.projects}</p>
            <p className="text-2xl font-semibold mt-2">{projects.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{ts.gaPropertyId}</p>
            <p className="text-2xl font-semibold mt-2">{projects.filter((project) => project.ga_property_id).length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{ts.domain || "Work Domain"}</p>
            <p className="text-2xl font-semibold mt-2">{projects.filter((project) => project.domain).length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{ts.website}</p>
            <p className="text-2xl font-semibold mt-2">{projects.filter((project) => project.website).length}</p>
          </div>
        </div>

        {showCreateForm && (
          <form onSubmit={createProject} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
            <h2 className="text-lg font-semibold">{ta.createProject}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{ta.projectName}</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{ts.website}</label>
                <input
                  type="url"
                  value={createForm.website}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{ts.domain || "Work Domain"}</label>
                <input
                  type="text"
                  value={createForm.domain}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, domain: e.target.value }))}
                  placeholder="example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">{ts.domainHint}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{ts.gaPropertyId}</label>
                <input
                  type="text"
                  value={createForm.ga_property_id}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, ga_property_id: e.target.value }))}
                  placeholder="e.g. 123456789"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">{ts.gaPropertyIdHint}</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">{ts.description}</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating || !createForm.name.trim()}
                className="bg-red-800 hover:bg-red-900 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                {creating ? tc.loading : tc.create}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateForm(EMPTY_FORM);
                }}
                className="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm cursor-pointer"
              >
                {tc.cancel}
              </button>
            </div>
          </form>
        )}

        {loadingProjects ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            {tc.loading}
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-500 mb-2">{ts.noProjects}</p>
            <p className="text-sm text-gray-400">{ta.noProjectsDesc}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => {
              const isEditing = editingId === project.id;
              return (
                <section key={project.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                    <div>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                          className="font-semibold text-base px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                        />
                      ) : (
                        <h2 className="text-lg font-semibold">{project.name}</h2>
                      )}
                      <p className="text-xs text-gray-400 mt-1">#{project.id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {savedId === project.id && <span className="text-xs text-green-600">{ts.saved}</span>}
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveProject(project.id)}
                            disabled={savingId === project.id}
                            className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {savingId === project.id ? "..." : tc.save}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                          >
                            {tc.cancel}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(project)}
                          className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                        >
                          {ts.edit}
                        </button>
                      )}
                      <button
                        onClick={() => deleteProject(project.id)}
                        disabled={deletingId === project.id}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {deletingId === project.id ? "..." : tc.delete}
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{ts.website}</label>
                        <input
                          type="url"
                          value={editForm.website}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, website: e.target.value }))}
                          placeholder="https://example.com"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{ts.gaPropertyId}</label>
                        <input
                          type="text"
                          value={editForm.ga_property_id}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, ga_property_id: e.target.value }))}
                          placeholder="e.g. 527494560"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                        />
                        <p className="text-xs text-gray-400 mt-1">{ts.gaPropertyIdHint}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{ts.domain || "Work Domain"}</label>
                        <input
                          type="text"
                          value={editForm.domain}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, domain: e.target.value }))}
                          placeholder="example.com"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                        />
                        <p className="text-xs text-gray-400 mt-1">{ts.domainHint}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{ts.description}</label>
                        <textarea
                          value={editForm.description}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-gray-400">{ts.website}</p>
                        <p className="text-sm text-gray-700 break-all">{project.website || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">{ts.gaPropertyId}</p>
                        <p className="text-sm text-gray-700">{project.ga_property_id || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">{ts.domain || "Work Domain"}</p>
                        <p className="text-sm text-gray-700">{project.domain || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">{ts.description}</p>
                        <p className="text-sm text-gray-700">{project.description || "-"}</p>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
