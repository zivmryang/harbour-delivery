import { describe, expect, it } from 'vitest';
import type { Task, Workspace } from '../types';
import type { ControlWorkspace, PlanPatch } from '../project-control-types';
import { compareBaseline, createBaseline, decideChange, planSignature, previewChange, proposeChange, shiftDownstream, validateProjectControls } from './project-control';

const at = '2026-10-29T08:00:00.000Z', later = '2026-10-29T09:00:00.000Z';
function workspace(): ControlWorkspace {
  const task = (id: string, start: string, due: string, dependencies: string[] = []): Task => ({ id, projectId: 'P1', title: id + ' work', owner: 'Owner', vendor: '', priority: 'medium', start, due, dependencies, status: 'todo', acceptance: 'Written acceptance', accepted: false, evidence: '' });
  return { version: 1, asOf: '2026-10-29', projects: [{ id: 'P1', name: 'Project', client: 'Demo', description: '', budget: 1000, spent: 200, target: '2026-11-20', category: 'ICT' }, { id: 'P2', name: 'Other', client: '', description: '', budget: 100, spent: 0, target: '2026-11-20', category: 'ICT' }], tasks: [task('A', '2026-11-01', '2026-11-02'), task('B', '2026-11-03', '2026-11-05', ['A']), task('C', '2026-11-06', '2026-11-07', ['B']), { ...task('Z', '2026-11-01', '2026-11-02'), projectId: 'P2' }], risks: [], measurements: [], briefs: [], audit: [] };
}
const baseline = (w: ControlWorkspace) => createBaseline(w, 'P1', { id: 'BASE-1', label: 'Initial plan', reviewer: 'Demo reviewer', reason: 'Planning checkpoint', at });
function request(w: ControlWorkspace, patch: PlanPatch = { project: { budget: 1200 }, tasks: [] }) {
  return proposeChange(w, 'P1', { id: 'CR-1', title: 'Change', reason: 'Supplier delivery impact', requestedBy: 'Demo requester', at, patch });
}
const applied = { status: 'applied' as const, reviewer: 'Demo reviewer', decisionNote: 'Reviewed date and cost impact', at: later };

describe('project baselines', () => {
  it('retains a detached full snapshot and preserves old baseline versions', () => {
    const w = workspace(), b = baseline(w); w.baselines = [b];
    w.tasks[0].owner = 'Changed owner'; w.tasks[1].dependencies.push('A');
    expect(b.snapshot.tasks[0].owner).toBe('Owner');
    expect(b.snapshot.tasks[1].dependencies).toEqual(['A']);
    w.tasks[1].dependencies = ['A'];
    const b2 = createBaseline(w, 'P1', { id: 'BASE-2', label: 'Replan', reviewer: 'Reviewer', reason: 'Revised plan', at: later });
    expect(w.baselines).toEqual([b]);
    expect(b2.snapshot.tasks[0].owner).toBe('Changed owner');
  });
  it('compares dates, scope, owners, dependencies and added/removed tasks', () => {
    const w = workspace(), b = baseline(w);
    w.projects[0].budget = 1500; w.projects[0].target = '2026-11-22';
    w.tasks[0] = { ...w.tasks[0], title: 'New scope', owner: 'New owner', due: '2026-11-03', acceptance: 'New criterion' };
    w.tasks = w.tasks.filter(t => t.id !== 'C');
    w.tasks.push({ ...w.tasks[0], id: 'D', dependencies: ['B'] });
    const result = compareBaseline(w, b);
    expect(result).toMatchObject({ budgetDelta: 500, targetDeltaDays: 2, added: 1, removed: 1, changed: 1 });
    expect(result.tasks.find(t => t.taskId === 'A')).toMatchObject({ finishDeltaDays: 1, changedFields: ['title', 'owner', 'due', 'acceptance'] });
    expect(result.tasks.find(t => t.taskId === 'C')?.kind).toBe('removed');
    expect(result.tasks.find(t => t.taskId === 'D')?.kind).toBe('added');
  });
  it('does not call execution progress a baseline plan change', () => {
    const w = workspace(), b = baseline(w);
    w.tasks[0].status = 'active'; w.tasks[0].accepted = true; w.tasks[0].evidence = 'Record';
    expect(compareBaseline(w, b).changed).toBe(0);
  });
  it('requires explicit human baseline metadata and rejects ID collisions', () => {
    const w = workspace();
    expect(() => createBaseline(w, 'P1', { id: 'A', label: 'Plan', reviewer: 'Person', reason: 'Reason', at })).toThrow('重复');
    expect(() => createBaseline(w, 'P1', { id: 'BASE', label: 'Plan', reviewer: '', reason: 'Reason', at })).toThrow('确认人');
  });
});

