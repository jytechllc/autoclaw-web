"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

type Tab = "templates" | "my";
type WorkflowStatus = "active" | "draft" | "paused";

interface WorkflowStep {
  type: "trigger" | "action" | "condition" | "end";
  labelKey: string;
}

interface Workflow {
  id: string;
  key: string;
  name: string;
  desc: string;
  steps: WorkflowStep[];
  runs: number;
  status: WorkflowStatus;
  createdAt: string;
  lastRun: string | null;
}

interface WorkflowTemplate {
  key: string;
  steps: WorkflowStep[];
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    key: "tmplColdOutreach",
    steps: [
      { type: "trigger", labelKey: "triggerNewLead" },
      { type: "action", labelKey: "actionEnrichLead" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "condition", labelKey: "ifLabel" },
      { type: "action", labelKey: "actionNotify" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
  {
    key: "tmplContentPromo",
    steps: [
      { type: "trigger", labelKey: "triggerWebhook" },
      { type: "action", labelKey: "actionRunAgent" },
      { type: "action", labelKey: "actionPostSocial" },
      { type: "action", labelKey: "actionPostSocial" },
      { type: "action", labelKey: "actionRunAgent" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
  {
    key: "tmplLeadNurture",
    steps: [
      { type: "trigger", labelKey: "triggerFormSubmit" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionAddToCrm" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
  {
    key: "tmplReEngagement",
    steps: [
      { type: "trigger", labelKey: "triggerSchedule" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "condition", labelKey: "ifLabel" },
      { type: "action", labelKey: "actionNotify" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
  {
    key: "tmplWebinarFunnel",
    steps: [
      { type: "trigger", labelKey: "triggerFormSubmit" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
  {
    key: "tmplLongTailFollowup",
    steps: [
      { type: "trigger", labelKey: "triggerNewLead" },
      { type: "action", labelKey: "actionEnrichLead" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "condition", labelKey: "ifLabel" },
      { type: "action", labelKey: "actionNotify" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
  {
    key: "tmplReviewRequest",
    steps: [
      { type: "trigger", labelKey: "triggerWebhook" },
      { type: "action", labelKey: "actionWait" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "condition", labelKey: "ifLabel" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "action", labelKey: "actionSendEmail" },
      { type: "end", labelKey: "endLabel" },
    ],
  },
];

const BLANK_STEPS: WorkflowStep[] = [
  { type: "trigger", labelKey: "triggerNewLead" },
  { type: "action", labelKey: "actionSendEmail" },
  { type: "end", labelKey: "endLabel" },
];

const STEP_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  trigger: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", dot: "bg-blue-500" },
  action: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700", dot: "bg-gray-400" },
  condition: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" },
  end: { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", dot: "bg-green-500" },
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-500",
  paused: "bg-yellow-100 text-yellow-700",
};

const STEP_TYPES: WorkflowStep["type"][] = ["trigger", "action", "condition", "end"];

const ACTION_KEYS = [
  "triggerNewLead", "triggerFormSubmit", "triggerSchedule", "triggerWebhook", "triggerEmailReply", "triggerPageVisit",
  "actionSendEmail", "actionWait", "actionCondition", "actionEnrichLead", "actionAddToCrm",
  "actionNotify", "actionRunAgent", "actionPostSocial", "actionScore", "actionTag",
  "ifLabel", "endLabel",
];

function StepTimeline({ steps, tw }: { steps: WorkflowStep[]; tw: Record<string, string> }) {
  return (
    <div className="relative">
      {steps.map((step, i) => {
        const style = STEP_STYLES[step.type];
        const label = tw[step.labelKey] || step.labelKey;
        const isLast = i === steps.length - 1;

        return (
          <div key={i} className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full ${style.dot} shrink-0 mt-1.5 z-10`} />
              {!isLast && <div className="w-0.5 h-full bg-gray-200 absolute top-4 left-1.5" />}
            </div>
            <div className={`flex-1 mb-2 px-3 py-2 rounded-md border text-xs font-medium ${style.bg} ${style.border} ${style.text}`}>
              <span className="uppercase text-[10px] opacity-60 mr-1.5">
                {step.type === "trigger" ? tw.triggerLabel :
                 step.type === "condition" ? tw.ifLabel :
                 step.type === "end" ? tw.endLabel : tw.thenLabel}
              </span>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Edit Modal ── */
function EditModal({
  workflow,
  tw,
  onSave,
  onCancel,
}: {
  workflow: Workflow;
  tw: Record<string, string>;
  onSave: (updated: Workflow) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [desc, setDesc] = useState(workflow.desc);
  const [steps, setSteps] = useState<WorkflowStep[]>([...workflow.steps]);

  function addStep() {
    const endIdx = steps.findIndex((s) => s.type === "end");
    const newStep: WorkflowStep = { type: "action", labelKey: "actionSendEmail" };
    if (endIdx >= 0) {
      const updated = [...steps];
      updated.splice(endIdx, 0, newStep);
      setSteps(updated);
    } else {
      setSteps([...steps, newStep]);
    }
  }

  function removeStep(idx: number) {
    if (steps.length <= 2) return;
    setSteps(steps.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const updated = [...steps];
    [updated[idx], updated[target]] = [updated[target], updated[idx]];
    setSteps(updated);
  }

  function updateStep(idx: number, field: "type" | "labelKey", value: string) {
    const updated = [...steps];
    if (field === "type") {
      updated[idx] = { ...updated[idx], type: value as WorkflowStep["type"] };
    } else {
      updated[idx] = { ...updated[idx], labelKey: value };
    }
    setSteps(updated);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-lg">{tw.editWorkflow}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 cursor-pointer text-xl">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{tw.workflowName}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{tw.workflowDesc}</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-600">{tw.steps}</label>
              <button onClick={addStep} className="text-xs text-red-600 hover:text-red-800 font-medium cursor-pointer">+ {tw.addStep}</button>
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                  <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>
                  <select
                    value={step.type}
                    onChange={(e) => updateStep(i, "type", e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                  >
                    {STEP_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={step.labelKey}
                    onChange={(e) => updateStep(i, "labelKey", e.target.value)}
                    className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                  >
                    {ACTION_KEYS.map((k) => (
                      <option key={k} value={k}>{tw[k] || k}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 cursor-pointer" title={tw.moveUp}>↑</button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 cursor-pointer" title={tw.moveDown}>↓</button>
                    <button onClick={() => removeStep(i)} disabled={steps.length <= 2} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30 cursor-pointer ml-1" title={tw.removeStep}>&times;</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 shrink-0">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tw.cancel}</button>
          <button
            onClick={() => onSave({ ...workflow, name, desc, steps })}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium cursor-pointer"
          >
            {tw.save}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Test Modal ── */
function TestModal({
  workflow,
  tw,
  onClose,
}: {
  workflow: Workflow;
  tw: Record<string, string>;
  onClose: () => void;
}) {
  const [stepResults, setStepResults] = useState<("pending" | "running" | "passed")[]>(
    workflow.steps.map(() => "pending")
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function runTest() {
    setRunning(true);
    setDone(false);
    const results: ("pending" | "running" | "passed")[] = workflow.steps.map(() => "pending");
    setStepResults([...results]);

    for (let i = 0; i < workflow.steps.length; i++) {
      const updated: ("pending" | "running" | "passed")[] = [...results];
      updated[i] = "running";
      setStepResults([...updated]);
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
      updated[i] = "passed";
      results[i] = "passed";
      setStepResults([...updated]);
    }
    setRunning(false);
    setDone(true);
  }

  const statusLabel = (s: string) =>
    s === "passed" ? tw.testStepPassed : s === "running" ? tw.testStepRunning : tw.testStepPending;

  const statusColor = (s: string) =>
    s === "passed" ? "text-green-600" : s === "running" ? "text-blue-600 animate-pulse" : "text-gray-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-lg">{tw.testWorkflow}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer text-xl">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-gray-500 mb-4">{workflow.name}</p>
          <div className="space-y-2">
            {workflow.steps.map((step, i) => {
              const style = STEP_STYLES[step.type];
              return (
                <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-md border ${style.bg} ${style.border}`}>
                  <span className={`text-xs font-medium ${style.text}`}>
                    {tw[step.labelKey] || step.labelKey}
                  </span>
                  <span className={`text-xs font-medium ${statusColor(stepResults[i])}`}>
                    {statusLabel(stepResults[i])}
                  </span>
                </div>
              );
            })}
          </div>

          {done && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
              {tw.testSuccess}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{tw.cancel}</button>
          <button
            onClick={runTest}
            disabled={running}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg font-medium cursor-pointer"
          >
            {running ? tw.testing : tw.test}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const tw = dict.workflowsPage as Record<string, string>;
  const tc = dict.common;

  const { user, isLoading: userLoading } = useUser();
  const [tab, setTab] = useState<Tab>("templates");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [myWorkflows, setMyWorkflows] = useState<Workflow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [testingWorkflow, setTestingWorkflow] = useState<Workflow | null>(null);

  // Long-tail wait durations in seconds (3d, 4d, 23d, 60d, 270d ≈ 9 months)
  const LONG_TAIL_WAITS = [3, 4, 23, 60, 270].map((d) => d * 86400);

  function compileDefinition(steps: WorkflowStep[], key: string): { trigger: { type: string }; steps: Array<{ kind: string; delay_seconds?: number; template_id?: number | null }> } {
    const out: Array<{ kind: string; delay_seconds?: number; template_id?: number | null }> = [];
    let waitIdx = 0;
    let emailIdx = 0;
    const isLongTail = key === "tmplLongTailFollowup";
    for (const s of steps) {
      if (s.labelKey === "actionEnrichLead") out.push({ kind: "enrich" });
      else if (s.labelKey === "actionSendEmail") { out.push({ kind: "send_email", template_id: null }); emailIdx++; }
      else if (s.labelKey === "actionWait") {
        const sec = isLongTail && waitIdx < LONG_TAIL_WAITS.length ? LONG_TAIL_WAITS[waitIdx] : 3 * 86400;
        out.push({ kind: "wait", delay_seconds: sec });
        waitIdx++;
      }
      else if (s.labelKey === "actionNotify") out.push({ kind: "notify" });
    }
    void emailIdx;
    return { trigger: { type: "new_lead" }, steps: out };
  }

  type ApiWorkflow = { id: number; name: string; description: string | null; status: WorkflowStatus; definition: unknown; runs: number; last_run_at: string | null; created_at: string };
  function fromApi(w: ApiWorkflow): Workflow {
    return {
      id: String(w.id),
      key: "custom",
      name: w.name,
      desc: w.description || "",
      steps: [...BLANK_STEPS],
      runs: w.runs || 0,
      status: w.status,
      createdAt: w.created_at,
      lastRun: w.last_run_at,
    };
  }

  // Hydrate from /api/workflows
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch("/api/workflows");
        if (res.ok) {
          const data = await res.json();
          setMyWorkflows((data.workflows as ApiWorkflow[]).map(fromApi));
        }
      } catch {}
      setHydrated(true);
    })();
  }, [user]);

  async function addFromTemplate(tmpl: WorkflowTemplate) {
    const name = tw[tmpl.key] || tmpl.key;
    const desc = tw[`${tmpl.key}Desc`] || "";
    const definition = compileDefinition(tmpl.steps, tmpl.key);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc, status: "draft", definition }),
      });
      if (res.ok) {
        const data = await res.json();
        const wf = fromApi(data.workflow as ApiWorkflow);
        wf.steps = [...tmpl.steps];
        wf.key = tmpl.key;
        setMyWorkflows((prev) => [wf, ...prev]);
        setTab("my");
      }
    } catch {}
  }

  async function createBlank() {
    const definition = compileDefinition(BLANK_STEPS, "custom");
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tw.createWorkflow, description: "", status: "draft", definition }),
      });
      if (res.ok) {
        const data = await res.json();
        const wf = fromApi(data.workflow as ApiWorkflow);
        setMyWorkflows((prev) => [wf, ...prev]);
        setTab("my");
      }
    } catch {}
  }

  async function toggleStatus(id: string) {
    const current = myWorkflows.find((w) => w.id === id);
    if (!current) return;
    const next: WorkflowStatus = current.status === "active" ? "paused" : "active";
    try {
      await fetch(`/api/workflows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      setMyWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: next } : w)));
    } catch {}
  }

  async function deleteWorkflow(id: string) {
    try {
      await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      setMyWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch {}
  }

  async function saveWorkflow(updated: Workflow) {
    const definition = compileDefinition(updated.steps, updated.key);
    try {
      await fetch(`/api/workflows/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: updated.name, description: updated.desc, definition }),
      });
      setMyWorkflows((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      setEditingWorkflow(null);
    } catch {}
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
          <h1 className="text-2xl font-bold mb-4">{tw.title}</h1>
          <a href={`/auth/login?returnTo=/${locale}/dashboard/workflows`} className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user}>
      <div className="px-4 sm:px-6 py-6 w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{tw.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{tw.subtitle}</p>
          </div>
          <button
            onClick={createBlank}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            + {tw.createWorkflow}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
          <button
            onClick={() => setTab("templates")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              tab === "templates" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tw.templates}
          </button>
          <button
            onClick={() => setTab("my")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              tab === "my" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tw.myWorkflows}
            {myWorkflows.length > 0 && (
              <span className="ml-1.5 bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full text-xs">{myWorkflows.length}</span>
            )}
          </button>
        </div>

        {tab === "my" ? (
          myWorkflows.length === 0 ? (
            /* Empty state */
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-700 mb-1">{tw.noWorkflows}</h3>
              <p className="text-sm text-gray-500 mb-4">{tw.noWorkflowsDesc}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={createBlank}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {tw.fromScratch}
                </button>
                <button
                  onClick={() => setTab("templates")}
                  className="border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {tw.useTemplate}
                </button>
              </div>
            </div>
          ) : (
            /* My workflows list */
            <div className="space-y-3">
              {myWorkflows.map((wf) => {
                const isExpanded = expandedWorkflow === wf.id;

                return (
                  <div key={wf.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm truncate">{wf.name}</h3>
                          {wf.desc && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{wf.desc}</p>}
                        </div>
                        <div className="flex items-center gap-2 ml-3 shrink-0">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[wf.status]}`}>
                            {tw[wf.status]}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>{wf.steps.length} {tw.steps}</span>
                          <span>{wf.runs} {tw.runs}</span>
                          <span>{tw.lastRun}: {wf.lastRun ? new Date(wf.lastRun).toLocaleDateString() : tw.never}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingWorkflow(wf)}
                            className="text-xs text-blue-600 hover:bg-blue-50 font-medium cursor-pointer px-2 py-1 rounded transition-colors"
                            title={tw.edit}
                          >
                            {tw.edit}
                          </button>
                          <button
                            onClick={() => setTestingWorkflow(wf)}
                            className="text-xs text-emerald-600 hover:bg-emerald-50 font-medium cursor-pointer px-2 py-1 rounded transition-colors"
                            title={tw.test}
                          >
                            {tw.test}
                          </button>
                          <button
                            onClick={() => toggleStatus(wf.id)}
                            className={`text-xs font-medium cursor-pointer px-2 py-1 rounded transition-colors ${
                              wf.status === "active"
                                ? "text-yellow-600 hover:bg-yellow-50"
                                : "text-green-600 hover:bg-green-50"
                            }`}
                          >
                            {wf.status === "active" ? "⏸" : "▶"}
                          </button>
                          <button
                            onClick={() => setExpandedWorkflow(isExpanded ? null : wf.id)}
                            className="text-xs text-red-700 hover:text-red-900 font-medium cursor-pointer"
                          >
                            {isExpanded ? "▲" : "▼"}
                          </button>
                          <button
                            onClick={() => deleteWorkflow(wf.id)}
                            className="text-xs text-gray-400 hover:text-red-600 cursor-pointer"
                          >
                            {tc.delete}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                        <StepTimeline steps={wf.steps} tw={tw} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Templates grid */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {TEMPLATES.map((tmpl) => {
              const name = tw[tmpl.key] || tmpl.key;
              const desc = tw[`${tmpl.key}Desc`] || "";
              const isExpanded = expandedCard === tmpl.key;

              return (
                <div
                  key={tmpl.key}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-sm">{name}</h3>
                      <span className="text-xs text-gray-400">{tmpl.steps.length} {tw.steps}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">{desc}</p>

                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => addFromTemplate(tmpl)}
                        className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer"
                      >
                        {tw.useTemplate}
                      </button>
                      <button
                        onClick={() => setExpandedCard(isExpanded ? null : tmpl.key)}
                        className="text-xs text-gray-500 hover:text-gray-700 font-medium cursor-pointer"
                      >
                        {isExpanded ? "▲" : "▼"} {tw.steps}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                      <StepTimeline steps={tmpl.steps} tw={tw} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingWorkflow && (
        <EditModal
          workflow={editingWorkflow}
          tw={tw}
          onSave={saveWorkflow}
          onCancel={() => setEditingWorkflow(null)}
        />
      )}

      {/* Test Modal */}
      {testingWorkflow && (
        <TestModal
          workflow={testingWorkflow}
          tw={tw}
          onClose={() => setTestingWorkflow(null)}
        />
      )}
    </DashboardShell>
  );
}
