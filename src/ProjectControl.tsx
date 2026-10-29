import { useState } from "react";
import {
  ArrowRight,
  Check,
  GitBranch,
  Plus,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Workspace, Task } from "./types";
import type {
  PlanPatch,
  ProjectChange,
  ChangePreview,
} from "./project-control-types";
import {
  compareBaseline,
  createBaseline,
  decideChange,
  previewChange,
  proposeChange,
  shiftDownstream,
  planSignature,
} from "./lib/project-control";
import { validateWorkspace } from "./lib/engine";
import "./project-control.css";

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const day = (value: string) => Date.parse(value + "T00:00:00Z") / 86400000;
const money = (value: number) =>
  new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    maximumFractionDigits: 0,
  }).format(value);
const delta = (value: number) =>
  value === 0 ? "不变" : `${value > 0 ? "+" : ""}${value} 天`;
const fields: Record<string, string> = {
  title: "名称",
  owner: "负责人",
  vendor: "供应商",
  priority: "优先级",
  start: "开始日",
  due: "截止日",
  acceptance: "验收条件",
  dependencies: "依赖",
};
const statusNames = {
  pending: "待审核",
  applied: "已应用",
  rejected: "已拒绝",
};
type Props = {
  workspace: Workspace;
  projectId: string;
  onCommit: (
    next: Workspace,
    action: string,
    id: string,
    detail: string,
  ) => void;
  onOpenDelivery: () => void;
};