describe('controlled changes', () => {
  it('uses a stable full planning signature, independent of execution state and array order', () => {
    const w = workspace(); w.tasks[2].dependencies = ['A', 'B'];
    const original = planSignature(w, 'P1');
    w.tasks.reverse(); w.tasks.find(t => t.id === 'C')!.dependencies.reverse();
    w.tasks.find(t => t.id === 'A')!.status = 'active';
    w.tasks.find(t => t.id === 'A')!.evidence = 'Progress record';
    w.projects[0].spent = 999;
    expect(planSignature(w, 'P1')).toBe(original);
    w.tasks.find(t => t.id === 'C')!.due = '2026-11-09';
    expect(planSignature(w, 'P1')).not.toBe(original);
  });
  it('records a proposal without modifying the plan and applies only reviewed fields atomically', () => {
    const w = workspace(), original = structuredClone(w), c = request(w, { project: { budget: 1300, target: '2026-11-21' }, tasks: [{ taskId: 'C', start: '2026-11-07', due: '2026-11-08' }] });
    expect(w).toEqual(original); w.changes = [c];
    w.tasks[1].status = 'active'; w.tasks[1].evidence = 'Progress note';
    const result = decideChange(w, c.id, applied);
    expect(result.projects[0]).toMatchObject({ budget: 1300, target: '2026-11-21', spent: 200 });
    expect(result.tasks[2]).toMatchObject({ start: '2026-11-07', due: '2026-11-08', status: 'todo', accepted: false });
    expect(result.tasks[1]).toMatchObject({ status: 'active', evidence: 'Progress note' });
    expect(result.projects[1]).toEqual(w.projects[1]); expect(result.tasks[3]).toEqual(w.tasks[3]);
    expect(result.changes![0]).toMatchObject({ status: 'applied', reviewer: applied.reviewer, decidedAt: later });
    expect(w.projects[0].budget).toBe(1000); expect(w.changes[0].status).toBe('pending');
  });
  it('rejects stale plan content, even a changed owner, while ignoring array order and execution state', () => {
    const w = workspace(), c = request(w); w.changes = [c];
    w.tasks.reverse(); w.tasks.find(t => t.id === 'A')!.status = 'active';
    expect(previewChange(w, c).stale).toBe(false);
    w.tasks.find(t => t.id === 'A')!.owner = 'Another owner';
    expect(previewChange(w, c).stale).toBe(true);
    expect(() => decideChange(w, c.id, applied)).toThrow('提交后计划已变化');
    expect(w.projects[0].budget).toBe(1000);
  });
  it('catches tasks added or deleted after submission and project name/budget changes', () => {
    for (const mutate of [
      (w: Workspace) => { w.tasks.push({ ...w.tasks[0], id: 'D' }); },
      (w: Workspace) => { w.tasks = w.tasks.filter(t => t.id !== 'C'); },
      (w: Workspace) => { w.projects[0].name = 'Renamed'; },
      (w: Workspace) => { w.projects[0].budget = 999; },
    ]) { const w = workspace(), c = request(w); mutate(w); expect(previewChange(w, c).stale).toBe(true); }
  });
  it('allows rejection of stale requests without changing any execution records', () => {
    const w = workspace(), c = request(w); w.changes = [c]; w.projects[0].budget = 1100;
    const result = decideChange(w, c.id, { ...applied, status: 'rejected', decisionNote: 'Superseded by another decision' });
    expect(result.projects).toEqual(w.projects); expect(result.tasks).toEqual(w.tasks);
    expect(result.changes![0].status).toBe('rejected');
  });
  it('blocks FS overlaps, including downstream tasks omitted from a request', () => {
    const w = workspace(), c = request(w, { tasks: [{ taskId: 'A', due: '2026-11-04' }] }); w.changes = [c];
    const preview = previewChange(w, c);
    expect(preview.canApply).toBe(false); expect(preview.issues.some(i => i.code === 'dependency' && i.taskIds.join() === 'B,A')).toBe(true);
    expect(() => decideChange(w, c.id, applied)).toThrow('下一日');
  });
  it('blocks the new target being earlier than unchanged tasks', () => {
    const w = workspace(), c = request(w, { project: { target: '2026-11-04' }, tasks: [] });
    expect(previewChange(w, c).issues.filter(i => i.code === 'target').map(i => i.taskIds[0])).toEqual(['B', 'C']);
  });
  it('does not move tasks that became completed during review', () => {
    const w = workspace(), c = request(w, { tasks: [{ taskId: 'C', start: '2026-11-08', due: '2026-11-09' }] }); w.changes = [c]; w.tasks[2].status = 'done';
    expect(previewChange(w, c).stale).toBe(false);
    expect(() => decideChange(w, c.id, applied)).toThrow('已完成');
  });
  it('requires a reviewer, decision basis, valid chronology and a pending request', () => {
    const w = workspace(), c = request(w); w.changes = [c];
    expect(() => decideChange(w, c.id, { ...applied, reviewer: '' })).toThrow('审核人');
    expect(() => decideChange(w, c.id, { ...applied, decisionNote: '' })).toThrow('决定依据');
    expect(() => decideChange(w, c.id, { ...applied, at: '2026-10-28T09:00:00Z' })).toThrow('不能早于');
    const result = decideChange(w, c.id, applied);
    expect(() => decideChange(result, c.id, applied)).toThrow('已经作出决定');
  });
  it('rejects no-op, invalid dates, unknown fields, other project tasks and duplicate task patches', () => {
    const w = workspace();
    for (const patch of [
      { tasks: [] }, { project: { budget: 1000 }, tasks: [] }, { tasks: [{ taskId: 'A', due: '2026-02-30' }] },
      { tasks: [{ taskId: 'A', start: '2026-11-03' }] }, { tasks: [{ taskId: 'Z', due: '2026-11-03' }] },
      { tasks: [{ taskId: 'A', due: '2026-11-04' }, { taskId: 'A', due: '2026-11-05' }] },
      { project: { spent: 900 }, tasks: [] }, { tasks: [{ taskId: 'A', status: 'done' }] },
    ]) expect(() => request(w, patch as PlanPatch)).toThrow();
  });
});

