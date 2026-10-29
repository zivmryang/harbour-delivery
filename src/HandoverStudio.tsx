import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Upload,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  X,
  Download,
  ShieldCheck,
  Layers3,
  Clock,
  AlertTriangle,
} from "lucide-react";
import type { Workspace } from "./types";
import type {
  Citation,
  HandoverConfiguration,
  HandoverContext,
  HandoverDocument,
  HandoverDocumentKind,
  HandoverKnowledge,
  HandoverReview,
} from "./handover-types";
import { validateHandoverConfiguration } from "./handover-types";
import {
  parseHandoverFiles,
  reviewConfigurationToWorkspace,
} from "./lib/handover-import";
import "./handover.css";

type Knowledge = {
  id: string;
  title: string;
  kind: string;
  url: string;
  version: string;
  checkedAt: string;
  text: string;
  applicability: string;
  sourceStatus: string;
  fetchedAt?: string;
  freshnessNote?: string;
  sourceNote?: string;
  refreshError?: { message: string };
};
type Props = {
  workspace: Workspace;
  api: (path: string, body?: unknown) => Promise<any>;
  onApply: (workspace: Workspace, projectId: string) => void;
  onConfigure: () => void;
};
type HongKongScenario = "unconfirmed" | "enterprise" | "government";
const kinds: Record<HandoverDocumentKind, string> = {
  tender: "招投标资料",
  contract: "合同",
  statement_of_work: "任务书 / SOW",
  handover: "售前移交",
  other: "其他资料",
};
const today = () => new Date().toLocaleDateString("en-CA");
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作未完成，请重试。";
const statusLabel: Record<string, string> = {
  checked_snapshot: "已核查摘要",
  source_fetched: "已获取线上摘录",
  refresh_failed: "刷新失败 · 使用摘要",
};
function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HandoverStudio({
  workspace,
  api,
  onApply,
  onConfigure,
}: Props) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [documents, setDocuments] = useState<HandoverDocument[]>([]);
  const [suppliedKnowledge, setSuppliedKnowledge] = useState<
    HandoverKnowledge[]
  >([]);
  const knowledgeInput = useRef<HTMLInputElement>(null);
  const [catalog, setCatalog] = useState<Knowledge[]>([]);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([
    "dpo-project-management",
  ]);
  const [hongKongScenario, setHongKongScenario] =
    useState<HongKongScenario>("unconfirmed");
  const [catalogNote, setCatalogNote] = useState("");
  const [context, setContext] = useState<HandoverContext>({
    jurisdiction: "香港",
    industry: "ICT / 信息技术服务",
    projectType: "系统集成与应用交付",
    kickoffDate: today(),
  });
  const [provider, setProvider] = useState<"ollama" | "openai">("ollama");
  const [refreshSources, setRefreshSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const [progress, setProgress] = useState({
    phase: "",
    message: "",
    completed: 0,
    total: 0,
  });
  const [result, setResult] = useState<HandoverConfiguration | null>(null);
  const [qualityNotes, setQualityNotes] = useState<string[]>([]);
  const [recorded, setRecorded] = useState(false);
  const [archived, setArchived] = useState(false);
  const [review, setReview] = useState<HandoverReview>({
    confirmed: false,
    reviewer: "",
    kickoff: today(),
  });
  const [resultTab, setResultTab] = useState("tasks");
  const [source, setSource] = useState<{
    title: string;
    text: string;
    quote?: string;
  } | null>(null);
  const [applied, setApplied] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const currentJob = useRef<{ id: string; request: Props["api"] } | null>(null);
  const mounted = useRef(true);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    apiRef
      .current("/api/knowledge")
      .then((d) => {
        if (mounted.current) setCatalog(d.sources);
      })
      .catch(async () => {
        try {
          const r = await fetch(
            import.meta.env.BASE_URL + "knowledge-catalog.json",
          );
          if (r.ok) {
            const data = await r.json();
            if (mounted.current) {
              setCatalog(data.sources);
              setCatalogNote(
                "当前显示随版本发布的知识摘要；生成前可通过 AI 服务刷新官方来源。",
              );
            }
          }
        } catch {
          /* Live service remains explicitly unavailable. */
        }
      });
    return () => {
      mounted.current = false;
      generation.current++;
      if (currentJob.current)
        void currentJob.current
          .request(`/api/handover/jobs/${currentJob.current.id}/cancel`, {})
          .catch(() => {});
    };
  }, []);
  const invalidate = () => {
    setResult(null);
    setRecorded(false);
    setQualityNotes([]);
    setArchived(false);
    setApplied("");
    setError("");
  };
  const applyHongKongScenario = () => {
    if (hongKongScenario === "unconfirmed" || busy || loading) return;
    invalidate();
    const government = hongKongScenario === "government";
    setContext((current) => ({
      ...current,
      jurisdiction: "香港",
      projectType: government
        ? "香港政府外判 IT 项目交付"
        : "香港一般企业 ICT 系统集成与应用交付",
    }));
    setKnowledgeIds(
      government
        ? ["dpo-project-management", "hk-gov-s17", "hk-gov-procurement"]
        : ["dpo-project-management"],
    );
  };
  const showResult = (value: unknown, isRecorded = false) => {
    const r = validateHandoverConfiguration(value);
    setResult(r);
    setRecorded(isRecorded);
    setQualityNotes([]);
    setArchived(false);
    setApplied("");
    setResultTab("tasks");
    setReview({
      confirmed: false,
      reviewer: "",
      kickoff: r.context.kickoffDate || today(),
      projectName: r.project.name || "",
      projectClient: r.project.client || "",
      ...(r.project.target ? { target: r.project.target } : {}),
      ...(r.project.currency === "HKD" && r.project.budget !== null
        ? { budgetHKD: r.project.budget }
        : {}),
      includeRecommendations: false,
      policyReviewConfirmed: false,
    });
    setTimeout(
      () =>
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      100,
    );
  };
  const addFiles = async (files: File[]) => {
    setLoading(true);
    setError("");
    try {
      const parsed = await parseHandoverFiles(files);
      if (documents.length + parsed.length > 12)
        throw new Error("最多 12 份资料。");
      if (
        [...documents, ...parsed].reduce((n, d) => n + d.text.length, 0) >
        100000
      )
        throw new Error("所有资料合计最多 100000 字符。");
      invalidate();
      setDocuments((d) => [...d, ...parsed]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  };
  const addKnowledge = async (files: File[]) => {
    setLoading(true);
    setError("");
    try {
      const parsed = await parseHandoverFiles(files);
      if (suppliedKnowledge.length + parsed.length > 8)
        throw new Error("最多 8 份自备参考资料。");
      if (
        parsed.some((d) => d.text.length > 12000) ||
        [...suppliedKnowledge, ...parsed].reduce(
          (n, d) => n + d.text.length,
          0,
        ) > 40000
      )
        throw new Error(
          "每份参考资料最多 12000 字符，合计 40000 字符；请选取相关章节。",
        );
      invalidate();
      setSuppliedKnowledge((ds) => [
        ...ds,
        ...parsed.map((d) => ({
          id: "USER-K-" + crypto.randomUUID(),
          title: d.name,
          kind: "technical" as const,
          jurisdiction: context.jurisdiction,
          url: null,
          version: null,
          checkedAt: null,
          text: d.text,
        })),
      ]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
      if (knowledgeInput.current) knowledgeInput.current.value = "";
    }
  };
  const loadSamples = async () => {
    setLoading(true);
    setError("");
    try {
      const manifest = await fetch(
        import.meta.env.BASE_URL + "samples/handover/manifest.json",
      ).then((r) => {
        if (!r.ok) throw new Error("模拟资料暂不可用");
        return r.json();
      });
      const docs = await Promise.all(
        manifest.documents.map(
          async (d: {
            id: string;
            name: string;
            kind: HandoverDocumentKind;
            file: string;
          }) => {
            const r = await fetch(
              import.meta.env.BASE_URL + "samples/handover/" + d.file,
            );
            if (!r.ok) throw new Error("模拟资料读取失败");
            return {
              id: d.id,
              name: d.name,
              kind: d.kind,
              text: await r.text(),
            };
          },
        ),
      );
      invalidate();
      setDocuments(docs);
      setSuppliedKnowledge([]);
      setContext(manifest.context);
      setKnowledgeIds(manifest.knowledgeIds);
      setHongKongScenario("unconfirmed");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  const loadRecorded = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        import.meta.env.BASE_URL + "samples/handover/recorded-run.json",
      );
      if (!r.ok)
        throw new Error("实测记录尚未发布；可加载模拟资料并连接本地模型运行。");
      const data = await r.json();
      showResult(data.configuration || data, true);
      setHongKongScenario("unconfirmed");
      setQualityNotes(
        Array.isArray(data.metadata?.qualityReview?.issues)
          ? data.metadata.qualityReview.issues.map(
              (i: { detail: string }) => i.detail,
            )
          : [],
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await apiRef.current("/api/knowledge/refresh", {
        ids: knowledgeIds,
      });
      setCatalog((c) =>
        c.map((k) => d.sources.find((s: Knowledge) => s.id === k.id) || k),
      );
      setCatalogNote(
        "已尝试刷新所选来源。部分网站可能拒绝自动读取，请逐项查看来源状态。",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  const start = async () => {
    const run = ++generation.current;
    const request = apiRef.current;
    let createdJobId = "";
    setError("");
    invalidate();
    setBusy(true);
    setProgress({
      phase: "queued",
      message: "连接模型并准备资料…",
      completed: 0,
      total: 0,
    });
    try {
      const created = await request("/api/handover/jobs", {
        provider,
        projectContext: context,
        documents,
        knowledgeIds,
        refreshSources,
        suppliedKnowledge,
      });
      createdJobId = created.jobId;
      if (generation.current !== run || !mounted.current) {
        void request(`/api/handover/jobs/${created.jobId}/cancel`, {}).catch(
          () => {},
        );
        return;
      }
      currentJob.current = { id: createdJobId, request };
      setJobId(createdJobId);
      for (let i = 0; i < 600; i++) {
        const status = await request(`/api/handover/jobs/${created.jobId}`);
        if (generation.current !== run || !mounted.current) return;
        if (status.progress) setProgress(status.progress);
        if (status.knowledge)
          setCatalog((c) =>
            c.map(
              (k) =>
                status.knowledge.find((s: Knowledge) => s.id === k.id) || k,
            ),
          );
        if (status.status === "completed") {
          showResult(status.result);
          return;
        }
        if (status.status === "failed" || status.status === "cancelled")
          throw new Error(
            status.error?.message || "本次分析已取消，未创建项目。",
          );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("等待分析超时，请查看本地服务状态。");
    } catch (e) {
      if (createdJobId)
        void request(`/api/handover/jobs/${createdJobId}/cancel`, {}).catch(
          () => {},
        );
      if (generation.current === run && mounted.current) setError(errorText(e));
    } finally {
      if (generation.current === run && mounted.current) {
        setBusy(false);
        setJobId("");
        currentJob.current = null;
      }
    }
  };
  const cancel = async () => {
    const handle = currentJob.current;
    if (!handle) return;
    try {
      const status = await handle.request(
        `/api/handover/jobs/${handle.id}/cancel`,
        {},
      );
      if (currentJob.current !== handle) return;
      if (!["completed", "failed", "cancelled"].includes(status.status))
        throw new Error("尚未确认取消，请重试。");
      generation.current++;
      currentJob.current = null;
      setJobId("");
      setBusy(false);
      if (status.status === "completed") {
        setError("");
        showResult(status.result);
      } else
        setError(
          status.status === "cancelled"
            ? "已取消分析，未创建项目。"
            : status.error?.message || "本次分析失败，未创建项目。",
        );
    } catch (e) {
      setError(errorText(e));
    }
  };
  const cite = (c: Citation) => {
    if (!result) return;
    const s = [...result.documents, ...result.knowledge].find(
      (s) => s.id === c.sourceId,
    );
    if (s)
      setSource({
        title: "name" in s ? s.name : s.title,
        text: s.cleanedText,
        quote: c.quote,
      });
  };
  const citations = (refs: Citation[]) => (
    <div className="ho-citations">
      {refs.map((c, i) => (
        <button key={i} onClick={() => cite(c)} title={c.quote}>
          <FileText size={11} />
          {c.sourceId} · 原文
        </button>
      ))}
    </div>
  );
  const setField = <K extends keyof HandoverReview>(
    key: K,
    value: HandoverReview[K],
  ) => setReview((r) => ({ ...r, [key]: value }));
  const setTaskEdit = (
    id: string,
    patch: Partial<{
      acceptance: string;
      dependencies: string[];
      reason: string;
    }>,
  ) => {
    const task = result?.tasks.find((t) => t.id === id);
    if (!task) return;
    setReview((r) => ({
      ...r,
      taskEdits: {
        ...r.taskEdits,
        [id]: {
          acceptance: task.acceptance || "",
          dependencies: [...task.dependencies],
          reason: "",
          ...r.taskEdits?.[id],
          ...patch,
        },
      },
    }));
  };
  const apply = () => {
    if (!result) return;
    setError("");
    try {
      const next = reviewConfigurationToWorkspace(result, review, workspace);
      const project = next.projects.at(-1)!;
      onApply(next, project.id);
      setApplied(project.name);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const archive = workspace.handovers || [];
  return (
    <div className="handover-studio">
      <div className="ho-journey" aria-label="项目初始化流程">
        {[
          ["01", "移交资料", "招标 · 合同 · 任务书"],
          ["02", "知识依据", "政策 · 法规 · 交付实践"],
          ["03", "模型分析", "逐条提取 · 跨文档核对"],
          ["04", "审核建项", "任务 · 依赖 · 风险"],
        ].map(([n, t, d], i) => (
          <div
            key={n}
            className={
              (
                result
                  ? i === 3
                  : busy
                    ? i === 2
                    : documents.length
                      ? i === 1
                      : i === 0
              )
                ? "active"
                : ""
            }
          >
            <span>{n}</span>
            <div>
              <strong>{t}</strong>
              <small>{d}</small>
            </div>
            {i < 3 && <ArrowRight size={16} />}
          </div>
        ))}
      </div>
      {error && !result && (
        <div className="ho-alert" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button
            className="icon-btn"
            aria-label="关闭移交提示"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="ho-intake-grid">
        <section className="ho-card">
          <div className="ho-section-title">
            <div>
              <span className="eyebrow">01 / DOCUMENT INTAKE</span>
              <h2>项目从资料开始</h2>
            </div>
            <span className="pill">{documents.length} / 12 份</span>
          </div>
          <p className="ho-muted">
            保留原文与出处，提取范围、交付物、付款、验收及时间约束。
          </p>
          <button
            className="ho-dropzone"
            disabled={busy || loading}
            onClick={() => input.current?.click()}
          >
            <Upload size={25} />
            <strong>{loading ? "正在读取…" : "选择移交文件"}</strong>
            <span>PDF（文本）· DOCX · TXT · MD · CSV</span>
            <small>单份 10 MB · 单次上传 30 MB · 全部资料 100000 字符</small>
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv"
            hidden
            aria-label="上传移交资料"
            onChange={(e) => void addFiles(Array.from(e.target.files || []))}
          />
          <div className="ho-sample-actions">
            <button
              className="text-btn"
              disabled={busy || loading}
              onClick={loadSamples}
            >
              <Layers3 size={15} />
              加载模拟移交包
            </button>
            <button
              className="text-btn"
              disabled={busy || loading}
              onClick={loadRecorded}
            >
              查看模型实测记录 <ArrowRight size={14} />
            </button>
          </div>
          <div className="ho-docs">
            {documents.map((d) => (
              <details key={d.id}>
                <summary>
                  <FileText size={16} />
                  <strong>{d.name}</strong>
                  <small>{d.text.length.toLocaleString()} 字符</small>
                </summary>
                <div className="ho-doc-body">
                  <div className="ho-row">
                    <select
                      aria-label={d.name + "资料类别"}
                      disabled={busy}
                      value={d.kind}
                      onChange={(e) => {
                        invalidate();
                        setDocuments((ds) =>
                          ds.map((x) =>
                            x.id === d.id
                              ? {
                                  ...x,
                                  kind: e.target.value as HandoverDocumentKind,
                                }
                              : x,
                          ),
                        );
                      }}
                    >
                      {Object.entries(kinds).map(([k, v]) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-btn"
                      disabled={busy}
                      onClick={() => {
                        invalidate();
                        setDocuments((ds) => ds.filter((x) => x.id !== d.id));
                      }}
                    >
                      移除
                    </button>
                  </div>
                  <label>
                    解析文本（可核对、修正）
                    <textarea
                      value={d.text}
                      disabled={busy}
                      onChange={(e) => {
                        invalidate();
                        setDocuments((ds) =>
                          ds.map((x) =>
                            x.id === d.id ? { ...x, text: e.target.value } : x,
                          ),
                        );
                      }}
                      rows={8}
                    />
                  </label>
                </div>
              </details>
            ))}
          </div>
          <p className="ho-footnote">
            文件在浏览器解析；PDF 仅读取文本层，扫描页需先
            OCR，图表及图片内文字不在本次提取范围。选择本地模型时，资料只发往你配置的
            AI
            服务；选择云端模型时，文本会由该服务转交模型提供商。建项后原文随工作区保存在本机浏览器，需自行导出备份。
          </p>
        </section>
        <section className="ho-card">
          <div className="ho-section-title">
            <div>
              <span className="eyebrow">02 / PROJECT CONTEXT</span>
              <h2>让建议有适用条件</h2>
            </div>
            <ShieldCheck size={24} />
          </div>
          <div className="ho-hk-scenario">
            <div className="ho-hk-scenario-controls">
              <label>
                香港交付场景
                <select
                  aria-label="香港交付场景"
                  value={hongKongScenario}
                  disabled={busy || loading}
                  onChange={(e) =>
                    setHongKongScenario(e.target.value as HongKongScenario)
                  }
                >
                  <option value="unconfirmed">待确认</option>
                  <option value="enterprise">一般企业 ICT</option>
                  <option value="government">政府外判 IT</option>
                </select>
              </label>
              <button
                className="btn secondary"
                disabled={busy || loading || hongKongScenario === "unconfirmed"}
                onClick={applyHongKongScenario}
              >
                套用场景参考
              </button>
            </div>
            <p>
              默认的 DPO
              来源仅作一般交付实践参考。点击后将更新地区、项目类型及所选官方参考。一般企业仅选用
              DPO 交付实践作自愿参考；政府外判另选 S17
              及政府采购参考，具体合同和适用性仍需核对。涉及个人资料或关键基础设施时，请按实际情况手动选择对应来源。
            </p>
            <details className="ho-hk-tools">
              <summary>香港项目的工具与交付环境</summary>
              <ul>
                <li>
                  Microsoft Project / Planner、Teams /
                  SharePoint：参考排期、团队协作与文件管理工作流。
                </li>
                <li>
                  Jira /
                  Confluence：参考需求、开发任务、问题跟踪与项目知识管理工作流。
                </li>
                <li>
                  DPO 外判 IT
                  交付：参考项目管理计划、变更控制、交付物验收及移交实践。
                </li>
              </ul>
              <p>以上为工作流参考，尚无外部工具连接或同步功能。</p>
              <a
                href="https://github.com/zivmryang/harbour-delivery/blob/main/docs/TOOL-CHOICES.md"
                target="_blank"
                rel="noreferrer"
              >
                查看工具与交付对标说明 <ExternalLink size={12} />
              </a>
            </details>
          </div>
          <div className="ho-fields">
            <label>
              适用地区
              <input
                value={context.jurisdiction}
                disabled={busy}
                onChange={(e) => {
                  invalidate();
                  setContext((c) => ({ ...c, jurisdiction: e.target.value }));
                }}
              />
            </label>
            <label>
              行业
              <input
                value={context.industry}
                disabled={busy}
                onChange={(e) => {
                  invalidate();
                  setContext((c) => ({ ...c, industry: e.target.value }));
                }}
              />
            </label>
            <label>
              项目类型
              <input
                value={context.projectType}
                disabled={busy}
                onChange={(e) => {
                  invalidate();
                  setContext((c) => ({ ...c, projectType: e.target.value }));
                }}
              />
            </label>
            <label>
              计划启动日
              <input
                type="date"
                value={context.kickoffDate || ""}
                disabled={busy}
                onChange={(e) => {
                  invalidate();
                  setContext((c) => ({
                    ...c,
                    kickoffDate: e.target.value || null,
                  }));
                }}
              />
            </label>
          </div>
          <div className="ho-row ho-knowledge-title">
            <strong>知识依据</strong>
            <button
              className="text-btn"
              onClick={refresh}
              disabled={busy || loading || !knowledgeIds.length}
            >
              <RefreshCw size={13} />
              刷新所选来源
            </button>
          </div>
          <p className="ho-muted">
            当前提供香港官方来源。行业与技术方案会结合上传资料分析；未提供标准全文的要求仍需确认。
          </p>
          <div className="ho-knowledge">
            {catalog.map((k) => (
              <div key={k.id} className="ho-knowledge-item">
                <label className="ho-check">
                  <input
                    type="checkbox"
                    checked={knowledgeIds.includes(k.id)}
                    disabled={busy}
                    onChange={(e) => {
                      invalidate();
                      setKnowledgeIds((ids) =>
                        e.target.checked
                          ? [...ids, k.id]
                          : ids.filter((id) => id !== k.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{k.title}</strong>
                    <small>
                      {k.version} ·{" "}
                      {statusLabel[k.sourceStatus] || k.sourceStatus}
                    </small>
                  </span>
                </label>
                <details>
                  <summary>适用范围与来源</summary>
                  <p>{k.text}</p>
                  <p>{k.applicability}</p>
                  <small>
                    摘要核查：{k.checkedAt} · 线上获取：
                    {k.fetchedAt
                      ? new Date(k.fetchedAt).toLocaleString()
                      : "未获取"}
                  </small>
                  {k.refreshError && (
                    <p className="ho-warning">{k.refreshError.message}</p>
                  )}
                  {k.sourceNote && <p>{k.sourceNote}</p>}
                  <a href={k.url} target="_blank" rel="noreferrer">
                    查看官方来源 <ExternalLink size={12} />
                  </a>
                </details>
              </div>
            ))}
          </div>
          {catalogNote && <p className="ho-footnote">{catalogNote}</p>}
          <div className="ho-row ho-knowledge-title">
            <strong>行业与技术参考</strong>
            <button
              className="text-btn"
              disabled={busy || loading}
              onClick={() => knowledgeInput.current?.click()}
            >
              <Upload size={13} />
              添加参考资料
            </button>
          </div>
          <input
            hidden
            ref={knowledgeInput}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv"
            aria-label="上传行业与技术参考"
            onChange={(e) =>
              void addKnowledge(Array.from(e.target.files || []))
            }
          />
          <p className="ho-footnote">
            可加入厂商手册、行业标准、技术规范或内部交付方法。每份 12000
            字符；须确认版本、使用权与适用地区。参考资料不自动变成合同义务。
          </p>
          <div className="ho-docs">
            {suppliedKnowledge.map((k) => (
              <details key={k.id}>
                <summary>
                  <FileText size={14} />
                  <strong>{k.title}</strong>
                  <small>{k.text.length} 字符</small>
                </summary>
                <div className="ho-doc-body">
                  <div className="ho-fields">
                    <label>
                      参考类别
                      <select
                        disabled={busy}
                        value={k.kind}
                        onChange={(e) => {
                          invalidate();
                          setSuppliedKnowledge((ds) =>
                            ds.map((x) =>
                              x.id === k.id
                                ? {
                                    ...x,
                                    kind: e.target
                                      .value as HandoverKnowledge["kind"],
                                  }
                                : x,
                            ),
                          );
                        }}
                      >
                        {Object.entries({
                          technical: "技术资料",
                          industry: "行业资料",
                          standard: "标准",
                          best_practice: "交付实践",
                          policy: "政策",
                          regulation: "法规",
                        }).map(([v, t]) => (
                          <option value={v} key={v}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      版本
                      <input
                        placeholder="待核实"
                        disabled={busy}
                        value={k.version || ""}
                        onChange={(e) => {
                          invalidate();
                          setSuppliedKnowledge((ds) =>
                            ds.map((x) =>
                              x.id === k.id
                                ? { ...x, version: e.target.value || null }
                                : x,
                            ),
                          );
                        }}
                      />
                    </label>
                    <label>
                      适用地区
                      <input
                        disabled={busy}
                        value={k.jurisdiction}
                        onChange={(e) => {
                          invalidate();
                          setSuppliedKnowledge((ds) =>
                            ds.map((x) =>
                              x.id === k.id
                                ? { ...x, jurisdiction: e.target.value }
                                : x,
                            ),
                          );
                        }}
                      />
                    </label>
                    <label>
                      人工核查日期（可留空）
                      <input
                        type="date"
                        disabled={busy}
                        value={k.checkedAt || ""}
                        onChange={(e) => {
                          invalidate();
                          setSuppliedKnowledge((ds) =>
                            ds.map((x) =>
                              x.id === k.id
                                ? { ...x, checkedAt: e.target.value || null }
                                : x,
                            ),
                          );
                        }}
                      />
                    </label>
                  </div>
                  <label>
                    参考文本
                    <textarea
                      rows={5}
                      disabled={busy}
                      value={k.text}
                      onChange={(e) => {
                        invalidate();
                        setSuppliedKnowledge((ds) =>
                          ds.map((x) =>
                            x.id === k.id ? { ...x, text: e.target.value } : x,
                          ),
                        );
                      }}
                    />
                  </label>
                  <button
                    className="text-btn"
                    disabled={busy}
                    onClick={() => {
                      invalidate();
                      setSuppliedKnowledge((ds) =>
                        ds.filter((x) => x.id !== k.id),
                      );
                    }}
                  >
                    移除此参考
                  </button>
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
      <section className="ho-runbar">
        <div>
          <span className="eyebrow">03 / MODEL REASONING</span>
          <h3>从多份文件，生成同一份项目初稿</h3>
          <p>
            清洗与分段 → 引用校验 → 冲突分析 → 项目配置。不会直接覆盖已有项目。
          </p>
        </div>
        <div className="ho-run-actions">
          <select
            aria-label="移交分析模型"
            disabled={busy}
            value={provider}
            onChange={(e) => setProvider(e.target.value as "ollama" | "openai")}
          >
            <option value="ollama">
              本地 Ollama · 建项模型（默认 Qwen3 8B）
            </option>
            <option value="openai">云端 OpenAI · 服务端配置</option>
          </select>
          {provider === "openai" && (
            <p className="ho-warning">
              本次文档及自备参考文本将经配置的服务发送给
              OpenAI。请确认这些资料可以发送到该提供商。
            </p>
          )}
          <label className="ho-check">
            <input
              type="checkbox"
              checked={refreshSources}
              disabled={busy}
              onChange={(e) => setRefreshSources(e.target.checked)}
            />
            分析前刷新官方来源
          </label>
          <div className="ho-row">
            <button className="text-btn" onClick={onConfigure}>
              连接设置
            </button>
            <button
              className="btn primary"
              disabled={busy || loading || !documents.length}
              onClick={start}
            >
              <Sparkles size={16} />
              {busy ? "模型分析中…" : "分析并配置项目"}
            </button>
          </div>
        </div>
      </section>
      {busy && (
        <section className="ho-progress" role="status">
          <div className="ho-row">
            <Clock size={18} />
            <strong>{progress.message}</strong>
            <button className="text-btn" disabled={!jobId} onClick={cancel}>
              取消本次分析
            </button>
          </div>
          <progress
            max={Math.max(1, progress.total)}
            value={progress.completed}
          />
          <small>
            本地模型需要数分钟；逐份抽取后进行跨文档综合。结果通过结构与引用检查后才会显示。
          </small>
        </section>
      )}
      {result && (
        <div ref={resultRef} className="ho-result">
          <div className="ho-result-heading">
            <div>
              <span className="eyebrow">04 / REVIEW BEFORE APPLY</span>
              <h2>{result.project.name || "项目配置草稿"}</h2>
              <p>
                {archived
                  ? "已审核归档 · 保留原提案与审核调整"
                  : recorded
                    ? "已保存的真实模型运行记录 · 输入全部为模拟资料"
                    : "本次模型生成 · 尚未确认"}{" "}
                · {result.run.model} ·{" "}
                {result.run.notices?.some((n) => /resum|恢复/i.test(n))
                  ? `恢复综合 ${(result.run.durationMs / 1000).toFixed(1)} 秒 · 另含 ${result.run.stages.filter((s) => s.phase === "extract").length} 次历史抽取`
                  : `${(result.run.durationMs / 1000).toFixed(1)} 秒 · ${result.run.calls} 次调用`}
              </p>
              {result.run.notices?.some((n) => /resum|恢复/i.test(n)) && (
                <p className="ho-warning">
                  此记录包含恢复运行；详细过程见“知识与溯源”。
                </p>
              )}
            </div>
            <button
              className="btn secondary"
              onClick={() => downloadJson("handover-proposal.json", result)}
            >
              <Download size={15} />
              导出配置与原文
            </button>
          </div>
          {qualityNotes.length > 0 && (
            <details className="ho-alert ho-quality">
              <summary>
                实测已知审阅项：验收细节、引用范围与依赖需要核对
              </summary>
              <p>
                这份原始模型输出保留了已发现的问题。请核对完整原文，在下方修订并填写依据后再建立演示项目。
              </p>
              <ul>
                {qualityNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="ho-card ho-project-facts">
            <p>{result.project.description || "项目描述待确认"}</p>
            <div className="ho-row">
              <span>
                原文预算：
                {result.project.budget === null
                  ? "待确认 / 有冲突"
                  : result.project.budget.toLocaleString()}{" "}
                {result.project.currency || "币种待确认"}
              </span>
              <span>
                原文目标：{result.project.target || "待确认 / 有冲突"}
              </span>
            </div>
            {citations(result.project.sourceRefs)}
          </div>
          <div className="ho-summary">
            <div>
              <strong>{result.requirements.length}</strong>
              <span>提取条目</span>
            </div>
            <div>
              <strong>{result.tasks.length}</strong>
              <span>计划任务</span>
            </div>
            <div>
              <strong>{result.conflicts.length}</strong>
              <span>待解决冲突</span>
            </div>
            <div>
              <strong>{result.openQuestions.length}</strong>
              <span>待确认问题</span>
            </div>
          </div>
          <div className="ho-tabs" role="tablist">
            {[
              ["tasks", "工作分解"],
              ["requirements", "原文要求"],
              ["milestones", "里程碑"],
              ["risks", "风险"],
              ["conflicts", "冲突与缺口"],
              ["sources", "知识与溯源"],
            ].map(([k, v]) => (
              <button
                role="tab"
                aria-selected={resultTab === k}
                key={k}
                className={resultTab === k ? "active" : ""}
                onClick={() => setResultTab(k)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="ho-result-body">
            {resultTab === "tasks" && (
              <>
                <p className="ho-muted">
                  合同要求与模型实施建议分别标记。这里的角色不等于已落实的责任人；工期和人员可在下方审核表中确认。
                </p>
                {result.tasks.map((t) => (
                  <article className="ho-item" key={t.id}>
                    <div className="ho-row">
                      <span
                        className={
                          "pill " +
                          (t.origin === "contract" ? "green" : "amber")
                        }
                      >
                        {t.origin === "contract" ? "资料要求" : "实施建议"}
                      </span>
                      <small>
                        {t.id} ·{" "}
                        {t.durationDays === null
                          ? "工期待估算"
                          : t.durationDays + " 日历天"}
                      </small>
                    </div>
                    <h3>{t.title}</h3>
                    <p>
                      建议角色：{t.ownerRole || "待确认"} · 建议依赖：
                      {t.dependencies.join("、") || "无"}
                    </p>
                    <p>验收条件：{t.acceptance || "待补充"}</p>
                    {t.rationale && <p className="ho-muted">{t.rationale}</p>}
                    {citations(t.sourceRefs)}
                  </article>
                ))}
              </>
            )}
            {resultTab === "requirements" &&
              result.requirements.map((r) => (
                <article className="ho-item" key={r.id}>
                  <small>
                    {r.id} · {r.category}
                  </small>
                  <p>{r.text}</p>
                  {citations(r.citations)}
                </article>
              ))}
            {resultTab === "milestones" && (
              <>
                {!result.milestones.length && (
                  <p>资料未生成明确里程碑，需人工补充。</p>
                )}
                {result.milestones.map((m) => (
                  <article className="ho-item" key={m.id}>
                    <h3>
                      {m.date || "日期待确认"} · {m.title}
                    </h3>
                    <p>关联任务：{m.taskIds.join("、") || "待关联"}</p>
                    {citations(m.sourceRefs)}
                  </article>
                ))}
              </>
            )}
            {resultTab === "risks" && (
              <>
                {!result.risks.length && (
                  <p>本次未提取风险；这不表示项目没有风险。</p>
                )}
                {result.risks.map((r) => (
                  <article className="ho-item" key={r.id}>
                    <h3>{r.title}</h3>
                    <p>{r.mitigation}</p>
                    {citations(r.sourceRefs)}
                  </article>
                ))}
              </>
            )}
            {resultTab === "conflicts" && (
              <>
                {!result.conflicts.length && (
                  <p>本次未识别文档冲突，仍需核对原文。</p>
                )}
                {result.conflicts.map((c) => (
                  <article className="ho-item ho-conflict" key={c.id}>
                    <h3>{c.topic}</h3>
                    <p>{c.detail}</p>
                    {citations(c.sourceRefs)}
                  </article>
                ))}
                {result.openQuestions.map((q) => (
                  <article className="ho-item" key={q.id}>
                    <small>待确认 · {q.id}</small>
                    <p>{q.question}</p>
                    {citations(q.sourceRefs)}
                  </article>
                ))}
              </>
            )}
            {resultTab === "sources" && (
              <>
                <p className="ho-muted">
                  来源摘要、原文分段和 SHA-256
                  与模型运行信息一起归档。引用存在不等于推论一定正确，适用性需结合项目事实确认。
                </p>
                {result.applicability.map((a) => (
                  <article className="ho-item" key={a.sourceId}>
                    <h3>
                      {result.knowledge.find((k) => k.id === a.sourceId)?.title}
                    </h3>
                    <span className="pill">
                      {
                        {
                          applicable: "模型判断适用",
                          potential: "可能适用",
                          not_applicable: "模型判断不适用",
                          unknown: "待确认",
                        }[a.status]
                      }
                    </span>
                    <p>{a.reason}</p>
                  </article>
                ))}
                {[...result.documents, ...result.knowledge].map((s) => (
                  <article className="ho-item" key={s.id}>
                    <div className="ho-row">
                      <strong>{"name" in s ? s.name : s.title}</strong>
                      <button
                        className="text-btn"
                        onClick={() =>
                          setSource({
                            title: "name" in s ? s.name : s.title,
                            text: s.cleanedText,
                          })
                        }
                      >
                        查看清洗文本
                      </button>
                    </div>
                    <small>
                      {"name" in s
                        ? "项目资料"
                        : s.id.startsWith("USER-K-")
                          ? "用户提供 · 未独立核查"
                          : "官方来源摘要 / 摘录（状态见原文）"}{" "}
                      · {s.originalChars} → {s.cleanedChars} 字符 ·{" "}
                      {s.chunks.length} 段 · SHA-256 {s.sha256.slice(0, 16)}…
                    </small>
                  </article>
                ))}
                {result.run.notices?.map((n, i) => (
                  <p key={i} className="ho-warning">
                    {n}
                  </p>
                ))}
              </>
            )}
          </div>
          <section className="ho-review">
            <div className="ho-section-title">
              <div>
                <span className="eyebrow">HUMAN REVIEW</span>
                <h2>确认后，建立可执行的项目</h2>
              </div>
              <CheckCircle2 size={24} />
            </div>
            <p className="ho-muted">
              审核只新增项目。所有任务从待开始状态进入工作区；验收证据需要在实际执行中形成。排期按日历天、依赖完成后次日开始计算。
            </p>
            <div className="ho-fields">
              <label>
                项目名称
                <input
                  value={review.projectName || ""}
                  onChange={(e) => setField("projectName", e.target.value)}
                />
              </label>
              <label>
                客户
                <input
                  value={review.projectClient || ""}
                  onChange={(e) => setField("projectClient", e.target.value)}
                />
              </label>
              <label>
                启动日期
                <input
                  type="date"
                  value={review.kickoff}
                  onChange={(e) => setField("kickoff", e.target.value)}
                />
              </label>
              <label>
                目标日期
                <input
                  type="date"
                  value={review.target || ""}
                  onChange={(e) => setField("target", e.target.value)}
                />
              </label>
              <label>
                审核人
                <input
                  placeholder="填写审核人"
                  value={review.reviewer}
                  onChange={(e) => setField("reviewer", e.target.value)}
                />
              </label>
              <label>
                确认预算（HKD）
                <input
                  type="number"
                  min="0"
                  value={review.budgetHKD ?? ""}
                  onChange={(e) =>
                    setField(
                      "budgetHKD",
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
              </label>
            </div>
            {result.project.target !== review.target && (
              <label>
                调整目标日期的依据
                <textarea
                  value={review.targetOverrideReason || ""}
                  onChange={(e) =>
                    setField("targetOverrideReason", e.target.value)
                  }
                />
              </label>
            )}
            {(result.project.currency !== "HKD" ||
              result.project.budget !== review.budgetHKD) && (
              <label>
                预算依据及原币种（不自动换汇）
                <textarea
                  value={review.budgetConversionNote || ""}
                  onChange={(e) =>
                    setField("budgetConversionNote", e.target.value)
                  }
                />
              </label>
            )}
            <label className="ho-check">
              <input
                type="checkbox"
                checked={!!review.includeRecommendations}
                onChange={(e) =>
                  setField("includeRecommendations", e.target.checked)
                }
              />
              将模型实施建议纳入计划（保留建议标记）
            </label>
            <label>
              缺失工期的统一人工估算（日历天，可留空逐项填写）
              <input
                type="number"
                min="1"
                max="3650"
                placeholder="明确填写才会应用于未知工期"
                value={review.defaultDurationDays ?? ""}
                onChange={(e) =>
                  setField(
                    "defaultDurationDays",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
              />
            </label>
            <details className="ho-review-details" open>
              <summary>逐项核对任务、验收与排期</summary>
              <p className="ho-muted">
                未给出工期的任务必须补充；未分配的实际责任人保持空白。展开每项核对验收细节和建议依赖，修订及其依据会单独留档。
              </p>
              <div className="ho-task-review">
                {result.tasks
                  .filter(
                    (t) =>
                      t.origin === "contract" || review.includeRecommendations,
                  )
                  .map((t) => (
                    <div key={t.id}>
                      <span>
                        {t.id} · {t.title}
                      </span>
                      <label>
                        日历天
                        <input
                          aria-label={t.id + "工期"}
                          type="number"
                          min="1"
                          max="3650"
                          placeholder="待估算"
                          value={
                            review.taskDurations?.[t.id] ??
                            t.durationDays ??
                            review.defaultDurationDays ??
                            ""
                          }
                          onChange={(e) => {
                            const next = { ...review.taskDurations };
                            if (e.target.value === "") delete next[t.id];
                            else next[t.id] = Number(e.target.value);
                            setField("taskDurations", next);
                          }}
                        />
                      </label>
                      <label>
                        责任人
                        <input
                          aria-label={t.id + "责任人"}
                          placeholder={t.ownerRole || "待分配"}
                          value={review.taskOwners?.[t.id] || ""}
                          onChange={(e) =>
                            setField("taskOwners", {
                              ...review.taskOwners,
                              [t.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                      <details className="ho-task-correction">
                        <summary>核对 / 修订验收与依赖</summary>
                        {citations(t.sourceRefs)}
                        <label>
                          验收条件
                          <textarea
                            aria-label={t.id + "验收条件"}
                            rows={3}
                            value={
                              review.taskEdits?.[t.id]?.acceptance ??
                              t.acceptance ??
                              ""
                            }
                            onChange={(e) =>
                              setTaskEdit(t.id, { acceptance: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          建议前置任务（可多选，需人工确认）
                          <select
                            multiple
                            aria-label={t.id + "前置任务"}
                            value={
                              review.taskEdits?.[t.id]?.dependencies ??
                              t.dependencies
                            }
                            onChange={(e) =>
                              setTaskEdit(t.id, {
                                dependencies: Array.from(
                                  e.target.selectedOptions,
                                ).map((o) => o.value),
                              })
                            }
                          >
                            {result.tasks
                              .filter((x) => x.id !== t.id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.id} · {x.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          核对 / 修订依据
                          <textarea
                            aria-label={t.id + "修订依据"}
                            placeholder="填写原文条款或明确标注的人工计划假设；原模型提案不会被覆盖。"
                            value={review.taskEdits?.[t.id]?.reason || ""}
                            onChange={(e) =>
                              setTaskEdit(t.id, { reason: e.target.value })
                            }
                          />
                        </label>
                        {review.taskEdits?.[t.id] && (
                          <button
                            className="text-btn"
                            onClick={() => {
                              const edits = { ...review.taskEdits };
                              delete edits[t.id];
                              setField("taskEdits", edits);
                            }}
                          >
                            撤销此项修订
                          </button>
                        )}
                      </details>
                    </div>
                  ))}
              </div>
            </details>
            {result.milestones.length > 0 && (
              <details className="ho-review-details">
                <summary>合同里程碑与排期调整</summary>
                {result.milestones.map((m) => (
                  <div key={m.id} className="ho-item">
                    <strong>
                      {m.title} · 原日期 {m.date || "未明确"}
                    </strong>
                    <p className="ho-muted">仅当需要调整时填写，并记录依据。</p>
                    <div className="ho-fields">
                      <label>
                        调整为
                        <input
                          type="date"
                          value={review.milestoneOverrides?.[m.id]?.date || ""}
                          onChange={(e) => {
                            const next = { ...review.milestoneOverrides };
                            if (!e.target.value) delete next[m.id];
                            else
                              next[m.id] = {
                                date: e.target.value,
                                reason: next[m.id]?.reason || "",
                              };
                            setField("milestoneOverrides", next);
                          }}
                        />
                      </label>
                      <label>
                        调整依据
                        <input
                          value={
                            review.milestoneOverrides?.[m.id]?.reason || ""
                          }
                          disabled={!review.milestoneOverrides?.[m.id]}
                          onChange={(e) =>
                            setField("milestoneOverrides", {
                              ...review.milestoneOverrides,
                              [m.id]: {
                                date: review.milestoneOverrides![m.id].date,
                                reason: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </details>
            )}
            {result.risks.length > 0 && (
              <details className="ho-review-details" open>
                <summary>风险初始评分（需人工确认）</summary>
                {result.risks.map((r) => (
                  <div className="ho-risk-review" key={r.id}>
                    <span>{r.title}</span>
                    {(["impact", "likelihood"] as const).map((k) => (
                      <label key={k}>
                        {k === "impact" ? "影响" : "概率"}
                        <select
                          aria-label={r.id + (k === "impact" ? "影响" : "概率")}
                          value={review.riskRatings?.[r.id]?.[k] || ""}
                          onChange={(e) =>
                            setField("riskRatings", {
                              ...review.riskRatings,
                              [r.id]: {
                                ...review.riskRatings?.[r.id],
                                [k]: Number(e.target.value),
                              } as { impact: 1 | 2 | 3; likelihood: 1 | 2 | 3 },
                            })
                          }
                        >
                          <option value="">待评估</option>
                          <option value="1">1 · 低</option>
                          <option value="2">2 · 中</option>
                          <option value="3">3 · 高</option>
                        </select>
                      </label>
                    ))}
                  </div>
                ))}
              </details>
            )}
            {result.conflicts.map((c) => (
              <label className="ho-conflict-label" key={c.id}>
                冲突处理：{c.topic}
                <textarea
                  aria-label={c.id + "冲突处理"}
                  placeholder="记录已确认的解决结果及采用依据；未解决的冲突不得建项。系统不自动决定文件优先级。"
                  value={review.conflictResolutions?.[c.id] || ""}
                  onChange={(e) =>
                    setField("conflictResolutions", {
                      ...review.conflictResolutions,
                      [c.id]: e.target.value,
                    })
                  }
                />
              </label>
            ))}
            {result.openQuestions.length > 0 && (
              <details className="ho-review-details">
                <summary>补充待确认问题（可保留未答项）</summary>
                {result.openQuestions.map((q) => (
                  <label key={q.id}>
                    {q.question}
                    <textarea
                      value={review.questionResponses?.[q.id] || ""}
                      onChange={(e) => {
                        const next = { ...review.questionResponses };
                        if (e.target.value) next[q.id] = e.target.value;
                        else delete next[q.id];
                        setField("questionResponses", next);
                      }}
                    />
                  </label>
                ))}
              </details>
            )}
            {result.knowledge.length > 0 && (
              <label className="ho-check">
                <input
                  type="checkbox"
                  checked={!!review.policyReviewConfirmed}
                  onChange={(e) =>
                    setField("policyReviewConfirmed", e.target.checked)
                  }
                />
                我已核对知识来源、版本和适用性，确认纳入计划的要求。
              </label>
            )}
            <label className="ho-check">
              <input
                type="checkbox"
                checked={review.confirmed}
                onChange={(e) => setField("confirmed", e.target.checked)}
              />
              我已核对原文、冲突处理和排期，确认将此草稿建立为新项目。
            </label>
            {error && (
              <div className="ho-alert" role="alert">
                <AlertTriangle size={18} />
                <span>{error}</span>
              </div>
            )}
            <div className="ho-apply">
              <span>
                {applied
                  ? "已建立：" + applied
                  : "原文、引用、模型运行及审核记录将一并归档。"}
              </span>
              <button
                className="btn primary"
                disabled={
                  !review.confirmed || !review.reviewer.trim() || !!applied
                }
                onClick={apply}
              >
                <CheckCircle2 size={16} />
                确认并建立项目
              </button>
            </div>
          </section>
        </div>
      )}
      {archive.length > 0 && (
        <section className="ho-card ho-archive">
          <h2>已审核的资料归档</h2>
          {archive.map((a) => (
            <div className="ho-row" key={a.id}>
              <span>
                {workspace.projects.find((p) => p.id === a.projectId)?.name} ·{" "}
                {a.reviewer} · {new Date(a.createdAt).toLocaleDateString()}
              </span>
              <button
                className="text-btn"
                disabled={busy}
                onClick={() => {
                  showResult(a.configuration);
                  setHongKongScenario("unconfirmed");
                  setArchived(true);
                  setReview(a.review);
                  setApplied(
                    workspace.projects.find((p) => p.id === a.projectId)
                      ?.name || "已建立项目",
                  );
                }}
              >
                查看原文与审核
              </button>
              <button
                className="text-btn"
                onClick={() => downloadJson(a.id + ".json", a)}
              >
                导出原文与审核记录 <Download size={14} />
              </button>
            </div>
          ))}
        </section>
      )}
      {source && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSource(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="原文与引用"
            className="modal ho-source-modal"
          >
            <header>
              <h2>{source.title}</h2>
              <button
                className="icon-btn"
                aria-label="关闭原文"
                onClick={() => setSource(null)}
              >
                <X size={20} />
              </button>
            </header>
            {source.quote && <blockquote>{source.quote}</blockquote>}
            <pre>{source.text}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
