import type { Task, Workspace } from './types';

export interface PlanSnapshot {
  project: { id: string; name: string; target: string; budget: number };
  tasks: Task[];
}
export interface ProjectBaseline {
  id: string;
  projectId: string;
  label: string;
  reviewer: string;
  reason: string;
  createdAt: string;
  snapshot: PlanSnapshot;
}
export interface PlanPatch {
  project?: { target?: string; budget?: number };
  tasks: Array<{ taskId: string; start?: string; due?: string }>;
}
export type ChangePatch = PlanPatch;
export interface ProjectChange {
  id: string;
  projectId: string;
  title: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  before: PlanSnapshot;
  patch: PlanPatch;
  status: 'pending' | 'applied' | 'rejected';
  reviewer: string;
  decisionNote: string;
  decidedAt: string | null;
}
export type ControlWorkspace = Workspace & {
  baselines?: ProjectBaseline[];
  changes?: ProjectChange[];
};
export interface TaskVariance {
  taskId: string;
  title: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  before: Task | null;
  after: Task | null;
  startDeltaDays: number | null;
  finishDeltaDays: number | null;
  changedFields: string[];
}
export interface BaselineComparison {
  tasks: TaskVariance[];
  targetDeltaDays: number;
  budgetDelta: number;
  added: number;
  removed: number;
  changed: number;
}
export interface ControlIssue {
  code: 'stale' | 'date' | 'dependency' | 'target' | 'missing' | 'cycle' | 'empty' | 'state';
  message: string;
  taskIds: string[];
}
export interface ChangePreview {
  stale: boolean;
  canApply: boolean;
  issues: ControlIssue[];
  affectedTaskIds: string[];
  tasks: Task[];
  targetDeltaDays: number;
  budgetDelta: number;
  project: { before: PlanSnapshot['project']; after: PlanSnapshot['project'] };
}
