import { describe, expect, it } from 'vitest';
import { seedWorkspace } from '../demo';
import type { Workspace } from '../types';
import { validateWorkspace } from './engine';
import {
  compareBaseline,
  createBaseline,
  decideChange,
  previewChange,
  proposeChange,
  shiftDownstream,
} from './project-control';

const submittedAt = '2026-10-29T08:00:00.000Z';
const decidedAt = '2026-10-29T09:00:00.000Z';
const roundTrip = (w: Workspace): Workspace => validateWorkspace(JSON.parse(JSON.stringify(w)));

function pendingWorkspace(): Workspace {
  const w = roundTrip(seedWorkspace());
  w.baselines = [createBaseline(w, 'harbourlink', {
    id: 'BASE-HL-INITIAL', label: 'Initial delivery plan', reviewer: 'Synthetic reviewer',
    reason: 'Recorded planning checkpoint for the synthetic delivery scenario', at: submittedAt,
  })];
  const patch = shiftDownstream(w, 'harbourlink', {
    project: { target: '2026-11-16', budget: 500000 },
    tasks: [{ taskId: 'HL-03', due: '2026-11-02' }],
  });
  w.changes = [proposeChange(w, 'harbourlink', {
    id: 'CR-HL-DELIVERY', title: 'Supplier delivery delay',
    reason: 'Synthetic supplier update requires downstream schedule review',
    requestedBy: 'Synthetic requester', at: submittedAt, patch,
  })];
  return roundTrip(w);
}

const decision = {
  status: 'applied' as const, reviewer: 'Synthetic reviewer',
  decisionNote: 'Confirmed the proposed dates and budget for this test scenario', at: decidedAt,
};

