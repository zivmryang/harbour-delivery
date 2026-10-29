import type {Finding, Task, Workspace} from '../types';
import {validateHandoverRecords} from '../handover-types';
import {validateProjectControls} from './project-control';

const DAY = 86_400_000;
export function validDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const day = (value: string) => Date.parse(value + 'T00:00:00Z') / DAY;

/** Calendar-day, finish-to-start CPM. Durations include both displayed endpoints.
 * Planned start constraints are deliberately not added: this is a dependency network,
 * not a resource-levelled, work-calendar-aware scheduling engine. */
export function criticalPath(tasks: Task[]): {criticalIds: string[]; duration: number; cycle: boolean; slack: Record<string, number>} {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const deps = new Map(tasks.map(t => [t.id, [...new Set(t.dependencies)].filter(d => byId.has(d))]));
  const children = new Map(tasks.map(t => [t.id, [] as string[]]));
  const indegree = new Map(tasks.map(t => [t.id, deps.get(t.id)!.length]));
  for (const t of tasks) for (const d of deps.get(t.id)!) children.get(d)!.push(t.id);
  const queue = tasks.filter(t => indegree.get(t.id) === 0).map(t => t.id);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; order.push(id);
    for (const c of children.get(id)!) { indegree.set(c, indegree.get(c)! - 1); if (!indegree.get(c)) queue.push(c); }
  }
  if (order.length !== tasks.length) return {criticalIds: [], duration: 0, cycle: true, slack: {}};
  const durationOf = (id: string) => { const t = byId.get(id)!; return validDate(t.start) && validDate(t.due) ? Math.max(1, day(t.due) - day(t.start) + 1) : 1; };
  const es: Record<string, number> = {}, ef: Record<string, number> = {}, ls: Record<string, number> = {};
  for (const id of order) { es[id] = Math.max(0, ...deps.get(id)!.map(d => ef[d])); ef[id] = es[id] + durationOf(id); }
  const duration = Math.max(0, ...Object.values(ef));
  for (const id of [...order].reverse()) { const successors = children.get(id)!; const lf = successors.length ? Math.min(...successors.map(c => ls[c])) : duration; ls[id] = lf - durationOf(id); }
  const slack = Object.fromEntries(order.map(id => [id, ls[id] - es[id]]));
  return {criticalIds: order.filter(id => slack[id] === 0), duration, cycle: false, slack};
}

