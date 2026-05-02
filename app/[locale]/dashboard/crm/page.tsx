"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

interface Contact {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  position: string | null;
  source: string;
  emails_sent: number;
  emails_opened: number;
  last_opened_at: string | null;
}

interface Company {
  company: string;
  domain: string;
  contact_count: number;
  total_emails_sent: number;
  total_emails_opened: number;
}

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  creator_email?: string;
}

interface Stats {
  totalContacts: number;
  totalCompanies: number;
  totalEmailsSent: number;
  responseRate: number;
}

type Tab = "contacts" | "companies" | "tasks" | "groups";

interface ContactGroup {
  id: number;
  name: string;
  color: string;
  description: string | null;
  member_count: number;
}

export default function CRMPage() {
  return (
    <Suspense>
      <CRMPageInner />
    </Suspense>
  );
}

function CRMPageInner() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const isFr = false;
  const { user } = useUser();

  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab") as Tab | null;
  const validTabs: Tab[] = ["contacts", "companies", "tasks", "groups"];
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "contacts";
  const [activeTab, setActiveTabState] = useState<Tab>(initialTab);

  // Sync tab from URL on navigation
  useEffect(() => {
    if (tabFromUrl && validTabs.includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTabState(tabFromUrl);
    }
  }, [tabFromUrl]);

  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    window.history.replaceState(null, "", `?tab=${tab}`);
  };
  const [stats, setStats] = useState<Stats>({ totalContacts: 0, totalCompanies: 0, totalEmailsSent: 0, responseRate: 0 });

  // Contacts state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsPage, setContactsPage] = useState(1);
  const [contactsTotalPages, setContactsTotalPages] = useState(1);
  const [contactsSearch, setContactsSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [contactsLoading, setContactsLoading] = useState(true);

  // Companies state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<Contact[]>([]);
  const [companyContactsLoading, setCompanyContactsLoading] = useState(false);

  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  // Groups state
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState("#ef4444");
  const [groupDesc, setGroupDesc] = useState("");
  const [expandedGroup, setExpandedGroupId] = useState<number | null>(null);
  const [groupMembers, setGroupMembers] = useState<Contact[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [addToGroupId, setAddToGroupId] = useState<number | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskPriority, setTaskPriority] = useState<"low" | "medium" | "high">("medium");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  // Smart import state
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importParsed, setImportParsed] = useState<{ email: string; firstName: string; lastName: string; company: string; position: string }[]>([]);
  const [importSource, setImportSource] = useState("");
  const [importEnriching, setImportEnriching] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importDone, setImportDone] = useState(false);

  const [importParsing, setImportParsing] = useState(false);

  async function smartParse() {
    if (!importText.trim()) return;
    setImportParsing(true);
    try {
      const res = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "smart_parse", text: importText }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportParsed(data.contacts || []);
      }
    } catch { /* ignore */ }
    setImportParsing(false);
  }

  async function enrichImported() {
    if (importParsed.length === 0) return;
    setImportEnriching(true);
    try {
      const res = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enrich_contacts", contacts: importParsed }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.enriched) setImportParsed(data.enriched);
      }
    } catch { /* ignore */ }
    setImportEnriching(false);
  }

  async function saveImported() {
    if (importParsed.length === 0) return;
    setImportSaving(true);
    try {
      const res = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_contacts", contacts: importParsed, source_detail: importSource || "Smart Import" }),
      });
      if (res.ok) {
        setImportDone(true);
        fetchContacts();
        fetchStats();
        setTimeout(() => { setShowImport(false); setImportText(""); setImportParsed([]); setImportDone(false); setImportSource(""); }, 1500);
      }
    } catch { /* ignore */ }
    setImportSaving(false);
  }

  // i18n labels
  const t = {
    crm: "CRM",
    contacts: isZh ? "联系人" : isFr ? "Contacts" : "Contacts",
    companies: isZh ? "公司" : isFr ? "Entreprises" : "Companies",
    tasks: isZh ? "任务" : isFr ? "Tâches" : "Tasks",
    totalContacts: isZh ? "总联系人" : isFr ? "Total contacts" : "Total Contacts",
    totalCompanies: isZh ? "总公司数" : isFr ? "Total entreprises" : "Total Companies",
    totalEmailsSent: isZh ? "发送邮件数" : isFr ? "Emails envoyés" : "Emails Sent",
    responseRate: isZh ? "响应率" : isFr ? "Taux de réponse" : "Response Rate",
    search: isZh ? "搜索联系人..." : isFr ? "Rechercher..." : "Search contacts...",
    filterCompany: isZh ? "按公司筛选" : isFr ? "Filtrer par entreprise" : "Filter by company",
    filterSource: isZh ? "按来源筛选" : isFr ? "Filtrer par source" : "Filter by source",
    all: isZh ? "全部" : isFr ? "Tous" : "All",
    name: isZh ? "姓名" : isFr ? "Nom" : "Name",
    email: isZh ? "邮箱" : isFr ? "Email" : "Email",
    company: isZh ? "公司" : isFr ? "Entreprise" : "Company",
    position: isZh ? "职位" : isFr ? "Poste" : "Position",
    source: isZh ? "来源" : isFr ? "Source" : "Source",
    emailsSent: isZh ? "已发送" : isFr ? "Envoyés" : "Sent",
    lastOpened: isZh ? "最后打开" : isFr ? "Dernier ouvert" : "Last Opened",
    noContacts: isZh ? "暂无联系人" : isFr ? "Aucun contact" : "No contacts found",
    domain: isZh ? "域名" : isFr ? "Domaine" : "Domain",
    contactCount: isZh ? "联系人数" : isFr ? "Nombre de contacts" : "Contacts",
    noCompanies: isZh ? "暂无公司数据" : isFr ? "Aucune entreprise" : "No companies found",
    toDo: isZh ? "待办" : isFr ? "À faire" : "To Do",
    inProgress: isZh ? "进行中" : isFr ? "En cours" : "In Progress",
    done: isZh ? "完成" : isFr ? "Terminé" : "Done",
    addTask: isZh ? "添加任务" : isFr ? "Ajouter une tâche" : "Add Task",
    title: isZh ? "标题" : isFr ? "Titre" : "Title",
    description: isZh ? "描述" : isFr ? "Description" : "Description",
    priority: isZh ? "优先级" : isFr ? "Priorité" : "Priority",
    assignee: isZh ? "负责人" : isFr ? "Assigné" : "Assignee",
    dueDate: isZh ? "截止日期" : isFr ? "Date limite" : "Due Date",
    save: isZh ? "保存" : isFr ? "Enregistrer" : "Save",
    cancel: isZh ? "取消" : isFr ? "Annuler" : "Cancel",
    delete: isZh ? "删除" : isFr ? "Supprimer" : "Delete",
    edit: isZh ? "编辑" : isFr ? "Modifier" : "Edit",
    low: isZh ? "低" : isFr ? "Bas" : "Low",
    medium: isZh ? "中" : isFr ? "Moyen" : "Medium",
    high: isZh ? "高" : isFr ? "Haut" : "High",
    loading: isZh ? "加载中..." : isFr ? "Chargement..." : "Loading...",
    prev: isZh ? "上一页" : isFr ? "Précédent" : "Previous",
    next: isZh ? "下一页" : isFr ? "Suivant" : "Next",
    page: isZh ? "页" : isFr ? "Page" : "Page",
    noTasks: isZh ? "暂无任务" : isFr ? "Aucune tâche" : "No tasks",
    moveLeft: "←",
    moveRight: "→",
    groups: isZh ? "群组" : isFr ? "Groupes" : "Groups",
    createGroup: isZh ? "创建群组" : isFr ? "Créer un groupe" : "Create Group",
    groupName: isZh ? "群组名称" : isFr ? "Nom du groupe" : "Group Name",
    groupColor: isZh ? "颜色" : isFr ? "Couleur" : "Color",
    members: isZh ? "成员" : isFr ? "Membres" : "Members",
    noGroups: isZh ? "暂无群组" : isFr ? "Aucun groupe" : "No groups yet",
    addSelected: isZh ? "添加到群组" : isFr ? "Ajouter au groupe" : "Add to Group",
    removeFromGroup: isZh ? "移出群组" : isFr ? "Retirer du groupe" : "Remove",
    selectAll: isZh ? "全选" : isFr ? "Tout sélectionner" : "Select All",
    smartImport: isZh ? "智能导入" : isFr ? "Import intelligent" : "Smart Import",
    importHint: isZh ? "粘贴任意格式的联系人信息 — 邮件列表、名片、表格、纯文本都可以，AI 会自动识别" : isFr ? "Collez n'importe quel format de contacts — l'IA les reconnaîtra" : "Paste any format — email lists, business cards, spreadsheets, plain text. AI will auto-detect contacts.",
    parse: isZh ? "AI 智能识别" : isFr ? "Reconnaissance IA" : "AI Parse",
    parsing: isZh ? "识别中..." : isFr ? "Reconnaissance..." : "Parsing...",
    enrich: isZh ? "Apollo 智能补全" : isFr ? "Enrichir via Apollo" : "Enrich via Apollo",
    enriching: isZh ? "补全中..." : isFr ? "Enrichissement..." : "Enriching...",
    importBtn: isZh ? "导入到 CRM" : isFr ? "Importer dans CRM" : "Import to CRM",
    importing: isZh ? "导入中..." : isFr ? "Importation..." : "Importing...",
    imported: isZh ? "导入成功！" : isFr ? "Importé !" : "Imported!",
    parsed: isZh ? "已解析" : isFr ? "Analysé" : "Parsed",
    records: isZh ? "条记录" : isFr ? "enregistrements" : "records",
  };

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const res = await fetch("/api/crm?tab=groups");
      if (res.ok) { const data = await res.json(); setGroups(data.groups || []); }
    } catch { /* ignore */ }
    setGroupsLoading(false);
  }, []);

  async function fetchGroupMembers(groupId: number) {
    setGroupMembersLoading(true);
    try {
      const res = await fetch(`/api/crm?tab=group_members&group_id=${groupId}`);
      if (res.ok) { const data = await res.json(); setGroupMembers(data.members || []); }
    } catch { /* ignore */ }
    setGroupMembersLoading(false);
  }

  async function createGroup() {
    if (!groupName.trim()) return;
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_group", name: groupName, color: groupColor, description: groupDesc || null }) });
    setShowGroupForm(false); setGroupName(""); setGroupDesc("");
    fetchGroups();
  }

  async function deleteGroup(id: number) {
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_group", id }) });
    fetchGroups();
    if (expandedGroup === id) { setExpandedGroupId(null); setGroupMembers([]); }
  }

  async function addSelectedToGroup(groupId: number) {
    if (selectedContacts.size === 0) return;
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_to_group", group_id: groupId, contact_ids: [...selectedContacts] }) });
    setSelectedContacts(new Set()); setAddToGroupId(null);
    fetchGroups();
    if (expandedGroup === groupId) fetchGroupMembers(groupId);
  }

  async function removeFromGroup(groupId: number, contactId: number) {
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove_from_group", group_id: groupId, contact_id: contactId }) });
    fetchGroups();
    fetchGroupMembers(groupId);
  }

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/crm?tab=stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch contacts
  const fetchContacts = useCallback(async () => {
    setContactsLoading(true);
    try {
      const params = new URLSearchParams({ tab: "contacts", page: String(contactsPage) });
      if (contactsSearch) params.set("search", contactsSearch);
      if (companyFilter) params.set("company", companyFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      const res = await fetch(`/api/crm?${params}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts);
        setContactsTotal(data.total);
        setContactsTotalPages(data.totalPages);
      }
    } catch { /* ignore */ }
    setContactsLoading(false);
  }, [contactsPage, contactsSearch, companyFilter, sourceFilter]);

  // Fetch companies
  const fetchCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const res = await fetch("/api/crm?tab=companies");
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies);
      }
    } catch { /* ignore */ }
    setCompaniesLoading(false);
  }, []);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const res = await fetch("/api/crm?tab=tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks);
      }
    } catch { /* ignore */ }
    setTasksLoading(false);
  }, []);

  // Fetch company contacts
  const fetchCompanyContacts = async (companyName: string) => {
    setCompanyContactsLoading(true);
    try {
      const res = await fetch(`/api/crm?tab=company_contacts&company_name=${encodeURIComponent(companyName)}`);
      if (res.ok) {
        const data = await res.json();
        setCompanyContacts(data.contacts);
      }
    } catch { /* ignore */ }
    setCompanyContactsLoading(false);
  };

  useEffect(() => { fetchStats(); fetchGroups(); }, [fetchStats, fetchGroups]);

  useEffect(() => {
    if (activeTab === "contacts") fetchContacts();
  }, [activeTab, fetchContacts]);

  useEffect(() => {
    if (activeTab === "companies") fetchCompanies();
  }, [activeTab, fetchCompanies]);

  useEffect(() => {
    if (activeTab === "tasks") fetchTasks();
  }, [activeTab, fetchTasks]);

  useEffect(() => {
    if (activeTab === "groups") fetchGroups();
  }, [activeTab, fetchGroups]);

  // Debounced search
  const [searchDebounce, setSearchDebounce] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setContactsSearch(searchDebounce), 300);
    return () => clearTimeout(timer);
  }, [searchDebounce]);

  // Task actions
  const saveTask = async () => {
    if (!taskTitle.trim()) return;
    const payload: Record<string, unknown> = {
      action: editingTask ? "update_task" : "create_task",
      title: taskTitle,
      description: taskDesc,
      priority: taskPriority,
      assignee: taskAssignee || null,
      due_date: taskDueDate || null,
    };
    if (editingTask) payload.id = editingTask.id;
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    resetTaskForm();
    fetchTasks();
  };

  const deleteTask = async (id: number) => {
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_task", id }) });
    fetchTasks();
  };

  const moveTask = async (id: number, status: string) => {
    await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move_task", id, status }) });
    fetchTasks();
  };

  const resetTaskForm = () => {
    setShowTaskForm(false);
    setEditingTask(null);
    setTaskTitle("");
    setTaskDesc("");
    setTaskPriority("medium");
    setTaskAssignee("");
    setTaskDueDate("");
  };

  const startEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDesc(task.description || "");
    setTaskPriority(task.priority);
    setTaskAssignee(task.assignee || "");
    setTaskDueDate(task.due_date || "");
    setShowTaskForm(true);
  };

  const priorityColor = (p: string) => {
    if (p === "high") return "bg-red-100 text-red-700";
    if (p === "medium") return "bg-yellow-100 text-yellow-700";
    return "bg-green-100 text-green-700";
  };

  const statusOrder: Task["status"][] = ["todo", "in_progress", "done"];
  const prevStatus = (s: Task["status"]) => statusOrder[statusOrder.indexOf(s) - 1];
  const nextStatus = (s: Task["status"]) => statusOrder[statusOrder.indexOf(s) + 1];

  if (!user) {
    return (
      <DashboardShell user={{ email: "" }}>
        <div className="flex items-center justify-center h-64 text-gray-500">{t.loading}</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell user={user}>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">CRM</h1>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: t.totalContacts, value: stats.totalContacts, color: "bg-blue-50 text-blue-700" },
            { label: t.totalCompanies, value: stats.totalCompanies, color: "bg-purple-50 text-purple-700" },
            { label: t.totalEmailsSent, value: stats.totalEmailsSent, color: "bg-green-50 text-green-700" },
            { label: t.responseRate, value: `${stats.responseRate}%`, color: "bg-orange-50 text-orange-700" },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-lg p-4 ${stat.color}`}>
              <div className="text-sm font-medium opacity-80">{stat.label}</div>
              <div className="text-2xl font-bold mt-1">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {(["contacts", "companies", "groups", "tasks"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === tab
                  ? "border-red-600 text-red-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "contacts" ? t.contacts : tab === "companies" ? t.companies : tab === "groups" ? t.groups : t.tasks}
            </button>
          ))}
        </div>

        {/* Contacts Tab */}
        {activeTab === "contacts" && (
          <div>
            {/* Actions bar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setShowImport(true)} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-md text-sm font-medium cursor-pointer">{t.smartImport}</button>
              {selectedContacts.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{selectedContacts.size} {isZh ? "已选" : "selected"}</span>
                  <select
                    value={addToGroupId || ""}
                    onChange={(e) => { const gid = Number(e.target.value); if (gid) addSelectedToGroup(gid); }}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-xs cursor-pointer"
                  >
                    <option value="">{t.addSelected}</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button onClick={() => setSelectedContacts(new Set())} className="text-xs text-gray-400 cursor-pointer">{t.cancel}</button>
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <input
                type="text"
                placeholder={t.search}
                value={searchDebounce}
                onChange={(e) => { setSearchDebounce(e.target.value); setContactsPage(1); }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <input
                type="text"
                placeholder={t.filterCompany}
                value={companyFilter}
                onChange={(e) => { setCompanyFilter(e.target.value); setContactsPage(1); }}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-full sm:w-48"
              />
              <select
                value={sourceFilter}
                onChange={(e) => { setSourceFilter(e.target.value); setContactsPage(1); }}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-full sm:w-40"
              >
                <option value="">{t.all} {t.source}</option>
                <option value="manual">Manual</option>
                <option value="brevo">Brevo</option>
                <option value="csv">CSV</option>
                <option value="scrape">Scrape</option>
              </select>
            </div>

            {contactsLoading ? (
              <div className="text-center py-12 text-gray-500">{t.loading}</div>
            ) : contacts.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{t.noContacts}</div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="pb-2 w-8"><input type="checkbox" checked={contacts.length > 0 && contacts.every((c) => selectedContacts.has(c.id))} onChange={(e) => { if (e.target.checked) setSelectedContacts(new Set(contacts.map((c) => c.id))); else setSelectedContacts(new Set()); }} className="cursor-pointer" /></th>
                        <th className="pb-2 font-medium">{t.name}</th>
                        <th className="pb-2 font-medium">{t.email}</th>
                        <th className="pb-2 font-medium">{t.company}</th>
                        <th className="pb-2 font-medium">{t.position}</th>
                        <th className="pb-2 font-medium">{t.source}</th>
                        <th className="pb-2 font-medium text-right">{t.emailsSent}</th>
                        <th className="pb-2 font-medium">{t.lastOpened}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
                        <tr key={c.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selectedContacts.has(c.id) ? "bg-red-50" : ""}`}>
                          <td className="py-2.5 w-8"><input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => { const next = new Set(selectedContacts); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); setSelectedContacts(next); }} className="cursor-pointer" /></td>
                          <td className="py-2.5">
                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || "-"}
                          </td>
                          <td className="py-2.5 text-gray-600">{c.email}</td>
                          <td className="py-2.5">{c.company || "-"}</td>
                          <td className="py-2.5 text-gray-600">{c.position || "-"}</td>
                          <td className="py-2.5">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{c.source}</span>
                          </td>
                          <td className="py-2.5 text-right">{c.emails_sent}</td>
                          <td className="py-2.5 text-gray-500 text-xs">
                            {c.last_opened_at ? new Date(c.last_opened_at).toLocaleDateString() : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-3">
                  {contacts.map((c) => (
                    <div key={c.id} className="bg-white rounded-lg border border-gray-200 p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-gray-900">
                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}
                          </div>
                          <div className="text-sm text-gray-500">{c.email}</div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{c.source}</span>
                      </div>
                      <div className="mt-2 text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                        {c.company && <span>{c.company}</span>}
                        {c.position && <span>{c.position}</span>}
                        <span>{t.emailsSent}: {c.emails_sent}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {contactsTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-gray-500">
                      {t.page} {contactsPage} / {contactsTotalPages} ({contactsTotal})
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setContactsPage((p) => Math.max(1, p - 1))}
                        disabled={contactsPage <= 1}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 cursor-pointer"
                      >
                        {t.prev}
                      </button>
                      <button
                        onClick={() => setContactsPage((p) => Math.min(contactsTotalPages, p + 1))}
                        disabled={contactsPage >= contactsTotalPages}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 cursor-pointer"
                      >
                        {t.next}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Companies Tab */}
        {activeTab === "companies" && (
          <div>
            {companiesLoading ? (
              <div className="text-center py-12 text-gray-500">{t.loading}</div>
            ) : companies.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{t.noCompanies}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {companies.map((co) => (
                  <div key={co.company + co.domain} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                    <button
                      onClick={() => {
                        if (expandedCompany === co.company) {
                          setExpandedCompany(null);
                          setCompanyContacts([]);
                        } else {
                          setExpandedCompany(co.company);
                          fetchCompanyContacts(co.company);
                        }
                      }}
                      className="w-full text-left cursor-pointer"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold text-gray-900">{co.company}</h3>
                          <p className="text-sm text-gray-500">{co.domain}</p>
                        </div>
                        <span className="text-lg font-bold text-blue-600">{co.contact_count}</span>
                      </div>
                      <div className="mt-3 flex gap-4 text-sm text-gray-600">
                        <span>{t.emailsSent}: {co.total_emails_sent}</span>
                        <span>{t.responseRate}: {co.total_emails_sent > 0 ? Math.round((co.total_emails_opened / co.total_emails_sent) * 100) : 0}%</span>
                      </div>
                    </button>

                    {expandedCompany === co.company && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        {companyContactsLoading ? (
                          <div className="text-sm text-gray-500">{t.loading}</div>
                        ) : (
                          <div className="space-y-2">
                            {companyContacts.map((c) => (
                              <div key={c.id} className="text-sm flex justify-between">
                                <div>
                                  <span className="text-gray-900">{[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}</span>
                                  {c.position && <span className="text-gray-500 ml-2">{c.position}</span>}
                                </div>
                                <span className="text-gray-400">{c.emails_sent} {t.emailsSent.toLowerCase()}</span>
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

        {/* Tasks Tab - Kanban */}
        {activeTab === "tasks" && (
          <div>
            {/* Calendar sync hint */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2 text-sm">
              <span>📅</span>
              <span className="text-blue-700">{isZh ? "Google / Outlook 日历同步即将上线" : "Google / Outlook Calendar sync coming soon"}</span>
            </div>
            <div className="flex justify-between items-center mb-4">
              <div />
              <button
                onClick={() => { resetTaskForm(); setShowTaskForm(true); }}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition-colors cursor-pointer"
              >
                + {t.addTask}
              </button>
            </div>

            {/* Task Form Modal */}
            {showTaskForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => resetTaskForm()}>
                <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold mb-4">
                    {editingTask ? t.edit : t.addTask}
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.title} *</label>
                      <input
                        type="text"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.description}</label>
                      <textarea
                        value={taskDesc}
                        onChange={(e) => setTaskDesc(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.priority}</label>
                        <select
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value as "low" | "medium" | "high")}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <option value="low">{t.low}</option>
                          <option value="medium">{t.medium}</option>
                          <option value="high">{t.high}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.dueDate}</label>
                        <input
                          type="date"
                          value={taskDueDate}
                          onChange={(e) => setTaskDueDate(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.assignee}</label>
                      <input
                        type="text"
                        value={taskAssignee}
                        onChange={(e) => setTaskAssignee(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      onClick={resetTaskForm}
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
                    >
                      {t.cancel}
                    </button>
                    <button
                      onClick={saveTask}
                      disabled={!taskTitle.trim()}
                      className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                    >
                      {t.save}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tasksLoading ? (
              <div className="text-center py-12 text-gray-500">{t.loading}</div>
            ) : (
              <>
                {/* Desktop Kanban */}
                <div className="hidden md:grid grid-cols-3 gap-4">
                  {(["todo", "in_progress", "done"] as const).map((status) => {
                    const columnTasks = tasks.filter((tk) => tk.status === status);
                    const label = status === "todo" ? t.toDo : status === "in_progress" ? t.inProgress : t.done;
                    const headerColor = status === "todo" ? "bg-gray-100" : status === "in_progress" ? "bg-blue-50" : "bg-green-50";
                    return (
                      <div key={status} className="flex flex-col">
                        <div className={`rounded-t-lg px-3 py-2 ${headerColor}`}>
                          <span className="font-semibold text-sm text-gray-700">{label}</span>
                          <span className="ml-2 text-xs text-gray-500">({columnTasks.length})</span>
                        </div>
                        <div className="bg-gray-50 rounded-b-lg border border-gray-200 border-t-0 p-2 space-y-2 min-h-[200px]">
                          {columnTasks.length === 0 && (
                            <div className="text-center text-sm text-gray-400 py-8">{t.noTasks}</div>
                          )}
                          {columnTasks.map((task) => (
                            <div key={task.id} className="bg-white rounded-md border border-gray-200 p-3 shadow-sm">
                              <div className="flex justify-between items-start">
                                <span className="font-medium text-sm text-gray-900">{task.title}</span>
                                <span className={`px-1.5 py-0.5 rounded text-xs ${priorityColor(task.priority)}`}>
                                  {task.priority === "high" ? t.high : task.priority === "medium" ? t.medium : t.low}
                                </span>
                              </div>
                              {task.description && (
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                              )}
                              <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                                <div className="flex flex-wrap gap-2">
                                  {task.assignee && <span>{task.assignee}</span>}
                                  {task.due_date && <span>{new Date(task.due_date).toLocaleDateString()}</span>}
                                  {task.creator_email && <span className="text-gray-300" title={task.creator_email}>{task.creator_email.split("@")[0]}</span>}
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                                <div className="flex gap-1">
                                  {prevStatus(status) && (
                                    <button
                                      onClick={() => moveTask(task.id, prevStatus(status)!)}
                                      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 cursor-pointer"
                                      title={`Move to ${prevStatus(status)}`}
                                    >
                                      {t.moveLeft}
                                    </button>
                                  )}
                                  {nextStatus(status) && (
                                    <button
                                      onClick={() => moveTask(task.id, nextStatus(status)!)}
                                      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 cursor-pointer"
                                      title={`Move to ${nextStatus(status)}`}
                                    >
                                      {t.moveRight}
                                    </button>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => startEditTask(task)}
                                    className="text-xs px-2 py-1 rounded text-blue-600 hover:bg-blue-50 cursor-pointer"
                                  >
                                    {t.edit}
                                  </button>
                                  <button
                                    onClick={() => deleteTask(task.id)}
                                    className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 cursor-pointer"
                                  >
                                    {t.delete}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Mobile Tasks - Stacked */}
                <div className="md:hidden space-y-4">
                  {(["todo", "in_progress", "done"] as const).map((status) => {
                    const columnTasks = tasks.filter((tk) => tk.status === status);
                    const label = status === "todo" ? t.toDo : status === "in_progress" ? t.inProgress : t.done;
                    return (
                      <div key={status}>
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">
                          {label} ({columnTasks.length})
                        </h3>
                        {columnTasks.length === 0 ? (
                          <div className="text-sm text-gray-400 py-4 text-center bg-gray-50 rounded-md">{t.noTasks}</div>
                        ) : (
                          <div className="space-y-2">
                            {columnTasks.map((task) => (
                              <div key={task.id} className="bg-white rounded-md border border-gray-200 p-3">
                                <div className="flex justify-between items-start">
                                  <span className="font-medium text-sm">{task.title}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-xs ${priorityColor(task.priority)}`}>
                                    {task.priority === "high" ? t.high : task.priority === "medium" ? t.medium : t.low}
                                  </span>
                                </div>
                                {task.description && (
                                  <p className="text-xs text-gray-500 mt-1">{task.description}</p>
                                )}
                                <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                                  {task.assignee && <span>{task.assignee}</span>}
                                  {task.due_date && <span>{new Date(task.due_date).toLocaleDateString()}</span>}
                                </div>
                                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                                  <div className="flex gap-1">
                                    {prevStatus(status) && (
                                      <button onClick={() => moveTask(task.id, prevStatus(status)!)} className="text-xs px-2 py-1 rounded bg-gray-100 cursor-pointer">{t.moveLeft}</button>
                                    )}
                                    {nextStatus(status) && (
                                      <button onClick={() => moveTask(task.id, nextStatus(status)!)} className="text-xs px-2 py-1 rounded bg-gray-100 cursor-pointer">{t.moveRight}</button>
                                    )}
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => startEditTask(task)} className="text-xs px-2 py-1 text-blue-600 cursor-pointer">{t.edit}</button>
                                    <button onClick={() => deleteTask(task.id)} className="text-xs px-2 py-1 text-red-600 cursor-pointer">{t.delete}</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
        {/* Groups Tab */}
        {activeTab === "groups" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t.groups}</h3>
              <button onClick={() => setShowGroupForm(true)} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-md text-sm font-medium cursor-pointer">{t.createGroup}</button>
            </div>

            {/* Create group form */}
            {showGroupForm && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t.groupName} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="color" value={groupColor} onChange={(e) => setGroupColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer border-0" />
                  <input type="text" value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} placeholder={t.description} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <button onClick={createGroup} disabled={!groupName.trim()} className="bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer">{t.save}</button>
                  <button onClick={() => setShowGroupForm(false)} className="text-gray-500 text-sm cursor-pointer">{t.cancel}</button>
                </div>
              </div>
            )}

            {groupsLoading ? (
              <p className="text-center py-8 text-gray-400">{t.loading}</p>
            ) : groups.length === 0 ? (
              <p className="text-center py-12 text-gray-400">{t.noGroups}</p>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50" onClick={() => { if (expandedGroup === g.id) { setExpandedGroupId(null); } else { setExpandedGroupId(g.id); fetchGroupMembers(g.id); } }}>
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: g.color }} />
                        <div>
                          <h4 className="font-medium text-sm">{g.name}</h4>
                          {g.description && <p className="text-xs text-gray-400">{g.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">{g.member_count} {t.members}</span>
                        <button onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }} className="text-xs text-red-500 hover:text-red-700 cursor-pointer">{t.delete}</button>
                        <span className="text-gray-400">{expandedGroup === g.id ? "▾" : "▸"}</span>
                      </div>
                    </div>
                    {expandedGroup === g.id && (
                      <div className="border-t border-gray-100 p-4 bg-gray-50">
                        {groupMembersLoading ? (
                          <p className="text-xs text-gray-400">{t.loading}</p>
                        ) : groupMembers.length === 0 ? (
                          <p className="text-xs text-gray-400">{isZh ? "暂无成员，在联系人 tab 选择联系人添加" : "No members. Select contacts in Contacts tab to add."}</p>
                        ) : (
                          <div className="space-y-1">
                            {groupMembers.map((m) => (
                              <div key={m.id} className="flex items-center justify-between text-xs py-1">
                                <span className="text-gray-700">{m.first_name} {m.last_name} — {m.email} {m.company ? `(${m.company})` : ""}</span>
                                <button onClick={() => removeFromGroup(g.id, m.id)} className="text-red-400 hover:text-red-600 cursor-pointer">{t.removeFromGroup}</button>
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
      </div>

      {/* Smart Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{t.smartImport}</h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer text-xl">&times;</button>
            </div>

            {/* Step 1: Paste */}
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-2">{t.importHint}</p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                placeholder={isZh
                  ? "粘贴任意格式的联系人信息...\n\n例如：\nJohn Smith <j***@company.com>; Jane Doe <j***@corp.com>\n或直接粘贴邮件列表、名片、通讯录文本\n\nAI 会自动识别并提取联系人"
                  : "Paste any format of contact info...\n\nExamples:\nJohn Smith <j***@company.com>; Jane Doe <j***@corp.com>\nOr paste email threads, business cards, address books\n\nAI will auto-detect and extract contacts"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={smartParse}
                disabled={!importText.trim() || importParsing}
                className="mt-2 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
              >
                {importParsing ? t.parsing : t.parse}
              </button>
            </div>

            {/* Step 2: Preview + Enrich */}
            {importParsed.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">{t.parsed} {importParsed.length} {t.records}</p>
                  <button
                    onClick={enrichImported}
                    disabled={importEnriching}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                  >
                    {importEnriching ? t.enriching : t.enrich}
                  </button>
                </div>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-3 py-2 text-left font-medium text-gray-600">{t.email}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">{t.name}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">{t.company}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">{t.position}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importParsed.map((c, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-800">{c.email}</td>
                          <td className="px-3 py-2 text-gray-600">{c.firstName} {c.lastName}</td>
                          <td className="px-3 py-2 text-gray-600">{c.company}</td>
                          <td className="px-3 py-2 text-gray-600">{c.position || <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Step 3: Source + Import */}
            {importParsed.length > 0 && (
              <div className="flex flex-col sm:flex-row items-end gap-3">
                <div className="flex-1 w-full">
                  <label className="text-xs text-gray-500 block mb-1">{isZh ? "来源备注" : "Source Note"}</label>
                  <input
                    type="text"
                    value={importSource}
                    onChange={(e) => setImportSource(e.target.value)}
                    placeholder={isZh ? "例如：LinkedIn 群组、展会名片、合作伙伴推荐..." : "e.g. LinkedIn group, trade show, partner referral..."}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                <button onClick={() => { setShowImport(false); setImportParsed([]); setImportText(""); setImportSource(""); }} className="px-4 py-2 text-sm text-gray-500 cursor-pointer">{t.cancel}</button>
                <button
                  onClick={saveImported}
                  disabled={importSaving || importDone}
                  className={`px-6 py-2 rounded-lg text-sm font-medium cursor-pointer ${importDone ? "bg-green-600 text-white" : "bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white"}`}
                >
                  {importDone ? t.imported : importSaving ? t.importing : t.importBtn}
                </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