function Impact({
  change,
  preview,
  showChecks = true,
}: {
  change: ProjectChange;
  preview: ChangePreview;
  showChecks?: boolean;
}) {
  return (
    <div className="pc-impact">
      <div className="pc-impact-metrics">
        <div>
          <span>修改排期</span>
          <strong>{preview.affectedTaskIds.length} 项任务</strong>
        </div>
        <div>
          <span>项目目标</span>
          <strong>{delta(preview.targetDeltaDays)}</strong>
          <small>
            {preview.project.before.target} → {preview.project.after.target}
          </small>
        </div>
        <div>
          <span>预算变化</span>
          <strong>{money(preview.budgetDelta)}</strong>
          <small>
            {money(preview.project.before.budget)} →{" "}
            {money(preview.project.after.budget)}
          </small>
        </div>
      </div>
      {preview.affectedTaskIds.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>本次请求的排期变化</caption>
            <thead>
              <tr>
                <th>任务</th>
                <th>提交时计划</th>
                <th>提议计划</th>
                <th>截止变化</th>
              </tr>
            </thead>
            <tbody>
              {preview.tasks
                .filter((t) => preview.affectedTaskIds.includes(t.id))
                .map((t) => {
                  const before = change.before.tasks.find(
                    (b) => b.id === t.id,
                  )!;
                  return (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.title}</strong>
                        <small>{t.id}</small>
                      </td>
                      <td>
                        {before.start} → {before.due}
                      </td>
                      <td>
                        {t.start} → {t.due}
                      </td>
                      <td>{delta(day(t.due) - day(before.due))}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      {showChecks &&
        (preview.issues.length > 0 ? (
          <div role="alert" className="pc-issues">
            <strong>应用前需要处理</strong>
            <ul>
              {preview.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="pc-valid">
            <ShieldCheck size={16} /> 日期、FS 依赖及项目目标检查通过。
          </p>
        ))}
    </div>
  );
}

function Decision({
  workspace,
  change,
  onDecision,
}: {
  workspace: Workspace;
  change: ProjectChange;
  onDecision: (
    next: Workspace,
    action: string,
    id: string,
    detail: string,
  ) => void;
}) {
  const [reviewer, setReviewer] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const preview = previewChange(workspace, change);
  const decide = (status: "applied" | "rejected") => {
    try {
      const next = decideChange(workspace, change.id, {
        status,
        reviewer,
        decisionNote: note,
        at: new Date().toISOString(),
      });
      onDecision(
        next,
        status === "applied" ? "审核并应用变更" : "拒绝变更",
        change.id,
        note,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="pc-decision">
      <Impact change={change} preview={preview} />
      <div className="pc-form-grid">
        <label>
          审核记录人
          <input
            aria-label={`${change.id} 审核记录人`}
            maxLength={200}
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
          />
        </label>
        <label>
          决定依据
          <textarea
            aria-label={`${change.id} 决定依据`}
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="记录同意或拒绝的原因，以及确认依据"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="pc-error">
          {error}
        </p>
      )}
      <div className="pc-actions">
        <button
          className="btn secondary"
          disabled={!reviewer.trim() || !note.trim()}
          onClick={() => decide("rejected")}
        >
          <X size={16} />
          记录拒绝
        </button>
        <button
          className="btn primary"
          disabled={!preview.canApply || !reviewer.trim() || !note.trim()}
          onClick={() => decide("applied")}
        >
          <Check size={16} />
          确认并应用变更
        </button>
      </div>
    </div>
  );
}

export default function ProjectControl({
  workspace,
  projectId,
  onCommit,
  onOpenDelivery,
}: Props) {
  const project = workspace.projects.find((p) => p.id === projectId)!;
  const tasks = workspace.tasks.filter((t) => t.projectId === projectId);
  const baselines = (workspace.baselines ?? []).filter(
    (b) => b.projectId === projectId,
  );
  const changes = (workspace.changes ?? []).filter(
    (c) => c.projectId === projectId,
  );
  const [baselineId, setBaselineId] = useState(baselines[0]?.id ?? "");
  const selected = baselines.find((b) => b.id === baselineId) ?? baselines[0];
  const comparison = selected ? compareBaseline(workspace, selected) : null;
  const [onlyChanged, setOnlyChanged] = useState(false),
    [baselineForm, setBaselineForm] = useState(false);
  const [label, setLabel] = useState(""),
    [reviewer, setReviewer] = useState(""),
    [reason, setReason] = useState("");
  const [editor, setEditor] = useState(false),
    [title, setTitle] = useState(""),
    [requestedBy, setRequestedBy] = useState(""),
    [changeReason, setChangeReason] = useState("");
  const [editorBasis, setEditorBasis] = useState("");
  const editorStale =
    editor && editorBasis !== planSignature(workspace, projectId);
  const [target, setTarget] = useState(project.target),
    [budget, setBudget] = useState(String(project.budget));
  const [dates, setDates] = useState<
    Record<string, { start: string; due: string }>
  >({});
  const [draft, setDraft] = useState<ProjectChange | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const commit = (
    next: Workspace,
    action: string,
    id: string,
    detail: string,
  ) => {
    validateWorkspace(next);
    onCommit(next, action, id, detail);
    setError("");
    setNotice(action + "已保存");
  };
  const saveBaseline = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const b = createBaseline(workspace, projectId, {
        id: uid("BASE"),
        label,
        reviewer,
        reason,
        at: new Date().toISOString(),
      });
      commit(
        { ...workspace, baselines: [...(workspace.baselines ?? []), b] },
        "保存计划基线",
        b.id,
        `${b.label}：${b.reason}`.slice(0, 5000),
      );
      setBaselineId(b.id);
      setBaselineForm(false);
      setLabel("");
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openEditor = () => {
    setTitle("");
    setRequestedBy("");
    setChangeReason("");
    setTarget(project.target);
    setBudget(String(project.budget));
    setDates({});
    setDraft(null);
    setEditor(true);
    setEditorBasis(planSignature(workspace, projectId));
    setError("");
    setNotice("");
  };
  const invalidate = () => {
    setDraft(null);
    setError("");
  };
  const patch = (): PlanPatch => {
    if (editorStale)
      throw new Error("打开表单后计划已变化，请重新载入当前计划。");
    if (!budget.trim()) throw new Error("请填写提议预算，0 也需要明确输入。");
    const projectPatch: NonNullable<PlanPatch["project"]> = {};
    if (target !== project.target) projectPatch.target = target;
    if (Number(budget) !== project.budget) projectPatch.budget = Number(budget);
    return {
      ...(Object.keys(projectPatch).length ? { project: projectPatch } : {}),
      tasks: tasks.flatMap((t) => {
        const d = dates[t.id];
        return d && (d.start !== t.start || d.due !== t.due)
          ? [{ taskId: t.id, ...d }]
          : [];
      }),
    };
  };
  const preview = () => {
    try {
      const next = proposeChange(workspace, projectId, {
        id: uid("CHG"),
        title,
        requestedBy,
        reason: changeReason,
        at: new Date().toISOString(),
        patch: patch(),
      });
      setDraft(next);
      setError("");
    } catch (e) {
      setDraft(null);
      setError((e as Error).message);
    }
  };
  const shift = () => {
    try {
      const suggested = shiftDownstream(workspace, projectId, patch());
      const next: typeof dates = {};
      for (const item of suggested.tasks) {
        const old = tasks.find((t) => t.id === item.taskId)!;
        next[item.taskId] = {
          start: item.start ?? old.start,
          due: item.due ?? old.due,
        };
      }
      setDates(next);
      setDraft(null);
      setError("");
      setNotice(
        `已将 ${suggested.tasks.length} 项排期写入提议表。项目目标和预算需单独确认，请重新预览。`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const draftPreview = draft ? previewChange(workspace, draft) : null;
  const submit = () => {
    try {
      if (editorStale)
        throw new Error("打开表单后计划已变化，请重新载入当前计划。");
      if (!draft || !previewChange(workspace, draft).canApply)
        throw new Error("请先重新预览并处理检查项。");
      commit(
        { ...workspace, changes: [...(workspace.changes ?? []), draft] },
        "提出计划变更",
        draft.id,
        draft.reason,
      );
      setEditor(false);
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rows =
    comparison?.tasks.filter((t) => !onlyChanged || t.kind !== "unchanged") ??
    [];
  const allDates =
    comparison?.tasks.flatMap((t) =>
      [t.before, t.after]
        .filter((v): v is Task => !!v)
        .flatMap((t) => [day(t.start), day(t.due)]),
    ) ?? [];
  const min = Math.min(...allDates),
    span = Math.max(1, Math.max(...allDates) - min + 1);
  const bar = (t: Task) => ({
    left: `${((day(t.start) - min) / span) * 100}%`,
    width: `${Math.max(0.6, ((day(t.due) - day(t.start) + 1) / span) * 100)}%`,
  });
  return (
    <div className="project-control">
      <div className="pc-flow" aria-label="计划控制流程">
        <span>01 保存计划基线</span>
        <ArrowRight size={16} />
        <span>02 提出变更</span>
        <ArrowRight size={16} />
        <span>03 预览依赖影响</span>
        <ArrowRight size={16} />
        <span>04 审核并应用</span>
      </div>
      {error && !editor && (
        <div role="alert" className="pc-issues">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="pc-valid">
          {notice}
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PLAN BASELINES</p>
            <h2>当前计划与基线</h2>
            <p className="muted">
              保留每次确认的计划，查看日期、预算和交付要求的变化。
            </p>
          </div>
          <div className="pc-actions">
            <button
              className="btn secondary"
              onClick={() => {
                setBaselineForm(!baselineForm);
                setError("");
              }}
            >
              <Save size={16} />
              {baselineForm ? "收起表单" : "保存计划基线"}
            </button>
            <button className="btn primary" onClick={openEditor}>
              <Plus size={16} />
              提出变更
            </button>
          </div>
        </div>
        {baselineForm && (
          <form className="pc-baseline-form" onSubmit={saveBaseline}>
            <div className="pc-form-grid">
              <label>
                基线名称
                <input
                  required
                  maxLength={200}
                  aria-label="基线名称"
                  placeholder="例如：B1 · 启动会议确认计划"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label>
                确认记录人
                <input
                  required
                  maxLength={200}
                  aria-label="基线确认记录人"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
              </label>
              <label className="pc-wide">
                确认依据与说明
                <textarea
                  required
                  maxLength={5000}
                  aria-label="基线确认依据"
                  placeholder="记录会议决定、文件版本或批准记录引用；测试时注明模拟"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
            <div className="pc-actions">
              <button className="btn primary" type="submit">
                <Save size={16} />
                保存新版本基线
              </button>
            </div>
          </form>
        )}
        {!selected ? (
          <div className="pc-empty">
            <GitBranch size={28} />
            <h3>先保存一份可比较的计划</h3>
            <p>
              AI
              建项或人工排期确认后，保存任务、依赖、验收条件、目标日期和预算。以后修改计划时，原快照会继续保留。
            </p>
            <button className="text-btn" onClick={onOpenDelivery}>
              查看当前工作与排期 <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <>
            <div className="pc-baseline-toolbar">
              <label>
                比较基线
                <select
                  aria-label="比较基线"
                  value={selected.id}
                  onChange={(e) => setBaselineId(e.target.value)}
                >
                  {baselines.map((b, i) => (
                    <option value={b.id} key={b.id}>
                      {i + 1}. {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pc-inline-label">
                <input
                  type="checkbox"
                  checked={onlyChanged}
                  onChange={(e) => setOnlyChanged(e.target.checked)}
                />
                仅显示变化
              </label>
            </div>
            <p className="pc-meta">
              {selected.reviewer} ·{" "}
              {new Date(selected.createdAt).toLocaleString("zh-CN")} ·{" "}
              {selected.reason}
            </p>
            <div className="pc-impact-metrics">
              <div>
                <span>任务变化</span>
                <strong>
                  {comparison!.changed} 修改 · {comparison!.added} 新增 ·{" "}
                  {comparison!.removed} 移除
                </strong>
              </div>
              <div>
                <span>目标日期差异</span>
                <strong>{delta(comparison!.targetDeltaDays)}</strong>
                <small>
                  {selected.snapshot.project.target} → {project.target}
                </small>
              </div>
              <div>
                <span>预算差异</span>
                <strong>{money(comparison!.budgetDelta)}</strong>
                <small>
                  {money(selected.snapshot.project.budget)} →{" "}
                  {money(project.budget)}
                </small>
              </div>
            </div>
            <div className="pc-legend">
              <i className="pc-baseline-key" />
              基线 <i className="pc-current-key" />
              当前计划{" "}
              <span>
                横轴{" "}
                {allDates.length
                  ? new Date(min * 86400000).toISOString().slice(0, 10)
                  : "—"}{" "}
                至{" "}
                {allDates.length
                  ? new Date((min + span - 1) * 86400000)
                      .toISOString()
                      .slice(0, 10)
                  : "—"}
              </span>
            </div>
            <div className="table-wrap">
              <table className="pc-table">
                <caption>基线与当前计划对照</caption>
                <thead>
                  <tr>
                    <th>任务 / 变化</th>
                    <th>基线日期</th>
                    <th>当前计划</th>
                    <th>对照时间线</th>
                    <th>截止差异</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.taskId}>
                      <td>
                        <strong>{r.title}</strong>
                        <small>
                          {r.taskId} ·{" "}
                          {r.kind === "added"
                            ? "新增"
                            : r.kind === "removed"
                              ? "已移除"
                              : r.kind === "unchanged"
                                ? "未变化"
                                : r.changedFields
                                    .map((f) => fields[f] ?? f)
                                    .join("、")}
                        </small>
                      </td>
                      <td>
                        {r.before ? (
                          <>
                            {r.before.start}
                            <br />
                            {r.before.due}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {r.after ? (
                          <>
                            {r.after.start}
                            <br />
                            {r.after.due}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div
                          className="pc-schedule-track"
                          role="img"
                          aria-label={`${r.title}，基线 ${r.before?.start ?? "无"} 至 ${r.before?.due ?? "无"}，当前 ${r.after?.start ?? "无"} 至 ${r.after?.due ?? "无"}`}
                        >
                          {r.before && (
                            <span
                              className="pc-baseline-bar"
                              style={bar(r.before)}
                            />
                          )}
                          {r.after && (
                            <span
                              className="pc-current-bar"
                              style={bar(r.after)}
                            />
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={
                            r.finishDeltaDays && r.finishDeltaDays > 0
                              ? "pc-delay"
                              : ""
                          }
                        >
                          {r.finishDeltaDays === null
                            ? "—"
                            : delta(r.finishDeltaDays)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="pc-empty">没有符合条件的任务。</p>
              )}
            </div>
          </>
        )}
        <p className="caption pc-caption">
          这是当前计划与保存快照的比较，不代表实际进度或挣值。直接编辑也会产生基线差异；通过下方变更流程可另外保留审核决定。
        </p>
      </section>
      {editor && (
        <section className="panel pc-editor">
          {editorStale && (
            <div role="alert" className="pc-issues">
              打开表单后计划已变化。为避免覆盖新的安排，请重新载入当前计划后填写提议。{" "}
              <button className="text-btn" onClick={openEditor}>
                重新载入当前计划
              </button>
            </div>
          )}
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CHANGE PROPOSAL</p>
              <h2>提出排期与预算变更</h2>
            </div>
            <button
              className="icon-btn"
              aria-label="关闭变更表单"
              onClick={() => setEditor(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p className="muted">
            提案不改变执行计划。先预览影响，再提交审核。顺延建议按日历天和完成后开始依赖计算，保持工期，只向后移动；已完成任务不移动。
          </p>
          <div className="pc-form-grid">
            <label>
              变更标题
              <input
                aria-label="变更标题"
                maxLength={200}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label>
              提出人
              <input
                aria-label="变更提出人"
                maxLength={200}
                value={requestedBy}
                onChange={(e) => {
                  setRequestedBy(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label className="pc-wide">
              变更原因与来源
              <textarea
                aria-label="变更原因与来源"
                maxLength={5000}
                value={changeReason}
                onChange={(e) => {
                  setChangeReason(e.target.value);
                  invalidate();
                }}
                placeholder="例如：供应商交期更新、客户变更记录编号及影响"
              />
            </label>
            <label>
              提议项目目标日
              <input
                type="date"
                aria-label="提议项目目标日"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label>
              提议项目预算（HKD）
              <input
                type="number"
                min="0"
                max="1000000000000"
                step="any"
                aria-label="提议项目预算"
                value={budget}
                onChange={(e) => {
                  setBudget(e.target.value);
                  invalidate();
                }}
              />
            </label>
          </div>
          <div className="table-wrap">
            <table className="pc-edit-table">
              <caption>修改需要调整的任务日期，其余保留当前计划</caption>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>原计划</th>
                  <th>提议开始</th>
                  <th>提议截止</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const d = dates[t.id] ?? { start: t.start, due: t.due };
                  return (
                    <tr
                      key={t.id}
                      className={
                        d.start !== t.start || d.due !== t.due
                          ? "pc-row-changed"
                          : ""
                      }
                    >
                      <td>
                        <strong>{t.title}</strong>
                        <small>
                          {t.id}
                          {t.status === "done" ? " · 已完成" : ""}
                        </small>
                      </td>
                      <td>
                        {t.start} → {t.due}
                      </td>
                      <td>
                        <input
                          type="date"
                          aria-label={`${t.id} 提议开始`}
                          disabled={t.status === "done"}
                          value={d.start}
                          onChange={(e) => {
                            setDates({
                              ...dates,
                              [t.id]: { ...d, start: e.target.value },
                            });
                            invalidate();
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          aria-label={`${t.id} 提议截止`}
                          disabled={t.status === "done"}
                          value={d.due}
                          onChange={(e) => {
                            setDates({
                              ...dates,
                              [t.id]: { ...d, due: e.target.value },
                            });
                            invalidate();
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pc-actions">
            <button
              className="btn secondary"
              disabled={editorStale}
              onClick={shift}
            >
              <GitBranch size={16} />
              按依赖补齐顺延建议
            </button>
            <button
              className="btn secondary"
              disabled={editorStale}
              onClick={preview}
            >
              预览变更影响 <ArrowRight size={16} />
            </button>
          </div>
          {error && (
            <div role="alert" className="pc-issues">
              {error}
            </div>
          )}
          {draft && draftPreview && (
            <>
              <Impact change={draft} preview={draftPreview} />
              <div className="pc-actions">
                <button
                  className="btn primary"
                  disabled={editorStale || !draftPreview.canApply}
                  onClick={submit}
                >
                  提交待审核变更
                </button>
              </div>
            </>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CHANGE REGISTER</p>
            <h2>变更登记与决定</h2>
          </div>
          <span className="pill neutral">
            {changes.filter((c) => c.status === "pending").length} 待审核 ·{" "}
            {changes.length} 条记录
          </span>
        </div>
        {changes.length === 0 ? (
          <p className="pc-empty">
            尚无变更请求。提出变更后，可以在这里查看影响并记录决定。
          </p>
        ) : (
          <div className="pc-register">
            {[...changes].reverse().map((c) => (
              <details
                key={c.id}
                open={c.status === "pending"}
                className="pc-change"
              >
                <summary>
                  <div>
                    <span
                      className={
                        "pill " +
                        (c.status === "applied"
                          ? "green"
                          : c.status === "rejected"
                            ? "neutral"
                            : "amber")
                      }
                    >
                      {statusNames[c.status]}
                    </span>
                    <strong>{c.title}</strong>
                    <small>
                      {c.id} · {c.requestedBy} ·{" "}
                      {new Date(c.requestedAt).toLocaleString("zh-CN")}
                    </small>
                  </div>
                </summary>
                <p className="pc-reason">{c.reason}</p>
                {c.status === "pending" ? (
                  <Decision
                    workspace={workspace}
                    change={c}
                    onDecision={commit}
                  />
                ) : (
                  <>
                    <p className="pc-decision-note">
                      <strong>
                        {c.reviewer} · {statusNames[c.status]}
                      </strong>
                      <br />
                      {c.decisionNote}
                      <br />
                      <small>
                        {new Date(c.decidedAt!).toLocaleString("zh-CN")}
                      </small>
                    </p>
                    <Impact
                      showChecks={false}
                      change={c}
                      preview={previewChange(
                        {
                          ...workspace,
                          projects: workspace.projects.map((p) =>
                            p.id === c.projectId
                              ? { ...p, ...c.before.project }
                              : p,
                          ),
                          tasks: [
                            ...workspace.tasks.filter(
                              (t) => t.projectId !== c.projectId,
                            ),
                            ...c.before.tasks,
                          ],
                        },
                        { ...c, status: "pending" },
                      )}
                    />
                  </>
                )}
              </details>
            ))}
          </div>
        )}
        <p className="caption pc-caption">
          确认人和审核人是本地记录字段，不是组织身份认证或电子签章。原始基线不会因应用变更被覆盖；重新确定基线时另存新版本。
        </p>
      </section>
    </div>
  );
}