export function canComplete(task: Task, tasks: Task[]): string[] {
  const reasons: string[] = [];
  if (!task.owner.trim()) reasons.push('需要明确负责人');
  if (!task.acceptance.trim()) reasons.push('需要验收标准');
  if (!task.accepted) reasons.push('需要确认验收通过');
  if (!task.evidence.trim()) reasons.push('需要验收证据或记录');
  const byId = new Map(tasks.map(t => [t.id, t]));
  byId.set(task.id, task);
  const dependencyMemo = new Map<string, boolean>();
  const validDependency = (dep: Task, seen: Set<string>): boolean => {
    if (seen.has(dep.id) || dep.status !== 'done' || !dep.accepted || !dep.acceptance.trim() || !dep.evidence.trim() || !dep.owner.trim()) return false;
    if (dependencyMemo.has(dep.id)) return dependencyMemo.get(dep.id)!;
    const next = new Set(seen); next.add(dep.id);
    const valid = dep.dependencies.every(id => {const upstream=byId.get(id);return !!upstream && upstream.projectId===task.projectId && validDependency(upstream,next);});
    dependencyMemo.set(dep.id, valid); return valid;
  };
  for (const id of new Set(task.dependencies)) {
    const dep = byId.get(id);
    if (!dep) reasons.push(`依赖 ${id} 不存在`);
    else if (dep.projectId !== task.projectId) reasons.push(`依赖 ${id} 不属于本项目`);
    else if (!validDependency(dep, new Set([task.id]))) reasons.push(`依赖 ${id} 尚未完成有效验收`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((byId.get(id)?.dependencies ?? []).some(cyclic)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (cyclic(task.id)) reasons.push('依赖关系存在循环');
  if (!validDate(task.start) || !validDate(task.due) || task.due < task.start) reasons.push('计划日期无效');
  return reasons;
}

export function analyze(w: Workspace, projectId?: string): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, severity: Finding['severity'], title: string, detail: string, sourceIds: string[]) => findings.push({id, severity, title, detail, sourceIds});
  const projects = w.projects.filter(p => !projectId || p.id === projectId);
  const projectIds = new Set(projects.map(p => p.id));
  const tasks = w.tasks.filter(t => projectIds.has(t.projectId));
  const byId = new Map(w.tasks.map(t => [t.id, t]));
  if (!validDate(w.asOf)) add('invalid-asof', 'critical', '报告日期无效', '请设置有效的 YYYY-MM-DD 日期。', []);
  for (const p of projects) {
    if (p.spent > p.budget) add(`budget-${p.id}`, 'critical', '项目支出超过预算', `${p.name}：支出 HK$${p.spent.toLocaleString('en-HK')}，预算 HK$${p.budget.toLocaleString('en-HK')}。`, [p.id]);
    if (criticalPath(tasks.filter(t => t.projectId === p.id)).cycle) add(`cycle-${p.id}`, 'critical', '计划存在循环依赖', '先修正依赖关系，再计算关键路径或确认交付。', tasks.filter(t => t.projectId === p.id).map(t => t.id));
    if (validDate(w.asOf) && validDate(p.target) && p.target < w.asOf && tasks.some(t => t.projectId === p.id && t.status !== 'done')) add(`target-${p.id}`, 'critical', '目标交付日已过', `${p.name} 仍有未完成任务；目标日期为 ${p.target}。`, [p.id]);
  }
  for (const t of tasks) {
    if (!validDate(t.start) || !validDate(t.due) || t.due < t.start) add(`date-${t.id}`, 'critical', '任务日期无效', `${t.title} 的开始或截止日期需要修正。`, [t.id]);
    else if (validDate(w.asOf) && t.status !== 'done' && t.due < w.asOf) add(`overdue-${t.id}`, 'critical', '任务逾期', `${t.title} 已逾期 ${Math.max(0, day(w.asOf) - day(t.due))} 个日历日。`, [t.id]);
    if (!t.owner.trim()) add(`owner-${t.id}`, 'warning', '尚未指定负责人', `${t.title} 需要明确责任归属。`, [t.id]);
    if (t.status === 'blocked') add(`blocked-${t.id}`, 'warning', '交付任务受阻', `${t.title} 已标记为受阻，请明确解除条件与负责人。`, [t.id]);
    for (const id of new Set(t.dependencies)) {
      const dep = byId.get(id);
      if (!dep || dep.projectId !== t.projectId) add(`missing-${t.id}-${id}`, 'critical', '依赖引用无效', `${t.title} 引用了不存在或其他项目的任务 ${id}。`, [t.id]);
      else if (dep.status !== 'done') add(`waiting-${t.id}-${id}`, t.status === 'done' ? 'critical' : t.status === 'todo' ? 'info' : 'warning', '前置任务尚未完成', `${t.title} 依赖 ${dep.title}。`, [t.id, id]);
      if (dep && validDate(t.start) && validDate(dep.due) && t.start <= dep.due) add(`overlap-${t.id}-${id}`, 'warning', 'FS 依赖的计划日期重叠', `${t.title} 应在 ${id} 完成后开始；请核对计划或依赖类型。`, [t.id, id]);
    }
    if (t.status === 'done') {
      const reasons = canComplete(t, w.tasks);
      if (reasons.length) add(`gate-${t.id}`, 'critical', '完成状态缺少交付依据', `${t.title}：${reasons.join('；')}。`, [t.id]);
    }
  }
  for (const r of w.risks.filter(r => projectIds.has(r.projectId) && r.status !== 'closed')) {
    if (r.impact * r.likelihood >= 6) add(`risk-${r.id}`, r.status === 'open' ? 'critical' : 'warning', '高优先级 RAID 事项', `${r.title}，评分 ${r.impact * r.likelihood}/9；${r.mitigation || '尚未记录应对措施'}。`, [r.id, ...(r.taskId ? [r.taskId] : [])]);
    if (!r.owner.trim()) add(`risk-owner-${r.id}`, 'warning', 'RAID 事项缺少负责人', r.title, [r.id]);
  }
  const order = {critical: 0, warning: 1, info: 2};
  return findings.sort((a,b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
}

export function workspaceFingerprint(w: Workspace, projectId: string): string {
  // Array position is not a fact. Reports and reviewer metadata are outputs,
  // and measurements are currently not supplied to the briefing inputs.
  const sorted = <T extends {id:string}>(items:T[]) => [...items].sort((a,b)=>a.id.localeCompare(b.id));
  const payload = JSON.stringify({asOf: w.asOf, project: w.projects.find(p => p.id === projectId), tasks: sorted(w.tasks.filter(t => t.projectId === projectId)).map(t=>({...t,dependencies:[...t.dependencies].sort()})), risks: sorted(w.risks.filter(r => r.projectId === projectId))});
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {hash ^= payload.charCodeAt(i); hash = Math.imul(hash, 16777619);}
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function generateBrief(w: Workspace, projectId: string, lang: 'zh'|'en' = 'zh'): {text: string; sources: string[]} {
  const project = w.projects.find(p => p.id === projectId);
  if (!project) throw new Error('项目不存在');
  const tasks = w.tasks.filter(t => t.projectId === projectId), findings = analyze(w, projectId);
  const completed = tasks.filter(t => t.status === 'done' && canComplete(t, w.tasks).length === 0);
  const sources = [...new Set([projectId, ...tasks.map(t => t.id), ...findings.flatMap(f => f.sourceIds)])];
  const critical = findings.filter(f => f.severity === 'critical').length;
  const riskIds = w.risks.filter(r => r.projectId === projectId && r.status !== 'closed').map(r => r.id);
  sources.push(...riskIds.filter(id => !sources.includes(id)));
  const next = tasks.filter(t => t.status !== 'done').sort((a,b) => a.due.localeCompare(b.due)).slice(0,5);
  const englishSignal=(f:Finding):string=>{
    const sourceTask=w.tasks.find(t=>t.id===f.sourceIds[0]);
    const sourceRisk=w.risks.find(r=>r.id===f.sourceIds[0]);
    if(f.id.startsWith('budget-')) return `Budget exceeded: recorded spend is above the approved project budget.`;
    if(f.id.startsWith('overdue-')) return `Overdue: ${sourceTask?.title}; due ${sourceTask?.due}.`;
    if(f.id.startsWith('risk-owner-')||f.id.startsWith('owner-')) return 'Accountable owner is missing. Confirm responsibility before handover.';
    if(f.id.startsWith('risk-')) return `High-priority RAID record: ${sourceRisk?.title}; score ${(sourceRisk?.impact??0)*(sourceRisk?.likelihood??0)}/9. Review the recorded response and residual exposure.`;
    if(f.id.startsWith('waiting-')) return 'Predecessor is incomplete. Confirm the dependency before progressing the downstream task.';
    if(f.id.startsWith('blocked-')) return `Blocked delivery task: ${sourceTask?.title}. Agree a resolution owner and checkpoint.`;
    if(f.id.startsWith('gate-')) return 'Completion is not supported by all required fields. Review ownership, acceptance, evidence and predecessor gates.';
    if(f.id.startsWith('overlap-')) return 'Planned dates overlap a finish-to-start dependency. Reconcile the schedule or dependency type.';
    if(f.id.startsWith('missing-')) return 'Dependency reference is missing or belongs to another project.';
    if(f.id.startsWith('cycle-')) return 'Circular dependency detected. A valid critical path cannot be calculated.';
    if(f.id.startsWith('target-')) return `Target date ${project.target} has passed with unfinished tasks.`;
    return 'Invalid report or task date. Correct the source record before using the schedule.';
  };
  const text = lang === 'en' ? [
    `# ${project.name} — delivery briefing`,
    `As of ${w.asOf} · Deterministic rules draft · Human review required`,
    `\n## Delivery position\n${completed.length}/${tasks.length} tasks have a completed status and verified acceptance fields. Budget: HK$${project.budget.toLocaleString('en-HK')}; recorded spend: HK$${project.spent.toLocaleString('en-HK')}. Target: ${project.target}. [${project.id}]`,
    `\n## Control signals\n${critical} critical findings. These are rule-based flags, not an autonomous go-live decision.`,
    ...findings.slice(0,8).map(f => `- ${englishSignal(f)} [${f.sourceIds.join(', ')}]`),
    `\n## Next checkpoints`, ...next.map(t => `- ${t.title} — ${t.owner || 'Owner unassigned'} — due ${t.due} [${t.id}]`),
    `\n## Decisions requested\nReview flagged dependencies, confirm acceptance evidence and agree corrective actions with the accountable owner. This report does not claim that an invitation, plan or simulation is a delivered outcome.`,
  ].join('\n') : [
    `# ${project.name} · 交付简报`,
    `截至 ${w.asOf} · 规则生成草稿 · 待人工复核`,
    `\n## 交付情况\n${completed.length}/${tasks.length} 项任务的完成状态及验收字段有效。预算 HK$${project.budget.toLocaleString('en-HK')}；记录支出 HK$${project.spent.toLocaleString('en-HK')}。目标交付日 ${project.target}。[${project.id}]`,
    `\n## 管控信号\n发现 ${critical} 项严重信号。规则提示需由负责人判断，不能作为自动上线批准。`,
    ...findings.slice(0,8).map(f => `- ${f.title}：${f.detail} [${f.sourceIds.join(', ')}]`),
    '\n## 下一步检查点', ...next.map(t => `- ${t.title}｜${t.owner || '负责人待指定'}｜${t.due} [${t.id}]`),
    '\n## 待决策事项\n复核前置依赖、补齐验收依据，并与责任人确定纠正行动。计划、模拟数据和待确认结果不等同于实际交付成果。',
  ].join('\n');
  return {text, sources};
}

/** Fail closed on malformed backups; valid-but-inconsistent dependencies are
 * also rejected here, while analyze() still diagnoses edits made in the UI. */
export function validateWorkspace(value: unknown): Workspace {
  const fail = (path: string, message: string): never => {throw new Error(`${path}: ${message}`);};
  const obj = (v: unknown, path: string, keys: string[], optional: string[] = []): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, '应为对象');
    const r = v as Record<string,unknown>;
    for (const k of keys) if (!Object.hasOwn(r,k)) fail(`${path}.${k}`, '缺少字段');
    for (const k of Object.keys(r)) if (!keys.includes(k) && !optional.includes(k)) fail(`${path}.${k}`, '未知字段');
    return r;
  };
  const str = (v: unknown,p:string,max=2000,allowEmpty=true):string => typeof v === 'string' && v.length <= max && (allowEmpty || !!v.trim()) ? v : fail(p,`应为长度不超过 ${max} 的${allowEmpty ? '' : '非空'}字符串`);
  const id = (v:unknown,p:string) => {const s = str(v,p,80,false); return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s) ? s : fail(p,'ID 格式无效');};
  const date = (v:unknown,p:string):string => validDate(v) ? v as string : fail(p,'日期应为有效 YYYY-MM-DD');
  const bool = (v:unknown,p:string) => typeof v === 'boolean' ? v : fail(p,'应为布尔值');
  const num = (v:unknown,p:string,max=1e12,integer=false):number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && (!integer || Number.isInteger(v)) ? v : fail(p,'数值无效');
  const choice = <T extends string>(v:unknown,p:string,options:T[]):T => options.includes(v as T) ? v as T : fail(p,'选项无效');
  const arr = (v:unknown,p:string,max:number):unknown[] => Array.isArray(v) && v.length <= max ? v : fail(p,`应为最多 ${max} 项的数组`);
  const instant = (v:unknown,p:string) => {const s=str(v,p,40,false); return /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s)) ? s : fail(p,'时间戳无效');};
  const w=obj(value,'workspace',['version','asOf','projects','tasks','risks','measurements','briefs','audit'],['handovers','baselines','changes']);
  if (w.version !== 1) fail('workspace.version','不支持此版本');
  const out:Workspace={version:1,asOf:date(w.asOf,'asOf'),projects:[],tasks:[],risks:[],measurements:[],briefs:[],audit:[]};
  const used=new Set<string>();
  const unique=(v:unknown,p:string)=>{const s=id(v,p);if(used.has(s))fail(p,'ID 重复');used.add(s);return s;};
  for(const [i,v] of arr(w.projects,'projects',50).entries()) {const p=`projects[${i}]`,r=obj(v,p,['id','name','client','description','budget','spent','target','category']);out.projects.push({id:unique(r.id,p+'.id'),name:str(r.name,p+'.name',200,false),client:str(r.client,p+'.client',200),description:str(r.description,p+'.description',5000),budget:num(r.budget,p+'.budget'),spent:num(r.spent,p+'.spent'),target:date(r.target,p+'.target'),category:str(r.category,p+'.category',100)});}
  if(!out.projects.length)fail('projects','至少需要一个项目');
  const projectIds=new Set(out.projects.map(p=>p.id));
  const projectRef=(v:unknown,p:string)=>{const s=id(v,p);if(!projectIds.has(s))fail(p,'项目不存在');return s;};
  for(const [i,v] of arr(w.tasks,'tasks',2000).entries()){const p=`tasks[${i}]`,r=obj(v,p,['id','projectId','title','owner','vendor','status','priority','start','due','dependencies','acceptance','accepted','evidence']);const t:Task={id:unique(r.id,p+'.id'),projectId:projectRef(r.projectId,p+'.projectId'),title:str(r.title,p+'.title',500,false),owner:str(r.owner,p+'.owner',200),vendor:str(r.vendor,p+'.vendor',200),status:choice(r.status,p+'.status',['todo','active','blocked','review','done']),priority:choice(r.priority,p+'.priority',['low','medium','high']),start:date(r.start,p+'.start'),due:date(r.due,p+'.due'),dependencies:arr(r.dependencies,p+'.dependencies',100).map((d,j)=>id(d,`${p}.dependencies[${j}]`)),acceptance:str(r.acceptance,p+'.acceptance',5000),accepted:bool(r.accepted,p+'.accepted'),evidence:str(r.evidence,p+'.evidence',10000)};if(t.due<t.start)fail(p+'.due','截止日早于开始日');if(new Set(t.dependencies).size!==t.dependencies.length)fail(p+'.dependencies','依赖重复');out.tasks.push(t);}
  const taskById=new Map(out.tasks.map(t=>[t.id,t]));
  for(const t of out.tasks) for(const dep of t.dependencies) {if(!taskById.has(dep)||taskById.get(dep)!.projectId!==t.projectId)fail(`tasks.${t.id}.dependencies`,'依赖不存在或不属于本项目');}
  for(const p of out.projects)if(criticalPath(out.tasks.filter(t=>t.projectId===p.id)).cycle)fail(`projects.${p.id}`,'任务存在循环依赖');
  for(const [i,v] of arr(w.risks,'risks',2000).entries()){const p=`risks[${i}]`,r=obj(v,p,['id','projectId','title','type','owner','impact','likelihood','status','mitigation','taskId']);const impact=num(r.impact,p+'.impact',3,true),likelihood=num(r.likelihood,p+'.likelihood',3,true);if(impact<1||likelihood<1)fail(p,'风险评分应为 1–3');const projectId=projectRef(r.projectId,p+'.projectId'),taskId=str(r.taskId,p+'.taskId',80);if(taskId&&(!taskById.has(taskId)||taskById.get(taskId)!.projectId!==projectId))fail(p+'.taskId','任务引用无效');out.risks.push({id:unique(r.id,p+'.id'),projectId,title:str(r.title,p+'.title',500,false),type:choice(r.type,p+'.type',['risk','issue','assumption','dependency']),owner:str(r.owner,p+'.owner',200),impact:impact as 1|2|3,likelihood:likelihood as 1|2|3,status:choice(r.status,p+'.status',['open','mitigated','closed']),mitigation:str(r.mitigation,p+'.mitigation',5000),taskId});}
  for(const [i,v] of arr(w.measurements,'measurements',2000).entries()){const p=`measurements[${i}]`,r=obj(v,p,['id','projectId','label','before','after','beforeErrors','afterErrors','sampleSize','reviewer','date','provenance']);const sampleSize=num(r.sampleSize,p+'.sampleSize',1e6,true);if(sampleSize<1)fail(p+'.sampleSize','样本量至少为 1');out.measurements.push({id:unique(r.id,p+'.id'),projectId:projectRef(r.projectId,p+'.projectId'),label:str(r.label,p+'.label',500,false),before:num(r.before,p+'.before',1e6),after:num(r.after,p+'.after',1e6),beforeErrors:num(r.beforeErrors,p+'.beforeErrors',1e6,true),afterErrors:num(r.afterErrors,p+'.afterErrors',1e6,true),sampleSize,reviewer:str(r.reviewer,p+'.reviewer',200),date:date(r.date,p+'.date'),provenance:choice(r.provenance,p+'.provenance',['simulation','measured'])});}
  for(const [i,v] of arr(w.briefs,'briefs',500).entries()){const p=`briefs[${i}]`,r=obj(v,p,['id','projectId','createdAt','mode','text','sources','reviewed','reviewer','inputHash']);out.briefs.push({id:unique(r.id,p+'.id'),projectId:projectRef(r.projectId,p+'.projectId'),createdAt:instant(r.createdAt,p+'.createdAt'),mode:choice(r.mode,p+'.mode',['rules','ollama','openai']),text:str(r.text,p+'.text',50000),sources:arr(r.sources,p+'.sources',5000).map((s,j)=>id(s,`${p}.sources[${j}]`)),reviewed:bool(r.reviewed,p+'.reviewed'),reviewer:str(r.reviewer,p+'.reviewer',200),inputHash:str(r.inputHash,p+'.inputHash',100)});}
  for(const [i,v] of arr(w.audit,'audit',10000).entries()){const p=`audit[${i}]`,r=obj(v,p,['id','at','action','entityId','detail']);out.audit.push({id:unique(r.id,p+'.id'),at:instant(r.at,p+'.at'),action:str(r.action,p+'.action',200,false),entityId:str(r.entityId,p+'.entityId',200),detail:str(r.detail,p+'.detail',5000)});}
  if (w.handovers !== undefined) out.handovers = validateHandoverRecords(w.handovers,out);
  if (w.baselines !== undefined || w.changes !== undefined) Object.assign(out,validateProjectControls(w.baselines,w.changes,out,used));
  return out;
}
