import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  ArrowUpRight,
  ArrowRight,
  LayoutDashboard,
  Columns3,
  ShieldCheck,
  Sparkles,
  FlaskConical,
  FolderCheck,
  Plus,
  Search,
  Download,
  Upload,
  Check,
  ChevronRight,
  X,
  AlertTriangle,
  Clock,
  Link2,
  Settings2,
  FileText,
  CalendarDays,
  Activity,
  CheckCircle2,
  GitBranch,
  Database,
  ExternalLink,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  Workspace,
  Task,
  Status,
  Risk,
  Measurement,
  Brief,
  Project,
} from "./types";
import { seedWorkspace } from "./demo";
import HandoverStudio from "./HandoverStudio";
import ProjectControl from "./ProjectControl";
import {
  analyze,
  canComplete,
  criticalPath,
  generateBrief,
  validateWorkspace,
  workspaceFingerprint,
} from "./lib/engine";
import { parseTasksCSV, exportTasksCSV } from "./lib/imports";
const KEY = "harbour-delivery.workspace.v1";
const statuses: Status[] = ["todo", "active", "blocked", "review", "done"];
const statusNames: Record<Status, string> = {
  todo: "待开始",
  active: "进行中",
  blocked: "受阻",
  review: "待验收",
  done: "已完成",
};
const nav = [
  {
    id: "handover",
    label: "资料移交建项",
    en: "AI project setup",
    icon: FileText,
  },
  { id: "overview", label: "交付总览", en: "Overview", icon: LayoutDashboard },
  { id: "delivery", label: "工作与排期", en: "Delivery", icon: Columns3 },
  { id: "planning", label: "基线与变更", en: "Plan control", icon: GitBranch },
  { id: "control", label: "风险与验收", en: "Governance", icon: ShieldCheck },
  { id: "brief", label: "AI 项目简报", en: "AI briefing", icon: Sparkles },
  { id: "lab", label: "本地模型实验", en: "Model lab", icon: FlaskConical },
  { id: "evidence", label: "度量与记录", en: "Evidence", icon: FolderCheck },
];
let recoveryRaw: string | null = null;
function initial() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
    if (saved) return validateWorkspace(JSON.parse(saved));
  } catch {
    recoveryRaw = saved;
  }
  return seedWorkspace();
}
const uid = (prefix: string) => prefix + "-" + crypto.randomUUID().slice(0, 8);
const money = (n: number) =>
  new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    maximumFractionDigits: 0,
  }).format(n);