describe('project controls through workspace persistence', () => {
  it('keeps legacy backups unchanged when control records are absent', () => {
    const original = seedWorkspace();
    const restored = roundTrip(original);
    expect(restored).toEqual(original);
    expect(Object.hasOwn(restored, 'baselines')).toBe(false);
    expect(Object.hasOwn(restored, 'changes')).toBe(false);
    expect(roundTrip({ ...original, baselines: [] })).toMatchObject({ baselines: [], changes: [] });
  });

  it('round-trips a real baseline and dependency-shift proposal without modifying the active plan', () => {
    const original = seedWorkspace(), w = pendingWorkspace();
    expect(w.projects).toEqual(original.projects);
    expect(w.tasks).toEqual(original.tasks);
    expect(w.baselines![0].snapshot.tasks).toEqual(original.tasks.filter(t => t.projectId === 'harbourlink'));
    expect(w.changes![0]).toMatchObject({ status: 'pending', reviewer: '', decidedAt: null });
    expect(previewChange(w, w.changes![0])).toMatchObject({ canApply: true, stale: false, budgetDelta: 20000, targetDeltaDays: 3 });
    expect(w.changes![0].patch.tasks.map(t => t.taskId)).toEqual(['HL-03', 'HL-05', 'HL-06', 'HL-07', 'HL-08']);
    expect(roundTrip(w)).toEqual(w);

    const restored = roundTrip(w);
    restored.baselines![0].snapshot.tasks[2].dependencies.push('HL-01');
    restored.changes![0].before.tasks[2].title = 'Changed only in the restored object';
    expect(w.baselines![0].snapshot.tasks[2].dependencies).toEqual(['HL-02']);
    expect(w.changes![0].before.tasks[2].title).toBe(original.tasks[2].title);
  });

  it('applies and restores a reviewed schedule while retaining execution state and other projects', () => {
    const w = pendingWorkspace();
    const equipment = w.tasks.find(t => t.id === 'HL-03')!;
    equipment.status = 'active';
    equipment.evidence = 'Synthetic progress note entered while the request was under review';
    w.tasks.find(t => t.id === 'CF-03')!.status = 'blocked';
    const beforeDecision = roundTrip(w);
    const applied = roundTrip(decideChange(beforeDecision, 'CR-HL-DELIVERY', decision));

    expect(applied.changes![0]).toMatchObject({ status: 'applied', reviewer: decision.reviewer, decisionNote: decision.decisionNote, decidedAt });
    expect(applied.projects.find(p => p.id === 'harbourlink')).toMatchObject({ target: '2026-11-16', budget: 500000, spent: 312000 });
    expect(applied.tasks.find(t => t.id === 'HL-08')).toMatchObject({ start: '2026-11-11', due: '2026-11-16' });
    expect(applied.tasks.map(({ id, status, accepted, evidence }) => ({ id, status, accepted, evidence })))
      .toEqual(beforeDecision.tasks.map(({ id, status, accepted, evidence }) => ({ id, status, accepted, evidence })));
    expect(applied.projects.filter(p => p.id !== 'harbourlink')).toEqual(beforeDecision.projects.filter(p => p.id !== 'harbourlink'));
    expect(applied.tasks.filter(t => t.projectId !== 'harbourlink')).toEqual(beforeDecision.tasks.filter(t => t.projectId !== 'harbourlink'));
    expect(applied.risks).toEqual(beforeDecision.risks);
    expect(applied.measurements).toEqual(beforeDecision.measurements);
    expect(applied.baselines).toEqual(beforeDecision.baselines);
    expect(compareBaseline(applied, applied.baselines![0])).toMatchObject({ changed: 5, added: 0, removed: 0, targetDeltaDays: 3, budgetDelta: 20000 });
    expect(roundTrip(applied)).toEqual(applied);
    expect(() => decideChange(applied, 'CR-HL-DELIVERY', decision)).toThrow('已经作出决定');
    expect(beforeDecision.changes![0].status).toBe('pending');
    expect(beforeDecision.tasks.find(t => t.id === 'HL-08')!.due).toBe('2026-11-13');
  });

  it('restores a rejected stale request without changing plan, progress or other project records', () => {
    const w = pendingWorkspace();
    w.tasks.find(t => t.id === 'HL-03')!.title += ' — revised planning scope';
    w.tasks.find(t => t.id === 'HL-04')!.evidence = 'Synthetic ongoing verification';
    expect(previewChange(w, w.changes![0]).stale).toBe(true);
    const beforeDecision = roundTrip(w);
    const rejected = roundTrip(decideChange(beforeDecision, 'CR-HL-DELIVERY', { ...decision, status: 'rejected', decisionNote: 'Superseded by the revised scope' }));
    expect(rejected.changes![0]).toMatchObject({ status: 'rejected', decisionNote: 'Superseded by the revised scope', decidedAt });
    expect({ ...rejected, changes: beforeDecision.changes }).toEqual(beforeDecision);
    expect(roundTrip(rejected)).toEqual(rejected);
    expect(() => decideChange(rejected, 'CR-HL-DELIVERY', decision)).toThrow('已经作出决定');
  });

  it.each([
    ['baseline date', (w: Workspace) => { w.baselines![0].snapshot.tasks[0].due = '2026-02-30'; }, /日期/],
    ['baseline project', (w: Workspace) => { w.baselines![0].projectId = 'civicflow'; }, /项目不一致/],
    ['cross-project snapshot', (w: Workspace) => { w.changes![0].before.tasks.push(w.tasks.find(t => t.id === 'CF-03')!); }, /不属于本项目/],
    ['cross-project patch', (w: Workspace) => { w.changes![0].patch.tasks[0].taskId = 'CF-03'; }, /不在提交时的项目计划/],
    ['pending decision', (w: Workspace) => { w.changes![0].reviewer = 'Unexpected reviewer'; }, /待审核记录不能包含决定/],
    ['missing applied decision', (w: Workspace) => { w.changes![0].status = 'applied'; }, /reviewer/],
    ['fabricated applied dependency overlap', (w: Workspace) => {
      Object.assign(w.changes![0], { status: 'applied', reviewer: decision.reviewer, decisionNote: decision.decisionNote, decidedAt });
      w.changes![0].patch.tasks = [{ taskId: 'HL-03', due: '2026-11-02' }];
    }, /日期与依赖约束/],
    ['unknown control field', (w: Workspace) => { Object.assign(w.baselines![0], { hiddenApproval: true }); }, /未知字段/],
  ] as const)('rejects malformed persisted control records: %s', (_label, corrupt, message) => {
    const w = pendingWorkspace();
    corrupt(w);
    expect(() => roundTrip(w)).toThrow(message);
  });

  it.each(['harbourlink', 'HL-03', 'RAID-HL-01', 'MET-HL-01', 'CR-HL-DELIVERY'])
    ('rejects a baseline ID collision with a persisted workspace record: %s', existingId => {
      const w = pendingWorkspace();
      w.baselines![0].id = existingId;
      expect(() => roundTrip(w)).toThrow('重复');
    });

  it('rejects change IDs that collide with audit and briefing IDs at the outer workspace boundary', () => {
    const w = pendingWorkspace();
    w.audit = [{ id: 'CR-HL-DELIVERY', at: submittedAt, action: 'Synthetic audit', entityId: 'harbourlink', detail: '' }];
    expect(() => roundTrip(w)).toThrow('重复');
    w.audit = [];
    w.briefs = [{ id: 'CR-HL-DELIVERY', projectId: 'harbourlink', createdAt: submittedAt, mode: 'rules', text: 'Synthetic report', sources: ['HL-03'], reviewed: false, reviewer: '', inputHash: 'test-only' }];
    expect(() => roundTrip(w)).toThrow('重复');
  });
});
