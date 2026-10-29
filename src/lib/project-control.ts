import type { Task, Workspace } from '../types';
import type { BaselineComparison, ChangePreview, ControlIssue, ControlWorkspace, PlanPatch, PlanSnapshot, ProjectBaseline, ProjectChange, TaskVariance } from '../project-control-types';

const DAY = 86_400_000;
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const day = (v: string) => Date.parse(v + 'T00:00:00Z') / DAY;
const dateAt = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const clone = <T,>(v: T): T => structuredClone(v);
const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const text = (v: unknown, p: string, max = 2000, empty = false): string => typeof v === 'string' && v.length <= max && (empty || !!v.trim()) ? v : fail(p, '文本为空或超出长度限制');
const id = (v: unknown, p: string): string => { const s = text(v, p, 80); return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s) ? s : fail(p, '编号无效'); };
const date = (v: unknown, p: string): string => validDate(v) ? v : fail(p, '日期应为有效 YYYY-MM-DD');
const instant = (v: unknown, p: string): string => { const s = text(v, p, 40); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s.slice(0, 10) ? s : fail(p, '时间戳应为有效 UTC 时间'); };
const number = (v: unknown, p: string): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12 ? v : fail(p, '数值应为 0 至 1e12');
const bool = (v: unknown, p: string): boolean => typeof v === 'boolean' ? v : fail(p, '应为布尔值');
const choice = <T extends string>(v: unknown, p: string, options: T[]): T => options.includes(v as T) ? v as T : fail(p, '选项无效');
function obj(v: unknown, p: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(p, '应为对象');
  const r = v as Record<string, unknown>;
  for (const k of required) if (!Object.hasOwn(r, k)) fail(`${p}.${k}`, '缺少字段');
  for (const k of Object.keys(r)) if (!required.includes(k) && !optional.includes(k)) fail(`${p}.${k}`, '未知字段');
  return r;
}
const arr = (v: unknown, p: string, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail(p, `应为不超过 ${max} 项的数组`);

function taskOrder(tasks: Task[]): string[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  if (byId.size !== tasks.length) fail('计划', '任务编号重复');
  const visited = new Set<string>(), active = new Set<string>(), order: string[] = [];
  const visit = (key: string) => {
    if (active.has(key)) fail('计划', '任务存在循环依赖');
    if (visited.has(key)) return;
    const t = byId.get(key); if (!t) fail('计划', `依赖 ${key} 不存在`);
    active.add(key);
    for (const depId of t!.dependencies) {
      const dep = byId.get(depId);
      if (!dep || dep.projectId !== t!.projectId) fail('计划', `依赖 ${depId} 不存在或跨项目`);
      visit(depId);
    }
    active.delete(key); visited.add(key); order.push(key);
  };
  for (const t of tasks) visit(t.id);
  return order;
}

function snapshot(w: Workspace, projectId: string): PlanSnapshot {
  const p = w.projects.find(p => p.id === projectId);
  if (!p) return fail('项目', '项目不存在');
  return { project: { id: p.id, name: p.name, target: p.target, budget: p.budget }, tasks: clone(w.tasks.filter(t => t.projectId === projectId)) };
}

// Execution progress can change while a schedule request is being reviewed.
// Compare the complete planning content, not a short hash or completion state.
function canonicalPlan(s: PlanSnapshot): string {
  return JSON.stringify({ project: s.project, tasks: [...s.tasks].sort((a, b) => a.id.localeCompare(b.id)).map(t => ({ id: t.id, projectId: t.projectId, title: t.title, owner: t.owner, vendor: t.vendor, priority: t.priority, start: t.start, due: t.due, dependencies: [...t.dependencies].sort(), acceptance: t.acceptance })) });
}

/** Full canonical planning content for stale-form detection; never an integrity proof. */
export function planSignature(w: Workspace, projectId: string): string {
  return canonicalPlan(snapshot(w, projectId));
}

function parseSnapshot(value: unknown, projectId: string, w: Workspace, p: string): PlanSnapshot {
  const r = obj(value, p, ['project', 'tasks']), pr = obj(r.project, p + '.project', ['id', 'name', 'target', 'budget']);
  if (id(pr.id, p + '.project.id') !== projectId) fail(p, '快照项目不一致');
  if (!w.projects.some(project => project.id === projectId)) fail(p, '项目不存在');
  const tasks: Task[] = arr(r.tasks, p + '.tasks', 2000).map((item, i) => {
    const path = `${p}.tasks[${i}]`, t = obj(item, path, ['id', 'projectId', 'title', 'owner', 'vendor', 'status', 'priority', 'start', 'due', 'dependencies', 'acceptance', 'accepted', 'evidence']);
    const parsed: Task = { id: id(t.id, path + '.id'), projectId: id(t.projectId, path + '.projectId'), title: text(t.title, path + '.title', 500), owner: text(t.owner, path + '.owner', 200, true), vendor: text(t.vendor, path + '.vendor', 200, true), status: choice(t.status, path + '.status', ['todo', 'active', 'blocked', 'review', 'done']), priority: choice(t.priority, path + '.priority', ['low', 'medium', 'high']), start: date(t.start, path + '.start'), due: date(t.due, path + '.due'), dependencies: arr(t.dependencies, path + '.dependencies', 100).map((d, j) => id(d, `${path}.dependencies[${j}]`)), acceptance: text(t.acceptance, path + '.acceptance', 5000, true), accepted: bool(t.accepted, path + '.accepted'), evidence: text(t.evidence, path + '.evidence', 10000, true) };
    if (parsed.projectId !== projectId) fail(path, '任务不属于本项目');
    if (parsed.due < parsed.start) fail(path, '截止日期早于开始日期');
    if (new Set(parsed.dependencies).size !== parsed.dependencies.length) fail(path, '依赖重复');
    const current = w.tasks.find(task => task.id === parsed.id);
    if (current && current.projectId !== projectId) fail(path, '历史任务编号已属于其他项目');
    return parsed;
  });
  taskOrder(tasks);
  return { project: { id: projectId, name: text(pr.name, p + '.project.name', 200), target: date(pr.target, p + '.project.target'), budget: number(pr.budget, p + '.project.budget') }, tasks };
}

function parsePatch(value: unknown, before: PlanSnapshot, p: string): PlanPatch {
  const r = obj(value, p, ['tasks'], ['project']), result: PlanPatch = { tasks: [] };
  if (r.project !== undefined) {
    const project = obj(r.project, p + '.project', [], ['target', 'budget']);
    if (!Object.keys(project).length) fail(p + '.project', '至少修改一个项目字段');
    result.project = {};
    if (Object.hasOwn(project, 'target')) result.project.target = date(project.target, p + '.project.target');
    if (Object.hasOwn(project, 'budget')) result.project.budget = number(project.budget, p + '.project.budget');
  }
  const taskIds = new Set<string>();
  result.tasks = arr(r.tasks, p + '.tasks', 2000).map((item, i) => {
    const path = `${p}.tasks[${i}]`, t = obj(item, path, ['taskId'], ['start', 'due']), taskId = id(t.taskId, path + '.taskId');
    if (taskIds.has(taskId)) fail(path, '任务变更重复'); taskIds.add(taskId);
    const source = before.tasks.find(t => t.id === taskId); if (!source) fail(path, '任务不在提交时的项目计划中');
    if (!Object.hasOwn(t, 'start') && !Object.hasOwn(t, 'due')) fail(path, '至少修改一个日期');
    const patch: PlanPatch['tasks'][number] = { taskId };
    if (Object.hasOwn(t, 'start')) patch.start = date(t.start, path + '.start');
    if (Object.hasOwn(t, 'due')) patch.due = date(t.due, path + '.due');
    if ((patch.due ?? source!.due) < (patch.start ?? source!.start)) fail(path, '截止日期早于开始日期');
    return patch;
  });
  if (!result.tasks.length && !result.project) fail(p, '变更内容为空');
  const changed = result.tasks.some(patch => { const t = before.tasks.find(t => t.id === patch.taskId)!; return (patch.start !== undefined && patch.start !== t.start) || (patch.due !== undefined && patch.due !== t.due); }) || (result.project?.target !== undefined && result.project.target !== before.project.target) || (result.project?.budget !== undefined && result.project.budget !== before.project.budget);
  if (!changed) fail(p, '变更内容与现有计划相同');
  return result;
}

function patched(before: PlanSnapshot, patch: PlanPatch): PlanSnapshot {
  const patches = new Map(patch.tasks.map(t => [t.taskId, t]));
  return { project: { ...before.project, ...patch.project }, tasks: before.tasks.map(t => { const p = patches.get(t.id); return p ? { ...clone(t), ...(p.start !== undefined ? { start: p.start } : {}), ...(p.due !== undefined ? { due: p.due } : {}) } : clone(t); }) };
}

function planningIssues(s: PlanSnapshot): ControlIssue[] {
  const issues: ControlIssue[] = [], byId = new Map(s.tasks.map(t => [t.id, t]));
  try { taskOrder(s.tasks); } catch (e) { issues.push({ code: 'cycle', message: (e as Error).message, taskIds: [] }); }
  for (const t of s.tasks) {
    if (!validDate(t.start) || !validDate(t.due) || t.due < t.start) issues.push({ code: 'date', message: `${t.id} 的计划日期无效`, taskIds: [t.id] });
    if (validDate(t.due) && validDate(s.project.target) && t.due > s.project.target) issues.push({ code: 'target', message: `${t.id} 截止日 ${t.due} 超过项目目标日 ${s.project.target}`, taskIds: [t.id] });
    for (const d of t.dependencies) {
      const dep = byId.get(d);
      if (!dep) issues.push({ code: 'missing', message: `${t.id} 的前置任务 ${d} 不存在`, taskIds: [t.id, d] });
      else if (t.start <= dep.due) issues.push({ code: 'dependency', message: `${t.id} 必须在 ${d} 完成后的下一日或以后开始`, taskIds: [t.id, d] });
    }
  }
  return issues;
}

export function createBaseline(w: ControlWorkspace, projectId: string, meta: { id: string; label: string; reviewer: string; reason: string; at: string }): ProjectBaseline {
  const baseline: ProjectBaseline = { id: id(meta.id, '基线编号'), projectId, label: text(meta.label, '基线名称', 200), reviewer: text(meta.reviewer, '确认人', 200), reason: text(meta.reason, '基线说明', 5000), createdAt: instant(meta.at, '确认时间'), snapshot: snapshot(w, projectId) };
  validateProjectControls([...(w.baselines ?? []), baseline], w.changes, w);
  return baseline;
}

export function compareBaseline(w: Workspace, baseline: ProjectBaseline): BaselineComparison {
  const current = snapshot(w, baseline.projectId), old = new Map(baseline.snapshot.tasks.map(t => [t.id, t])), now = new Map(current.tasks.map(t => [t.id, t]));
  const fields = ['title', 'owner', 'vendor', 'priority', 'start', 'due', 'acceptance'] as const;
  const tasks: TaskVariance[] = [...new Set([...old.keys(), ...now.keys()])].map(taskId => {
    const before = old.get(taskId) ?? null, after = now.get(taskId) ?? null;
    const changedFields: string[] = before && after ? fields.filter(k => before[k] !== after[k]) : [];
    if (before && after && JSON.stringify([...before.dependencies].sort()) !== JSON.stringify([...after.dependencies].sort())) changedFields.push('dependencies');
    return { taskId, title: (after ?? before)!.title, kind: !before ? 'added' : !after ? 'removed' : changedFields.length ? 'changed' : 'unchanged', before: clone(before), after: clone(after), startDeltaDays: before && after ? day(after.start) - day(before.start) : null, finishDeltaDays: before && after ? day(after.due) - day(before.due) : null, changedFields };
  });
  return { tasks, targetDeltaDays: day(current.project.target) - day(baseline.snapshot.project.target), budgetDelta: current.project.budget - baseline.snapshot.project.budget, added: tasks.filter(t => t.kind === 'added').length, removed: tasks.filter(t => t.kind === 'removed').length, changed: tasks.filter(t => t.kind === 'changed').length };
}

export function proposeChange(w: ControlWorkspace, projectId: string, input: { id: string; title: string; reason: string; requestedBy: string; at: string; patch: PlanPatch }): ProjectChange {
  const before = snapshot(w, projectId);
  const change: ProjectChange = { id: id(input.id, '变更编号'), projectId, title: text(input.title, '变更标题', 200), reason: text(input.reason, '变更原因', 5000), requestedBy: text(input.requestedBy, '提出人', 200), requestedAt: instant(input.at, '提出时间'), before, patch: parsePatch(input.patch, before, '变更内容'), status: 'pending', reviewer: '', decisionNote: '', decidedAt: null };
  validateProjectControls(w.baselines, [...(w.changes ?? []), change], w);
  return change;
}

export function previewChange(w: Workspace, change: ProjectChange): ChangePreview {
  const current = snapshot(w, change.projectId), proposed = patched(change.before, change.patch), stale = canonicalPlan(current) !== canonicalPlan(change.before);
  const issues = planningIssues(proposed);
  if (stale) issues.unshift({ code: 'stale', message: '提交后计划已变化，请根据当前计划重新提出变更。', taskIds: [] });
  if (change.status !== 'pending') issues.unshift({ code: 'state', message: '此变更已作出决定，不能重复应用。', taskIds: [] });
  for (const patch of change.patch.tasks) {
    const t = current.tasks.find(t => t.id === patch.taskId);
    if (t?.status === 'done' && ((patch.start !== undefined && patch.start !== t.start) || (patch.due !== undefined && patch.due !== t.due))) issues.push({ code: 'state', message: `${t.id} 已完成，不能通过排期变更移动其日期。`, taskIds: [t.id] });
  }
  return { stale, canApply: issues.length === 0, issues, affectedTaskIds: change.patch.tasks.filter(p => { const t = change.before.tasks.find(t => t.id === p.taskId); return t && ((p.start !== undefined && p.start !== t.start) || (p.due !== undefined && p.due !== t.due)); }).map(p => p.taskId), tasks: proposed.tasks, targetDeltaDays: day(proposed.project.target) - day(change.before.project.target), budgetDelta: proposed.project.budget - change.before.project.budget, project: { before: clone(change.before.project), after: proposed.project } };
}

export function decideChange(w: ControlWorkspace, changeId: string, decision: { status: 'applied' | 'rejected'; reviewer: string; decisionNote: string; at: string }): ControlWorkspace {
  const existing = w.changes?.find(c => c.id === changeId);
  if (!existing) return fail('变更', '找不到变更记录');
  if (existing.status !== 'pending') fail('变更', '已经作出决定，不能再次应用');
  const status = choice(decision.status, '决定', ['applied', 'rejected']);
  const updated: ProjectChange = { ...clone(existing), status, reviewer: text(decision.reviewer, '审核人', 200), decisionNote: text(decision.decisionNote, '决定依据', 5000), decidedAt: instant(decision.at, '决定时间') };
  if (Date.parse(updated.decidedAt!) < Date.parse(existing.requestedAt)) fail('决定时间', '不能早于提出时间');
  if (status === 'applied') {
    const preview = previewChange(w, existing);
    if (!preview.canApply) fail('变更不可应用', preview.issues.map(i => i.message).join('；'));
  }
  const patches = new Map(existing.patch.tasks.map(t => [t.taskId, t]));
  const result: ControlWorkspace = { ...w, changes: w.changes!.map(c => c.id === changeId ? updated : c) };
  if (status === 'applied') {
    result.projects = w.projects.map(p => p.id === existing.projectId ? { ...p, ...existing.patch.project } : p);
    result.tasks = w.tasks.map(t => {
      const patch = t.projectId === existing.projectId ? patches.get(t.id) : undefined;
      return patch ? { ...t, ...(patch.start !== undefined ? { start: patch.start } : {}), ...(patch.due !== undefined ? { due: patch.due } : {}) } : t;
    });
  }
  return result;
}

/** Suggest calendar-day FS shifts; applying a suggestion still requires a new request and review. */
export function shiftDownstream(w: Workspace, projectId: string, patch: PlanPatch): PlanPatch {
  const before = snapshot(w, projectId), checked = parsePatch(patch, before, '顺延建议'), proposed = patched(before, checked), order = taskOrder(proposed.tasks), byId = new Map(proposed.tasks.map(t => [t.id, t]));
  for (const t of proposed.tasks) if (!validDate(t.start) || !validDate(t.due) || t.due < t.start) fail('顺延建议', `${t.id} 日期无效`);
  const affected = new Set(checked.tasks.filter(p => { const t = before.tasks.find(t => t.id === p.taskId)!; return (p.start !== undefined && p.start !== t.start) || (p.due !== undefined && p.due !== t.due); }).map(p => p.taskId));
  for (const key of order) {
    const t = byId.get(key)!;
    if (t.dependencies.some(d => affected.has(d))) affected.add(key);
    if (!affected.has(key)) continue;
    if (!validDate(t.start) || !validDate(t.due) || t.due < t.start) fail('顺延建议', `${t.id} 日期无效`);
    const old = before.tasks.find(old => old.id === key)!;
    const nextStart = Math.max(day(t.start), ...t.dependencies.map(d => day(byId.get(d)!.due) + 1));
    if (t.status === 'done' && (t.start !== old.start || t.due !== old.due || nextStart > day(t.start))) fail('顺延建议', `${t.id} 已完成，不能移动其计划日期`);
    const duration = day(t.due) - day(t.start);
    t.start = dateAt(nextStart); t.due = dateAt(nextStart + duration);
    if (!validDate(t.start) || !validDate(t.due)) fail('顺延建议', '顺延超出支持的日期范围');
  }
  const tasks: PlanPatch['tasks'] = proposed.tasks.flatMap(t => { const old = before.tasks.find(old => old.id === t.id)!; return t.start === old.start && t.due === old.due ? [] : [{ taskId: t.id, start: t.start, due: t.due }]; });
  return { ...(checked.project ? { project: clone(checked.project) } : {}), tasks };
}

export function validateProjectControls(baselinesValue: unknown, changesValue: unknown, w: Workspace, usedIds?: ReadonlySet<string>): { baselines: ProjectBaseline[]; changes: ProjectChange[] } {
  const used = new Set(usedIds ?? [...w.projects, ...w.tasks, ...w.risks, ...w.measurements, ...w.briefs, ...w.audit].map(r => r.id));
  for (const handover of w.handovers ?? []) used.add(handover.id);
  const unique = (v: unknown, p: string) => { const key = id(v, p); if (used.has(key)) fail(p, '编号重复'); used.add(key); return key; };
  let snapshotTasks = 0;
  const checkSnapshot = (v: unknown, projectId: string, p: string) => { const s = parseSnapshot(v, projectId, w, p); snapshotTasks += s.tasks.length; if (snapshotTasks > 20000) fail('项目控制记录', '历史任务快照总量超过 20000 项'); return s; };
  const baselines = arr(baselinesValue === undefined ? [] : baselinesValue, 'baselines', 100).map((value, i): ProjectBaseline => {
    const p = `baselines[${i}]`, r = obj(value, p, ['id', 'projectId', 'label', 'reviewer', 'reason', 'createdAt', 'snapshot']), projectId = id(r.projectId, p + '.projectId');
    return { id: unique(r.id, p + '.id'), projectId, label: text(r.label, p + '.label', 200), reviewer: text(r.reviewer, p + '.reviewer', 200), reason: text(r.reason, p + '.reason', 5000), createdAt: instant(r.createdAt, p + '.createdAt'), snapshot: checkSnapshot(r.snapshot, projectId, p + '.snapshot') };
  });
  const changes = arr(changesValue === undefined ? [] : changesValue, 'changes', 200).map((value, i): ProjectChange => {
    const p = `changes[${i}]`, r = obj(value, p, ['id', 'projectId', 'title', 'reason', 'requestedBy', 'requestedAt', 'before', 'patch', 'status', 'reviewer', 'decisionNote', 'decidedAt']), projectId = id(r.projectId, p + '.projectId'), before = checkSnapshot(r.before, projectId, p + '.before'), status = choice(r.status, p + '.status', ['pending', 'applied', 'rejected']);
    const change: ProjectChange = { id: unique(r.id, p + '.id'), projectId, title: text(r.title, p + '.title', 200), reason: text(r.reason, p + '.reason', 5000), requestedBy: text(r.requestedBy, p + '.requestedBy', 200), requestedAt: instant(r.requestedAt, p + '.requestedAt'), before, patch: parsePatch(r.patch, before, p + '.patch'), status, reviewer: text(r.reviewer, p + '.reviewer', 200, status === 'pending'), decisionNote: text(r.decisionNote, p + '.decisionNote', 5000, status === 'pending'), decidedAt: r.decidedAt === null ? null : instant(r.decidedAt, p + '.decidedAt') };
    if (status === 'pending' && (change.reviewer !== '' || change.decisionNote !== '' || change.decidedAt !== null)) fail(p, '待审核记录不能包含决定');
    if (status !== 'pending' && (change.decidedAt === null || Date.parse(change.decidedAt) < Date.parse(change.requestedAt))) fail(p, '决定时间缺失或早于提出时间');
    if (status === 'applied') {
      const issues = planningIssues(patched(before, change.patch));
      if (issues.length) fail(p, '已应用记录的提议计划不满足日期与依赖约束');
      for (const patch of change.patch.tasks) { const t = before.tasks.find(t => t.id === patch.taskId)!; if (t.status === 'done' && ((patch.start !== undefined && patch.start !== t.start) || (patch.due !== undefined && patch.due !== t.due))) fail(p, '已应用记录不能移动提交时已完成的任务'); }
    }
    return change;
  });
  return { baselines, changes };
}