const day = (v: string) => new Date(v + "T00:00:00Z").getTime() / 86400000;
function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"pill " + tone}>{children}</span>;
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <header>
          <div>
            <span className="eyebrow">HARBOUR WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" aria-label="关闭窗口" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export default function App() {
  const [ws, setWs] = useState<Workspace>(initial);
  const [tab, setTab] = useState("handover");
  const [selected, setSelected] = useState(ws.projects[0]?.id || "");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("board");
  const [editing, setEditing] = useState<Task | null>(null);
  const [showProject, setShowProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState<Project | null>(null);
  const [showRisk, setShowRisk] = useState(false);
  const [showMeasurement, setShowMeasurement] = useState(false);
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(
    recoveryRaw
      ? "原工作区无法校验，已保留原始内容且暂停自动保存。请在数据与连接中下载恢复文件。"
      : "",
  );
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState<"rules" | "ollama" | "openai">(
    "rules",
  );
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState("");
  const [token, setToken] = useState("");
  const [health, setHealth] = useState("尚未连接");
  const [evalData, setEvalData] = useState<any>(null);
  const [extractText, setExtractText] = useState(
    "项目验收准备；负责人 DemoLead-C；截止日期 2026-11-08；状态待审核；风险中。",
  );
  const [extractResult, setExtractResult] = useState<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (recoveryRaw) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(ws));
    } catch {
      setError("浏览器存储空间不足。请先导出备份，当前修改尚未保存。");
    }
  }, [ws]);
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "model-evaluation.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setEvalData)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const project = ws.projects.find((p) => p.id === selected) || ws.projects[0];
  const tasks = ws.tasks.filter((t) => t.projectId === project?.id);
  const risks = ws.risks.filter((r) => r.projectId === project?.id);
  const findings = useMemo(() => analyze(ws, project?.id), [ws, project?.id]);
  const cp = useMemo(() => criticalPath(tasks), [tasks]);
  const complete = tasks.filter(
    (t) => t.status === "done" && canComplete(t, ws.tasks).length === 0,
  ).length;
  const pct = tasks.length ? Math.round((complete / tasks.length) * 100) : 0;
  const filtered = tasks.filter((t) =>
    (t.title + t.owner + t.id + t.vendor)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const brief = ws.briefs.filter((b) => b.projectId === project?.id).at(-1);
  const stale =
    brief && brief.inputHash !== workspaceFingerprint(ws, project.id);
  const mutate = (
    action: string,
    entityId: string,
    detail: string,
    fn: (w: Workspace) => Workspace,
  ) =>
    setWs((w) => {
      const next = fn(w);
      try {
        return validateWorkspace({
          ...next,
          audit: [
            {
              id: uid("AUD"),
              at: new Date().toISOString(),
              action,
              entityId,
              detail,
            },
            ...w.audit,
          ].slice(0, 500),
        });
      } catch (e) {
        queueMicrotask(() => setError((e as Error).message));
        return w;
      }
    });
  const api = async (path: string, body?: unknown) => {
    const base = gateway.trim().replace(/\/$/, "");
    if (
      base &&
      !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)
    )
      throw new Error("AI 服务仅接受 HTTPS 或本机地址。");
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    let data;
    try {
      data = await r.json();
    } catch {
      throw new Error(
        "AI 服务未连接。GitHub Pages 提供静态演示；请启动本地 AI 服务后连接。",
      );
    }
    if (!r.ok)
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "AI 服务请求失败",
      );
    return data;
  };
  function newTask() {
    setEditing({
      id: uid("TASK"),
      projectId: project.id,
      title: "",
      owner: "",
      vendor: "",
      status: "todo",
      priority: "medium",
      start: ws.asOf,
      due: ws.asOf,
      dependencies: [],
      acceptance: "",
      accepted: false,
      evidence: "",
    });
  }
  function moveTask(t: Task, status: Status) {
    const candidate = { ...t, status };
    const reasons = status === "done" ? canComplete(candidate, ws.tasks) : [];
    if (reasons.length) {
      setError("暂不能完成：" + reasons.join("；"));
      return;
    }
    mutate("更新任务状态", t.id, statusNames[status], (w) => ({
      ...w,
      tasks: w.tasks.map((x) => (x.id === t.id ? candidate : x)),
    }));
  }
  function saveTask(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const t = editing;
    try {
      const reasons = t.status === "done" ? canComplete(t, ws.tasks) : [];
      if (reasons.length) throw new Error(reasons.join("；"));
      const next = {
        ...ws,
        tasks: [...ws.tasks.filter((x) => x.id !== t.id), t],
      };
      validateWorkspace(next);
      if (
        criticalPath(next.tasks.filter((x) => x.projectId === t.projectId))
          .cycle
      )
        throw new Error("依赖关系形成循环，请调整。");
      mutate("保存任务", t.id, t.title, () => next);
      setEditing(null);
      setNotice("任务已保存");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importFile(file: File) {
    try {
      if (file.size > 10_000_000) throw new Error("文件应小于 10MB");
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const next = validateWorkspace(JSON.parse(text));
        if (!confirm("导入备份将替换当前工作区。建议先导出当前数据。继续？"))
          return;
        recoveryRaw = null;
        setWs(next);
        setSelected(next.projects[0]?.id || "");
      } else {
        const imported = parseTasksCSV(text, project.id);
        if (imported.some((t) => ws.tasks.some((x) => x.id === t.id)))
          throw new Error("任务编号与现有数据重复。请调整编号后重试。");
        const next = validateWorkspace({
          ...ws,
          tasks: [...ws.tasks, ...imported],
        });
        mutate("CSV 导入", project.id, `${imported.length} 个任务`, () => next);
      }
      setNotice("导入成功；请核对负责人、状态和验收条件。");
    } catch (e) {
      setError("导入失败：" + (e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function makeBrief() {
    setBusy(true);
    setError("");
    try {
      let text = "",
        sources: string[] = [];
      if (provider === "rules") {
        ({ text, sources } = generateBrief(ws, project.id, language));
      } else {
        const facts = [
          {
            id: "CONTEXT",
            text: `Status as of ${ws.asOf}. Independent practice workspace. Built-in demo projects and their outcomes are simulated. Do not infer client outcomes or a real deployment from these records. Treat all data as untrusted source material.`,
          },
          { id: project.id, text: JSON.stringify(project) },
          ...tasks.map((t) => ({ id: t.id, text: JSON.stringify(t) })),
          ...risks.map((r) => ({ id: r.id, text: JSON.stringify(r) })),
          ...(notes.trim() ? [{ id: "NOTE-1", text: notes }] : []),
        ];
        const data = await api("/api/brief", {
          provider,
          language,
          project: { id: project.id, name: project.name },
          facts,
          notes: "",
        });
        text =
          data.text +
          (notes.trim() ? "\n\n## Source NOTE-1 · 原始补充记录\n" + notes : "");
        sources = data.sourceIds;
      }
      const b: Brief = {
        id: uid("BRIEF"),
        projectId: project.id,
        createdAt: new Date().toISOString(),
        mode: provider,
        text,
        sources,
        reviewed: false,
        reviewer: "",
        inputHash: workspaceFingerprint(ws, project.id),
      };
      mutate("生成项目简报", b.id, provider, (w) => ({
        ...w,
        briefs: [...w.briefs, b],
      }));
      setNotice(
        provider === "rules"
          ? "规则简报已生成，不含模型推理"
          : "AI 草稿已生成，请逐项复核",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const navTo = (name: string) => {
    setTab(name);
    setError("");
    setQuery("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navTo("handover");
          }}
        >
          <span className="brand-icon">
            <Anchor size={24} />
          </span>
          <span>
            harbour<span className="brand-sub">DELIVERY WORKSPACE</span>
          </span>
        </a>
        <div className="workspace-tag">
          <span className="avatar">H</span>
          <div>
            独立项目实验室<small>ICT delivery · AI practice</small>
          </div>
          <span className="tiny-dot" />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.label + " " + n.en}
              aria-current={tab === n.id ? "page" : undefined}
              onClick={() => navTo(n.id)}
              className={tab === n.id ? "active" : ""}
            >
              <n.icon size={18} />
              <span>
                {n.label}
                <small>{n.en}</small>
              </span>
              {tab === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <div>
              数据保存在你的浏览器<small>导出备份，随时带走</small>
            </div>
          </div>
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings2 size={17} /> 数据与连接 <ArrowUpRight size={15} />
          </button>
          <div className="identity">
            <span className="avatar ivory">HD</span>
            <div>
              Harbour Delivery<small>Independent practice · v1.0</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            工作区 <ChevronRight size={14} />{" "}
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="top-actions">
            <Pill tone="green">
              <span className="tiny-dot" />
              本地保存
            </Pill>
            <button
              className="icon-btn"
              aria-label="数据与连接"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
            </button>
            <span className="avatar outlined">HD</span>
          </div>
        </header>
        <div className="page-content">
          <div className="demo-banner">
            <span>
              <FlaskConical size={15} />
              演示工作区 · 内置项目数据均为模拟场景
            </span>
            <button onClick={() => navTo("evidence")}>
              查看证据边界 <ArrowRight size={14} />
            </button>
          </div>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "lab"
                  ? "LOCAL AI · MEASURE, THEN CLAIM"
                  : "FROM PLANNING TO PROOF"}
              </p>
              <h1>
                {
                  (
                    {
                      handover: "从移交资料，生成项目初始配置。",
                      overview: "让交付，每一步都有依据。",
                      delivery: "把计划变成实际交付。",
                      planning: "每次计划变化，都有清楚的依据。",
                      control: "在风险发生前，看见它。",
                      brief: "从项目事实，到清晰决策。",
                      lab: "本地部署。真实训练。独立评估。",
                      evidence: "度量流程改进，追溯操作依据。",
                    } as Record<string, string>
                  )[tab]
                }
              </h1>
              <p className="page-subtitle">
                {
                  (
                    {
                      handover:
                        "读懂招投标、合同与任务书，让要求、依据和交付计划连接起来。",
                      overview: "连接任务、供应商与验收，让下一步一目了然。",
                      delivery:
                        "看板与依赖排期共享同一份数据，完成状态由验收条件守住。",
                      planning: "比较原定计划、预览变更影响，记录决定后更新执行安排。",
                      control: "RAID、验收与移交，形成可追溯的项目控制链。",
                      brief: "规则负责核验，模型负责起草，项目经理负责判断。",
                      lab: "Qwen3 0.6B · Apple Silicon · LoRA 适配器 · 保留失败样例。",
                      evidence:
                        "区分模拟演示、个人实测和外部验收，以实际记录说明能力。",
                    } as Record<string, string>
                  )[tab]
                }
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="btn secondary"
                onClick={() =>
                  download(
                    "harbour-workspace.json",
                    JSON.stringify(ws, null, 2),
                    "application/json",
                  )
                }
              >
                <Download size={16} /> 导出工作区
              </button>
              {tab !== "handover" && (
                <button className="btn primary" onClick={newTask}>
                  <Plus size={17} /> 新建任务
                </button>
              )}
            </div>
          </div>
          {(notice || error) && (
            <div
              role={error ? "alert" : "status"}
              className={"toast " + (error ? "error" : "success")}
            >
              <span>{error || notice}</span>
              <button
                className="icon-btn"
                aria-label="关闭通知"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tab !== "handover" && (
            <div className="project-toolbar">
              <label className="project-select">
                <FolderCheck size={17} />
                <select
                  aria-label="选择项目"
                  value={project?.id}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setQuery("");
                  }}
                >
                  {ws.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="text-btn"
                onClick={() => {
                  setProjectDraft(null);
                  setShowProject(true);
                }}
              >
                <Plus size={15} />
                新建项目
              </button>
              <button
                className="text-btn"
                onClick={() => {
                  setProjectDraft(project);
                  setShowProject(true);
                }}
              >
                <Settings2 size={15} />
                项目设置
              </button>
              <label className="as-of">
                状态基准日{" "}
                <input
                  aria-label="状态基准日"
                  type="date"
                  value={ws.asOf}
                  onChange={(e) => {
                    if (e.target.value)
                      mutate(
                        "变更基准日",
                        "workspace",
                        e.target.value,
                        (w) => ({
                          ...w,
                          asOf: e.target.value,
                        }),
                      );
                  }}
                />
              </label>
            </div>
          )}
          <div hidden={tab !== "handover"}>
            <HandoverStudio
              workspace={ws}
              api={api}
              onConfigure={() => setSettings(true)}
              onApply={(next, projectId) => {
                setWs(validateWorkspace(next));
                setSelected(projectId);
                setNotice("已审核并建立新项目，原文与配置已归档。");
              }}
            />
          </div>
          {tab === "overview" && (
            <>
              <div className="metrics">
                <Metric
                  label="交付完成率"
                  value={pct + "%"}
                  sub={`${complete} / ${tasks.length} 项有效验收完成`}
                  icon={<CheckCircle2 />}
                  spark="progress"
                />
                <Metric
                  label="需要关注"
                  value={findings.filter((f) => f.severity !== "info").length}
                  sub="来自实时规则核验"
                  icon={<Activity />}
                  accent="amber"
                />
                <Metric
                  label="开放风险与问题"
                  value={risks.filter((r) => r.status === "open").length}
                  sub="明确责任 · 跟踪行动"
                  icon={<ShieldCheck />}
                />
                <Metric
                  label="项目预算使用"
                  value={
                    project.budget
                      ? Math.round((project.spent / project.budget) * 100) + "%"
                      : "—"
                  }
                  sub={`${money(project.spent)} / ${money(project.budget)}`}
                  icon={<Database />}
                />
              </div>
              <div className="overview-grid">
                <section className="panel delivery-pulse">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">DELIVERY PULSE</p>
                      <h2>项目交付脉搏</h2>
                    </div>
                    <Pill
                      tone={
                        findings.some((f) => f.severity === "critical")
                          ? "red"
                          : "green"
                      }
                    >
                      {findings.some((f) => f.severity === "critical")
                        ? "需要介入"
                        : "持续推进"}
                    </Pill>
                  </div>
                  <p className="muted">{project.description}</p>
                  <div className="phase-flow">
                    {statuses.map((s, i) => (
                      <div key={s}>
                        <span className={"phase-circle " + s}>
                          {s === "done" ? <Check size={17} /> : i + 1}
                        </span>
                        <strong>{statusNames[s]}</strong>
                        <span>
                          {tasks.filter((t) => t.status === s).length} 项
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="segmented-progress">
                    {statuses.map((s) => (
                      <span
                        key={s}
                        className={s}
                        style={{
                          flex: tasks.filter((t) => t.status === s).length,
                        }}
                      />
                    ))}
                  </div>
                  <div className="panel-foot">
                    <span>
                      <CalendarDays size={15} /> 目标交付 {project.target}
                    </span>
                    <button
                      className="text-btn"
                      onClick={() => navTo("delivery")}
                    >
                      打开交付计划 <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
                <section className="insight-card">
                  <div className="insight-icon">
                    <Sparkles size={22} />
                  </div>
                  <p className="eyebrow">YOUR NEXT BEST ACTION</p>
                  <h2>{findings[0]?.title || "保持交付节奏"}</h2>
                  <p>
                    {findings[0]?.detail ||
                      "当前没有规则告警。检查最新进度，并为下一里程碑准备验收证据。"}
                  </p>
                  <div className="source-chips">
                    {findings[0]?.sourceIds.map((s) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  <button className="btn light" onClick={() => navTo("brief")}>
                    生成项目简报 <ArrowUpRight size={17} />
                  </button>
                  <small>依据结构化数据识别 · 不是模型预测</small>
                </section>
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>近期里程碑</h2>
                    <button
                      className="text-btn"
                      onClick={() => {
                        setView("timeline");
                        navTo("delivery");
                      }}
                    >
                      查看排期 <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {tasks
                    .filter((t) => t.status !== "done")
                    .sort((a, b) => a.due.localeCompare(b.due))
                    .slice(0, 5)
                    .map((t) => (
                      <button
                        className="milestone-row"
                        key={t.id}
                        onClick={() => setEditing(t)}
                      >
                        <span className={"status-square " + t.status} />
                        <div>
                          <strong>{t.title}</strong>
                          <small>
                            {t.owner || "负责人待定"} · {t.vendor || "内部团队"}
                          </small>
                        </div>
                        <span className={t.due < ws.asOf ? "overdue" : ""}>
                          {t.due.slice(5)}
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>交付关注清单</h2>
                    <Pill>{findings.length} 项信号</Pill>
                  </div>
                  {findings.slice(0, 4).map((f) => (
                    <div className="finding" key={f.id}>
                      <AlertTriangle size={17} className={f.severity} />
                      <div>
                        <strong>{f.title}</strong>
                        <p>{f.detail}</p>
                        <small>{f.sourceIds.join(" · ")}</small>
                      </div>
                    </div>
                  ))}
                  {!findings.length && (
                    <Empty text="暂无异常信号。保持证据与状态同步。" />
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "planning" && (
            <ProjectControl
              key={project.id}
              workspace={ws}
              projectId={project.id}
              onOpenDelivery={() => { navTo("delivery"); setView("timeline"); }}
              onCommit={(next, action, entityId, detail) => {
                mutate(action, entityId, detail, () => next);
              }}
            />
          )}
          {tab === "delivery" && (
            <>
              <div className="section-toolbar">
                <div className="tabs">
                  {["board", "timeline", "list"].map((v) => (
                    <button
                      key={v}
                      className={view === v ? "selected" : ""}
                      onClick={() => setView(v)}
                    >
                      {v === "board"
                        ? "看板"
                        : v === "timeline"
                          ? "依赖排期"
                          : "任务列表"}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索任务"
                    placeholder="搜索任务、负责人、供应商…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button
                  className="btn secondary"
                  onClick={() =>
                    download(
                      "harbour-tasks.csv",
                      exportTasksCSV(tasks),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <Download size={16} />
                  CSV
                </button>
              </div>
              {view === "board" ? (
                <div className="kanban">
                  {statuses.map((s) => (
                    <section
                      className="kanban-column"
                      key={s}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const t = tasks.find(
                          (t) => t.id === e.dataTransfer.getData("text/plain"),
                        );
                        if (t) moveTask(t, s);
                      }}
                    >
                      <header>
                        <span className={"status-dot " + s} />
                        <strong>{statusNames[s]}</strong>
                        <span>
                          {filtered.filter((t) => t.status === s).length}
                        </span>
                      </header>
                      {filtered
                        .filter((t) => t.status === s)
                        .map((t) => (
                          <article
                            key={t.id}
                            className="task-card"
                            draggable
                            onDragStart={(e) =>
                              e.dataTransfer.setData("text/plain", t.id)
                            }
                          >
                            <div className="task-top">
                              <span>{t.id}</span>
                              <Pill
                                tone={
                                  t.priority === "high" ? "amber" : "neutral"
                                }
                              >
                                {t.priority === "high" ? "高优先" : "常规"}
                              </Pill>
                            </div>
                            <button
                              className="task-title"
                              onClick={() => setEditing(t)}
                            >
                              {t.title}
                            </button>
                            <p className="vendor">{t.vendor || "内部协作"}</p>
                            {t.dependencies.length > 0 && (
                              <div className="dependency-tag">
                                <GitBranch size={12} />
                                {t.dependencies.length} 项前置依赖
                              </div>
                            )}
                            <div className="task-bottom">
                              <span className="person">
                                <span className="avatar mini">
                                  {t.owner?.slice(0, 1) || "?"}
                                </span>
                                {t.owner || "待分配"}
                              </span>
                              <span
                                className={
                                  t.due < ws.asOf && s !== "done"
                                    ? "overdue"
                                    : ""
                                }
                              >
                                <Clock size={12} />
                                {t.due.slice(5)}
                              </span>
                            </div>
                            <select
                              aria-label={"移动任务 " + t.id}
                              value={s}
                              onChange={(e) =>
                                moveTask(t, e.target.value as Status)
                              }
                            >
                              {statuses.map((st) => (
                                <option value={st} key={st}>
                                  {statusNames[st]}
                                </option>
                              ))}
                            </select>
                          </article>
                        ))}
                      <button
                        className="add-task"
                        onClick={() => {
                          newTask();
                          setEditing((t) =>
                            t
                              ? { ...t, status: s === "done" ? "todo" : s }
                              : null,
                          );
                        }}
                      >
                        <Plus size={14} />
                        添加任务
                      </button>
                    </section>
                  ))}
                </div>
              ) : view === "timeline" ? (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>关键路径与时间依赖</h2>
                      <p className="muted">
                        基于日历天、完成后开始（FS）关系计算；不包含资源平衡。
                      </p>
                    </div>
                    <Pill tone="green">理论路径 {cp.duration} 天</Pill>
                  </div>
                  {cp.cycle && (
                    <div className="inline-warning">
                      存在循环依赖，关键路径不可计算。
                    </div>
                  )}
                  <div className="timeline">
                    {filtered.map((t) => {
                      const min = Math.min(...tasks.map((x) => day(x.start)));
                      const max = Math.max(...tasks.map((x) => day(x.due)));
                      const span = Math.max(1, max - min + 1);
                      return (
                        <div className="timeline-row" key={t.id}>
                          <button onClick={() => setEditing(t)}>
                            <strong>{t.title}</strong>
                            <small>
                              {t.start.slice(5)} → {t.due.slice(5)} · 浮时{" "}
                              {cp.slack[t.id] ?? "—"} 天
                            </small>
                          </button>
                          <div className="timeline-track">
                            <div
                              title={`${t.id} · ${t.dependencies.join(", ") || "无前置"}`}
                              className={
                                "timeline-bar " +
                                (cp.criticalIds.includes(t.id)
                                  ? "critical-path"
                                  : "")
                              }
                              style={{
                                left: `${((day(t.start) - min) / span) * 100}%`,
                                width: `${Math.max(2, ((day(t.due) - day(t.start) + 1) / span) * 100)}%`,
                              }}
                            >
                              {t.id}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="caption">
                    深绿色：关键路径任务。横条显示录入日期；浮时来自依赖网络，不自动重排计划。
                  </p>
                </section>
              ) : (
                <section className="panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>任务</th>
                        <th>负责人</th>
                        <th>状态</th>
                        <th>日期</th>
                        <th>验收证据</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <button
                              className="text-btn"
                              onClick={() => setEditing(t)}
                            >
                              {t.id} · {t.title}
                            </button>
                          </td>
                          <td>{t.owner || "待定"}</td>
                          <td>
                            <Pill
                              tone={
                                t.status === "done"
                                  ? "green"
                                  : t.status === "blocked"
                                    ? "red"
                                    : "neutral"
                              }
                            >
                              {statusNames[t.status]}
                            </Pill>
                          </td>
                          <td>{t.due}</td>
                          <td>{t.evidence ? "已记录" : "待补充"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          )}
          {tab === "control" && (
            <>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">RAID REGISTER</p>
                      <h2>风险、问题与依赖</h2>
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() => setShowRisk(true)}
                    >
                      <Plus size={15} />
                      记录
                    </button>
                  </div>
                  {risks.map((r) => (
                    <div className="risk-card" key={r.id}>
                      <div>
                        <Pill
                          tone={r.impact * r.likelihood >= 6 ? "red" : "amber"}
                        >
                          {r.type.toUpperCase()} · {r.impact * r.likelihood}/9
                        </Pill>
                        <small>{r.id}</small>
                      </div>
                      <h3>{r.title}</h3>
                      <p>{r.mitigation}</p>
                      <footer>
                        <span>
                          {r.owner || "负责人待定"} · {r.taskId || "项目级"}
                        </span>
                        <select
                          aria-label={"风险状态 " + r.id}
                          value={r.status}
                          onChange={(e) =>
                            mutate("更新风险", r.id, e.target.value, (w) => ({
                              ...w,
                              risks: w.risks.map((x) =>
                                x.id === r.id
                                  ? {
                                      ...x,
                                      status: e.target.value as Risk["status"],
                                    }
                                  : x,
                              ),
                            }))
                          }
                        >
                          <option value="open">开放</option>
                          <option value="mitigated">已缓解</option>
                          <option value="closed">已关闭</option>
                        </select>
                      </footer>
                    </div>
                  ))}
                  {!risks.length && (
                    <Empty text="还没有风险记录。记录已识别的风险或关键假设。" />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">ACCEPTANCE & HANDOVER</p>
                      <h2>验收移交关卡</h2>
                    </div>
                    <ShieldCheck size={21} />
                  </div>
                  <p className="muted">
                    完成任务需要：前置依赖完成、验收条件、验收确认及证据记录。
                  </p>
                  {tasks.map((t) => (
                    <button
                      key={t.id}
                      className="acceptance-row"
                      onClick={() => setEditing(t)}
                    >
                      <span
                        className={
                          "check-icon " +
                          (!canComplete(t, ws.tasks).length ? "pass" : "")
                        }
                      >
                        {!canComplete(t, ws.tasks).length ? (
                          <Check size={16} />
                        ) : (
                          <Clock size={16} />
                        )}
                      </span>
                      <div>
                        <strong>{t.title}</strong>
                        <small>
                          {canComplete(t, ws.tasks).join(" · ") ||
                            "验收条件齐备"}
                        </small>
                      </div>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </section>
              </div>
            </>
          )}
          {tab === "brief" && (
            <div className="brief-grid">
              <section className="panel briefing-config">
                <p className="eyebrow">BRIEFING STUDIO</p>
                <h2>基于事实生成</h2>
                <label>
                  生成方式
                  <select
                    value={provider}
                    onChange={(e) =>
                      setProvider(e.target.value as typeof provider)
                    }
                  >
                    <option value="rules">规则摘要 · 无需模型</option>
                    <option value="ollama">本地 Ollama · Qwen3</option>
                    <option value="openai">OpenAI · 服务端 API</option>
                  </select>
                </label>
                <label>
                  输出语言
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as "zh" | "en")}
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  会议记录／补充上下文
                  <textarea
                    rows={7}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="可选。模型模式会使用这些记录；规则模式仅处理结构化台账。"
                  />
                </label>
                <div className="small-info">
                  <ShieldCheck size={17} />
                  <span>
                    模型草稿不会自动修改任务。外部模型模式会将所选项目数据发送给你配置的
                    AI 服务。
                  </span>
                </div>
                <button
                  className="btn primary full"
                  disabled={busy}
                  onClick={makeBrief}
                >
                  <Sparkles size={17} />
                  {busy ? "正在生成…" : "生成项目简报"}
                </button>
                <button className="text-btn" onClick={() => setSettings(true)}>
                  设置 AI 服务连接 <ArrowUpRight size={14} />
                </button>
              </section>
              <section className="panel report-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">PROJECT DELIVERY BRIEF</p>
                    <h2>{project.name}</h2>
                  </div>
                  {brief && (
                    <Pill
                      tone={
                        stale ? "amber" : brief.reviewed ? "green" : "neutral"
                      }
                    >
                      {stale
                        ? "数据已变更"
                        : brief.reviewed
                          ? "已人工复核"
                          : "待人工复核"}
                    </Pill>
                  )}
                </div>
                {brief ? (
                  <>
                    <div className="report-meta">
                      <span>{new Date(brief.createdAt).toLocaleString()}</span>
                      <span>
                        {brief.mode === "rules"
                          ? "规则生成 · 非 AI"
                          : brief.mode + " · 模型生成"}
                      </span>
                    </div>
                    {stale && (
                      <div className="inline-warning">
                        数据已更新，请重新生成再复核。
                      </div>
                    )}
                    <pre className="report-text">{brief.text}</pre>
                    <div className="source-block">
                      <strong>可追溯来源</strong>
                      <div className="source-chips">
                        {brief.sources.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              const t = tasks.find((t) => t.id === s);
                              if (t) setEditing(t);
                              else
                                setNotice(
                                  s === "NOTE-1"
                                    ? "生成时的会议记录已保存在本简报末尾 Source NOTE-1"
                                    : "来源编号：" + s,
                                );
                            }}
                          >
                            {s}
                            <Link2 size={11} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="report-actions">
                      <input
                        aria-label="复核人"
                        placeholder="填写复核人姓名"
                        value={brief.reviewer}
                        onChange={(e) =>
                          setWs((w) => ({
                            ...w,
                            briefs: w.briefs.map((b) =>
                              b.id === brief.id
                                ? {
                                    ...b,
                                    reviewer: e.target.value,
                                    reviewed: false,
                                  }
                                : b,
                            ),
                          }))
                        }
                      />
                      <button
                        className="btn primary"
                        disabled={
                          !!stale || !brief.reviewer.trim() || brief.reviewed
                        }
                        onClick={() =>
                          mutate(
                            "人工复核简报",
                            brief.id,
                            brief.reviewer,
                            (w) => ({
                              ...w,
                              briefs: w.briefs.map((b) =>
                                b.id === brief.id
                                  ? { ...b, reviewed: true }
                                  : b,
                              ),
                            }),
                          )
                        }
                      >
                        <Check size={16} />
                        确认已核对
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() =>
                          download(
                            "project-brief.md",
                            `# ${project.name}\n\n${stale ? "STALE — data changed" : brief.reviewed ? "Reviewed by " + brief.reviewer : "DRAFT — not reviewed"}\nMode: ${brief.mode}\n\n${brief.text}\n\nSources: ${brief.sources.join(", ")}`,
                          )
                        }
                      >
                        <Download size={16} />
                        导出
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty text="选择生成方式，生成一份带来源的简报。" />
                )}
              </section>
            </div>
          )}
          {tab === "lab" && (
            <>
              <div className="model-hero">
                <div>
                  <Pill tone="green">ON-DEVICE AI</Pill>
                  <h2>小模型，做一件可验证的事。</h2>
                  <p>
                    从项目记录抽取负责人、日期、状态和风险。微调只针对结构化抽取；项目简报由独立推理流程生成。
                  </p>
                  <div className="model-tags">
                    <span>Qwen3 · 0.6B</span>
                    <span>4-bit quantization</span>
                    <span>MLX · LoRA</span>
                    <span>本地数据处理</span>
                  </div>
                </div>
                <div className="model-symbol">
                  <FlaskConical size={54} />
                  <span>TRAIN → EVALUATE → DEPLOY</span>
                </div>
              </div>
              <div className="two-col">
                <section className="panel">
                  <p className="eyebrow">LIVE INFERENCE</p>
                  <h2>试用本地适配器</h2>
                  <label>
                    项目记录 · 来源 NOTE-01
                    <textarea
                      rows={7}
                      value={extractText}
                      onChange={(e) => setExtractText(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setExtractResult(null);
                      setError("");
                      try {
                        setExtractResult(
                          await api("/api/extract", {
                            text: extractText,
                            sourceId: "NOTE-01",
                            model: "adapted",
                          }),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Sparkles size={16} />
                    {busy ? "正在抽取…" : "本地模型抽取"}
                  </button>
                  <button
                    className="text-btn"
                    onClick={() => setSettings(true)}
                  >
                    连接本机服务
                  </button>
                  {extractResult && (
                    <pre className="code-result">
                      {JSON.stringify(extractResult, null, 2)}
                    </pre>
                  )}
                  <p className="caption">
                    在线静态演示不提供云端推理。运行本地网关和模型服务后，此按钮调用真实模型。
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">REPRODUCIBLE EXPERIMENT</p>
                      <h2>微调前后 · 实验记录</h2>
                    </div>
                    <Pill>{evalData ? "实测文件" : "尚未加载"}</Pill>
                  </div>
                  <p className="muted">
                    合成数据、独立测试集、固定解码条件。训练成功与能力提升分别评价。
                  </p>
                  {evalData ? (
                    <>
                      <EvalSummary data={evalData} />
                      <details>
                        <summary>查看完整评估记录</summary>
                        <pre className="code-result">
                          {JSON.stringify(evalData, null, 2)}
                        </pre>
                      </details>
                      <a
                        className="text-btn"
                        href={
                          import.meta.env.BASE_URL + "model-evaluation.json"
                        }
                        download
                      >
                        下载评估 JSON <Download size={14} />
                      </a>
                    </>
                  ) : (
                    <Empty text="训练和评估结果准备中。没有结果时不展示预测的提升数字。" />
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "evidence" && (
            <>
              <div className="evidence-intro">
                <div>
                  <p className="eyebrow">MEASUREMENT & TRACEABILITY</p>
                  <h2>工作流度量与验证记录</h2>
                  <p>
                    记录流程耗时、质量变化与复核操作。将模拟数据和实测结果分别标识，便于比较与复现。
                  </p>
                </div>
                <Pill tone="green">AI 辅助开发 · 透明记录</Pill>
              </div>
              <div className="three-col">
                <EvidenceCard
                  title="交付流程"
                  desc="任务依赖、风险处理、验收关卡与移交，形成完整工作流。"
                  tag="产品与测试"
                  icon={<GitBranch />}
                />
                <EvidenceCard
                  title="AI 输出复核"
                  desc="区分规则、模型输出与人工决定，保留失败、来源和评估结果。"
                  tag="本地推理与微调"
                  icon={<FlaskConical />}
                />
                <EvidenceCard
                  title="数据来源"
                  desc="模拟指标与个人实测独立标识，外部业务效果需要组织验收。"
                  tag="边界与追溯"
                  icon={<ShieldCheck />}
                />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>工作流测量台账</h2>
                    <p className="muted">
                      耗时必须包含人工复核；测试样本规模与复核人一同记录。
                    </p>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => setShowMeasurement(true)}
                  >
                    <Plus size={15} />
                    记录一次测量
                  </button>
                </div>
                <div className="measurement-grid">
                  {ws.measurements
                    .filter((m) => m.projectId === project.id)
                    .map((m) => (
                      <div className="measurement" key={m.id}>
                        <div>
                          <Pill
                            tone={
                              m.provenance === "simulation" ? "amber" : "green"
                            }
                          >
                            {m.provenance === "simulation"
                              ? "模拟数据"
                              : "个人实测"}
                          </Pill>
                          <small>{m.date}</small>
                        </div>
                        <h3>{m.label}</h3>
                        <div className="compare">
                          <span>
                            {m.before}
                            <small>原流程 / 分钟</small>
                          </span>
                          <ArrowRight size={20} />
                          <span>
                            {m.after}
                            <small>辅助后 / 分钟</small>
                          </span>
                        </div>
                        <p>
                          含复核耗时变化{" "}
                          <strong>
                            {m.before
                              ? Math.round(
                                  ((m.before - m.after) / m.before) * 100,
                                )
                              : 0}
                            %
                          </strong>{" "}
                          · {m.sampleSize} 个样本
                        </p>
                        <small>
                          错误 {m.beforeErrors} → {m.afterErrors} · 复核：
                          {m.reviewer}
                        </small>
                      </div>
                    ))}
                </div>
              </section>
              <div className="two-col">
                <section className="panel">
                  <h2>系统设计与验证</h2>
                  <p className="muted">
                    本系统使用 AI
                    辅助开发。内置项目数据为模拟场景；模型评估来自实际运行，业务效果需另外验证。
                  </p>
                  <ol className="practice-list">
                    <li>
                      <strong>问题</strong>多方 ICT
                      交付中的状态、风险与验收证据分散。
                    </li>
                    <li>
                      <strong>方案</strong>
                      统一数据模型＋确定性检查＋模型辅助起草＋人工审核。
                    </li>
                    <li>
                      <strong>取舍</strong>
                      静态站本地存储，模型独立运行；先验证流程与模型边界。
                    </li>
                    <li>
                      <strong>验证</strong>
                      自动化测试、浏览器操作和微调前后独立测试集。
                    </li>
                    <li>
                      <strong>下一步</strong>
                      与真实组织约定试点范围，再测采用率和业务价值。
                    </li>
                  </ol>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>操作与复核记录</h2>
                    <Pill>{ws.audit.length} 条</Pill>
                  </div>
                  <div className="audit-list">
                    {ws.audit.slice(0, 10).map((a) => (
                      <div key={a.id}>
                        <span className="audit-dot" />
                        <div>
                          <strong>{a.action}</strong>
                          <p>
                            {a.entityId} · {a.detail}
                          </p>
                          <small>{new Date(a.at).toLocaleString()}</small>
                        </div>
                      </div>
                    ))}
                    {!ws.audit.length && (
                      <Empty text="修改任务、生成简报或记录测量后，这里会保留操作记录。" />
                    )}
                  </div>
                  <p className="caption">
                    本地操作记录可编辑、可导出，不是第三方审计证明。
                  </p>
                </section>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              <Anchor size={14} />
              HARBOUR DELIVERY
            </span>
            <span>Plan with clarity. Deliver with evidence.</span>
            <span>
              模拟项目 · 独立实践 ·{" "}
              <a
                href="https://github.com/zivmryang/harbour-delivery"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub 源码
              </a>
            </span>
          </footer>
        </div>
      </main>
      {editing && (
        <Modal
          title={
            ws.tasks.some((t) => t.id === editing.id)
              ? "编辑交付任务"
              : "新建交付任务"
          }
          onClose={() => setEditing(null)}
        >
          <form onSubmit={saveTask} className="form-grid">
            <label className="full-width">
              任务名称
              <input
                required
                maxLength={200}
                value={editing.title}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
              />
            </label>
            <label>
              负责人
              <input
                value={editing.owner}
                onChange={(e) =>
                  setEditing({ ...editing, owner: e.target.value })
                }
              />
            </label>
            <label>
              供应商／团队
              <input
                value={editing.vendor}
                onChange={(e) =>
                  setEditing({ ...editing, vendor: e.target.value })
                }
              />
            </label>
            <label>
              开始日期
              <input
                required
                type="date"
                value={editing.start}
                onChange={(e) =>
                  setEditing({ ...editing, start: e.target.value })
                }
              />
            </label>
            <label>
              截止日期
              <input
                required
                type="date"
                min={editing.start}
                value={editing.due}
                onChange={(e) =>
                  setEditing({ ...editing, due: e.target.value })
                }
              />
            </label>
            <label>
              状态
              <select
                value={editing.status}
                onChange={(e) =>
                  setEditing({ ...editing, status: e.target.value as Status })
                }
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusNames[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              优先级
              <select
                value={editing.priority}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    priority: e.target.value as Task["priority"],
                  })
                }
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <label className="full-width">
              前置任务（可多选）
              <select
                multiple
                value={editing.dependencies}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    dependencies: Array.from(
                      e.target.selectedOptions,
                      (x) => x.value,
                    ),
                  })
                }
              >
                {tasks
                  .filter((t) => t.id !== editing.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} · {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="full-width">
              验收条件
              <textarea
                rows={2}
                value={editing.acceptance}
                onChange={(e) =>
                  setEditing({ ...editing, acceptance: e.target.value })
                }
              />
            </label>
            <label className="full-width">
              验收证据（记录编号、文件位置或说明）
              <input
                value={editing.evidence}
                onChange={(e) =>
                  setEditing({ ...editing, evidence: e.target.value })
                }
              />
            </label>
            <label className="checkbox-label full-width">
              <input
                type="checkbox"
                checked={editing.accepted}
                onChange={(e) =>
                  setEditing({ ...editing, accepted: e.target.checked })
                }
              />
              已核对并确认验收通过
            </label>
            <div className="modal-footer full-width">
              {ws.tasks.some((t) => t.id === editing.id) && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    if (
                      ws.tasks.some((t) =>
                        t.dependencies.includes(editing.id),
                      ) ||
                      ws.risks.some((r) => r.taskId === editing.id)
                    ) {
                      setError("此任务仍被依赖或风险引用，请先调整引用。");
                      return;
                    }
                    if (confirm("删除此任务？可通过已有备份恢复。")) {
                      mutate("删除任务", editing.id, editing.title, (w) => ({
                        ...w,
                        tasks: w.tasks.filter((t) => t.id !== editing.id),
                      }));
                      setEditing(null);
                    }
                  }}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              )}
              <button
                type="button"
                className="btn secondary"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className="btn primary" type="submit">
                保存任务
              </button>
            </div>
          </form>
        </Modal>
      )}
      {showProject && (
        <Modal
          title={projectDraft ? "项目设置" : "新建项目"}
          onClose={() => setShowProject(false)}
        >
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const p: Project = {
                id: projectDraft?.id || uid("PRJ"),
                name: String(f.get("name")).trim(),
                client: String(f.get("client")).trim(),
                description: String(f.get("description")).trim(),
                budget: Number(f.get("budget")),
                spent: Number(f.get("spent")),
                target: String(f.get("target")),
                category: projectDraft?.category || "ICT delivery",
              };
              try {
                validateWorkspace({
                  ...ws,
                  projects: projectDraft
                    ? ws.projects.map((x) => (x.id === p.id ? p : x))
                    : [...ws.projects, p],
                });
                mutate(
                  projectDraft ? "更新项目设置" : "创建项目",
                  p.id,
                  p.name,
                  (w) => ({
                    ...w,
                    projects: projectDraft
                      ? w.projects.map((x) => (x.id === p.id ? p : x))
                      : [...w.projects, p],
                  }),
                );
                setSelected(p.id);
                setShowProject(false);
                setNotice("项目已保存");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <label className="full-width">
              项目名称
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={projectDraft?.name || ""}
              />
            </label>
            <label className="full-width">
              组织／项目背景
              <input
                name="client"
                required
                placeholder="个人实践 / 组织名称"
                defaultValue={projectDraft?.client || ""}
              />
            </label>
            <label className="full-width">
              目标与范围
              <textarea
                name="description"
                required
                defaultValue={projectDraft?.description || ""}
              />
            </label>
            <label>
              预算（HKD）
              <input
                name="budget"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={projectDraft?.budget || 0}
              />
            </label>
            <label>
              已支出（HKD）
              <input
                name="spent"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={projectDraft?.spent || 0}
              />
            </label>
            <label>
              目标日期
              <input
                name="target"
                type="date"
                required
                defaultValue={projectDraft?.target || ws.asOf}
              />
            </label>
            <p className="caption full-width">
              预算与支出为手动记录，用于项目状态核对；不连接财务系统。
            </p>
            <div className="modal-footer full-width">
              <button className="btn primary">
                {projectDraft ? "保存项目" : "创建项目"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {showRisk && (
        <Modal title="记录风险或问题" onClose={() => setShowRisk(false)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r: Risk = {
                id: uid("RAID"),
                projectId: project.id,
                title: String(f.get("title")),
                type: String(f.get("type")) as Risk["type"],
                owner: String(f.get("owner")),
                impact: Number(f.get("impact")) as 1 | 2 | 3,
                likelihood: Number(f.get("likelihood")) as 1 | 2 | 3,
                status: "open",
                mitigation: String(f.get("mitigation")),
                taskId: String(f.get("taskId")),
              };
              mutate("新增风险记录", r.id, r.title, (w) => ({
                ...w,
                risks: [...w.risks, r],
              }));
              setShowRisk(false);
            }}
          >
            <label className="full-width">
              内容
              <input name="title" required />
            </label>
            <label>
              类型
              <select name="type">
                <option value="risk">风险 Risk</option>
                <option value="issue">问题 Issue</option>
                <option value="assumption">假设 Assumption</option>
                <option value="dependency">依赖 Dependency</option>
              </select>
            </label>
            <label>
              负责人
              <input name="owner" required />
            </label>
            <label>
              影响
              <select name="impact">
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              可能性
              <select name="likelihood">
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="full-width">
              关联任务
              <select name="taskId">
                <option value="">项目级</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} · {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="full-width">
              应对措施
              <textarea name="mitigation" required />
            </label>
            <div className="modal-footer full-width">
              <button className="btn primary">保存记录</button>
            </div>
          </form>
        </Modal>
      )}
      {showMeasurement && (
        <Modal title="记录工作流测量" onClose={() => setShowMeasurement(false)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const m: Measurement = {
                id: uid("MEASURE"),
                projectId: project.id,
                label: String(f.get("label")),
                before: Number(f.get("before")),
                after: Number(f.get("after")),
                beforeErrors: Number(f.get("beforeErrors")),
                afterErrors: Number(f.get("afterErrors")),
                sampleSize: Number(f.get("samples")),
                reviewer: String(f.get("reviewer")),
                date: ws.asOf,
                provenance: String(
                  f.get("provenance"),
                ) as Measurement["provenance"],
              };
              mutate("记录流程测量", m.id, m.label, (w) => ({
                ...w,
                measurements: [...w.measurements, m],
              }));
              setShowMeasurement(false);
            }}
          >
            <label className="full-width">
              测量内容
              <input
                name="label"
                required
                placeholder="例如：10份项目周报的处理总耗时"
              />
            </label>
            {[
              { n: "before", l: "原流程总耗时（分钟）", v: 30 },
              { n: "after", l: "辅助后总耗时，含复核", v: 20 },
              { n: "beforeErrors", l: "原流程错误数", v: 0 },
              { n: "afterErrors", l: "辅助后错误数", v: 0 },
              { n: "samples", l: "同类样本数量", v: 10 },
            ].map((x) => (
              <label key={x.n}>
                {x.l}
                <input
                  type="number"
                  name={x.n}
                  min={x.n === "before" || x.n === "samples" ? 1 : 0}
                  required
                  defaultValue={x.v}
                />
              </label>
            ))}
            <label>
              复核人
              <input name="reviewer" required />
            </label>
            <label className="full-width">
              数据性质
              <select name="provenance">
                <option value="simulation">模拟数据</option>
                <option value="measured">
                  个人实测（已完成并保留原始记录）
                </option>
              </select>
            </label>
            <div className="modal-footer full-width">
              <button className="btn primary">保存测量</button>
            </div>
          </form>
        </Modal>
      )}
      {settings && (
        <Modal title="数据与连接" onClose={() => setSettings(false)}>
          <section className="settings-section">
            <h3>工作区数据</h3>
            {recoveryRaw && (
              <button
                className="btn danger"
                onClick={() =>
                  download("workspace-recovery.json", recoveryRaw || "")
                }
              >
                下载保留的原始工作区
              </button>
            )}
            <p>
              数据仅保存在当前浏览器。导出 JSON 可完整迁移；CSV
              用于任务数据交换。
            </p>
            <div className="button-row">
              <button
                className="btn secondary"
                onClick={() =>
                  download(
                    "harbour-workspace.json",
                    JSON.stringify(ws, null, 2),
                    "application/json",
                  )
                }
              >
                <Download size={15} />
                完整备份
              </button>
              <button
                className="btn secondary"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={15} />
                导入 JSON / CSV
              </button>
              <a
                className="btn secondary"
                href={import.meta.env.BASE_URL + "samples/tasks.csv"}
                download
              >
                CSV 模板
              </a>
            </div>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".json,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
              }}
            />
            <p className="caption">
              支持标准任务 CSV 与 Jira 常见导出列。Notion、飞书、Smartsheet
              等请先映射到模板。当前不提供这些平台的在线 API 同步。
            </p>
          </section>
          <section className="settings-section">
            <h3>AI 服务连接</h3>
            <p>
              本地开发留空，通过 Vite 代理访问。在线站需填写你自己的 HTTPS
              网关或获浏览器允许的本机服务。
            </p>
            <label>
              服务地址
              <input
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                placeholder="http://127.0.0.1:8787"
              />
            </label>
            <label>
              网关访问令牌（仅本次会话）
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="公网网关需要令牌；不要在这里填模型 API key"
              />
            </label>
            <div className="button-row">
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    const data = await api("/api/health");
                    setHealth(JSON.stringify(data));
                    setNotice("AI 服务已连接");
                  } catch (e) {
                    setHealth((e as Error).message);
                  }
                }}
              >
                <RefreshCw size={15} />
                测试连接
              </button>
            </div>
            <pre className="health-result">{health}</pre>
            <p className="caption">
              模型密钥仅由后端环境变量提供。GitHub Pages
              不托管模型，也不自动上传工作区。
            </p>
          </section>
          <section className="settings-section">
            <h3>参考的工具模式</h3>
            <div className="tool-pills">
              {[
                "Jira / Linear · 状态流",
                "Notion · 知识沉淀",
                "Project / P6 · 依赖排期",
                "Smartsheet · 项目控制",
                "飞书 / 钉钉 · 流程协作",
              ].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <p className="caption">
              这是独立实现的交付工作台，非上述产品的官方集成或替代品。完整选型取舍见仓库文档。
            </p>
            <button
              className="text-btn danger-text"
              onClick={() => {
                if (
                  confirm(
                    "恢复模拟工作区会覆盖当前浏览器数据。请先备份。确认恢复？",
                  )
                ) {
                  const fresh = seedWorkspace();
                  recoveryRaw = null;
                  setWs(fresh);
                  setSelected(fresh.projects[0].id);
                  setNotice("已恢复模拟数据");
                  setSettings(false);
                }
              }}
            >
              恢复模拟工作区
            </button>
          </section>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  icon,
  accent = "green",
  spark,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  accent?: string;
  spark?: string;
}) {
  return (
    <section className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <span className={"metric-icon " + accent}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="metric-bottom">
        <small>{sub}</small>
        {spark && (
          <span className="mini-bars">
            {[9, 14, 11, 19, 23, 28, 34].map((h, i) => (
              <i key={i} style={{ height: h }} />
            ))}
          </span>
        )}
      </div>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <FileText size={27} />
      <p>{text}</p>
    </div>
  );
}
function EvidenceCard({
  title,
  desc,
  tag,
  icon,
}: {
  title: string;
  desc: string;
  tag: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="evidence-card">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{desc}</p>
      <small>
        {tag}
        <ArrowUpRight size={14} />
      </small>
    </div>
  );
}
function EvalSummary({ data }: { data: any }) {
  const before = data.baseline;
  const after = data.finetuned;
  const rows = [
    ["jsonValidRate", "严格 JSON / schema"],
    ["fieldAccuracy", "字段准确率"],
    ["sourceGroundingRate", "来源编号正确率"],
    ["exactMatchRate", "整条记录全对"],
  ];
  return (
    <div className="eval-summary">
      <div>
        <strong>{data.model || "Qwen3 0.6B"}</strong>
        <p>
          {data.training?.steps} 个训练步骤 · {data.dataset?.counts?.train} 训练
          / {data.dataset?.counts?.valid} 验证 / {data.dataset?.counts?.test}{" "}
          独立测试 · 全部合成数据
        </p>
      </div>
      {before && after && (
        <table className="eval-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>基座</th>
              <th>微调后</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, label]) => (
              <tr key={k}>
                <td>{label}</td>
                <td>{(before[k] * 100).toFixed(2)}%</td>
                <td>
                  <strong>{(after[k] * 100).toFixed(2)}%</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        字段评分对两组输出仅剥除单一代码围栏。16
        条合成测试是小规模实验，不能外推客户成效。
      </p>
      <div className="inline-warning">
        保留 {data.failures?.length ?? 0}{" "}
        条微调失败样例，主要涉及缺失值处理。基座含代码围栏，严格格式与语义准确率分别报告。
      </div>
    </div>
  );
}
