import type { HandoverRecord } from './handover-types';
import type { ProjectBaseline, ProjectChange } from './project-control-types';
export type Status = 'todo'|'active'|'blocked'|'review'|'done';
export type Priority = 'low'|'medium'|'high';
export interface Task {id:string;projectId:string;title:string;owner:string;vendor:string;status:Status;priority:Priority;start:string;due:string;dependencies:string[];acceptance:string;accepted:boolean;evidence:string;}
export interface Project {id:string;name:string;client:string;description:string;budget:number;spent:number;target:string;category:string;}
export interface Risk {id:string;projectId:string;title:string;type:'risk'|'issue'|'assumption'|'dependency';owner:string;impact:1|2|3;likelihood:1|2|3;status:'open'|'mitigated'|'closed';mitigation:string;taskId:string;}
export interface Measurement {id:string;projectId:string;label:string;before:number;after:number;beforeErrors:number;afterErrors:number;sampleSize:number;reviewer:string;date:string;provenance:'simulation'|'measured';}
export interface Audit {id:string;at:string;action:string;entityId:string;detail:string;}
export interface Brief {id:string;projectId:string;createdAt:string;mode:'rules'|'ollama'|'openai';text:string;sources:string[];reviewed:boolean;reviewer:string;inputHash:string;}
export interface Workspace {version:1;asOf:string;projects:Project[];tasks:Task[];risks:Risk[];measurements:Measurement[];briefs:Brief[];audit:Audit[];handovers?:HandoverRecord[];baselines?:ProjectBaseline[];changes?:ProjectChange[];}
export interface Finding {id:string;severity:'critical'|'warning'|'info';title:string;detail:string;sourceIds:string[];}