describe('dependency shift suggestions', () => {
  it('propagates inclusive calendar-day durations and leaves target/budget untouched', () => {
    const w = workspace(), original = structuredClone(w);
    const patch = shiftDownstream(w, 'P1', { project: { budget: 1400 }, tasks: [{ taskId: 'A', due: '2026-11-04' }] });
    expect(patch).toEqual({ project: { budget: 1400 }, tasks: [{ taskId: 'A', start: '2026-11-01', due: '2026-11-04' }, { taskId: 'B', start: '2026-11-05', due: '2026-11-07' }, { taskId: 'C', start: '2026-11-08', due: '2026-11-09' }] });
    expect(w).toEqual(original); expect(previewChange(w, request(w, patch)).canApply).toBe(true);
  });
  it('does not bring a successor forward when its predecessor finishes earlier', () => {
    const w = workspace(), patch = shiftDownstream(w, 'P1', { tasks: [{ taskId: 'A', due: '2026-11-01' }] });
    expect(patch.tasks).toEqual([{ taskId: 'A', start: '2026-11-01', due: '2026-11-01' }]);
  });
  it('uses the latest finish across multiple predecessors without moving unrelated branches', () => {
    const w = workspace(); w.tasks.push({ ...w.tasks[0], id: 'D', start: '2026-11-01', due: '2026-11-10' }); w.tasks[1].dependencies.push('D');
    const patch = shiftDownstream(w, 'P1', { tasks: [{ taskId: 'A', due: '2026-11-04' }] });
    expect(patch.tasks.find(t => t.taskId === 'B')).toMatchObject({ start: '2026-11-11', due: '2026-11-13' });
    expect(patch.tasks.some(t => t.taskId === 'D')).toBe(false);
  });
  it('rejects moving completed tasks, cycles, missing references and invalid source dates', () => {
    const patch = { tasks: [{ taskId: 'A', due: '2026-11-04' }] };
    const done = workspace(); done.tasks[1].status = 'done'; expect(() => shiftDownstream(done, 'P1', patch)).toThrow('已完成');
    const cycle = workspace(); cycle.tasks[0].dependencies = ['C']; expect(() => shiftDownstream(cycle, 'P1', patch)).toThrow('循环');
    const missing = workspace(); missing.tasks[1].dependencies = ['Z']; expect(() => shiftDownstream(missing, 'P1', patch)).toThrow('不存在或跨项目');
    const invalid = workspace(); invalid.tasks[2].start = 'bad'; expect(() => shiftDownstream(invalid, 'P1', patch)).toThrow('日期');
  });
});

describe('project control backup validation', () => {
  it('accepts absent legacy fields and round-trips valid recorded decisions', () => {
    const w = workspace(); expect(validateProjectControls(undefined, undefined, w)).toEqual({ baselines: [], changes: [] });
    expect(() => validateProjectControls(null, undefined, w)).toThrow('baselines');
    expect(() => validateProjectControls(undefined, null, w)).toThrow('changes');
    w.baselines = [baseline(w)]; w.changes = [request(w)];
    const result = decideChange(w, 'CR-1', applied);
    expect(validateProjectControls(JSON.parse(JSON.stringify(result.baselines)), JSON.parse(JSON.stringify(result.changes)), result)).toEqual({ baselines: result.baselines, changes: result.changes });
  });
  it('permits deleted historical tasks but rejects IDs reassigned to another project', () => {
    const w = workspace(), b = baseline(w); w.tasks = w.tasks.filter(t => t.id !== 'C');
    expect(validateProjectControls([b], [], w).baselines).toHaveLength(1);
    w.tasks.push({ ...b.snapshot.tasks[2], projectId: 'P2' });
    expect(() => validateProjectControls([b], [], w)).toThrow('其他项目');
  });
  it('rejects duplicate artifact IDs, malformed snapshots, unknown fields and invalid status combinations', () => {
    const w = workspace(), b = baseline(w), c = request(w);
    const mutations: Array<() => void> = [
      () => { c.id = b.id; }, () => { c.before.tasks[0].projectId = 'P2'; },
      () => { c.patch = { tasks: [{ taskId: 'A', due: 'bad' }] }; },
      () => { c.reviewer = 'Unexpected'; }, () => { c.status = 'applied'; },
      () => { (b as unknown as Record<string, unknown>).extra = 'hidden'; },
    ];
    for (const mutate of mutations) {
      const oldB = structuredClone(b), oldC = structuredClone(c); mutate();
      expect(() => validateProjectControls([b], [c], w)).toThrow();
      Object.keys(b).forEach(k => delete (b as unknown as Record<string, unknown>)[k]); Object.assign(b, oldB);
      Object.keys(c).forEach(k => delete (c as unknown as Record<string, unknown>)[k]); Object.assign(c, oldC);
    }
  });
  it('rejects a fabricated applied request whose plan violates dependencies', () => {
    const w = workspace(), c = request(w, { tasks: [{ taskId: 'A', due: '2026-11-04' }] });
    Object.assign(c, { status: 'applied', reviewer: 'Name', decisionNote: 'Note', decidedAt: later });
    expect(() => validateProjectControls([], [c], w)).toThrow('日期与依赖约束');
  });
  it('honors supplied used IDs and rejects empty/overflow metadata', () => {
    const w = workspace(), b = baseline(w);
    expect(() => validateProjectControls([b], [], w, new Set(['BASE-1']))).toThrow('重复');
    b.reason = ''; expect(() => validateProjectControls([b], [], w)).toThrow('reason');
    b.reason = 'a'.repeat(5001); expect(() => validateProjectControls([b], [], w)).toThrow('reason');
  });
});
