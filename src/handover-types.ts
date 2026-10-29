import type { Workspace } from './types';

export type HandoverDocumentKind = 'tender'|'contract'|'statement_of_work'|'handover'|'other';
export type KnowledgeKind = 'policy'|'regulation'|'standard'|'best_practice'|'technical'|'industry';
export interface HandoverDocument { id:string; name:string; kind:HandoverDocumentKind; text:string; }
export interface HandoverContext { jurisdiction:string; industry:string; projectType:string; kickoffDate:string|null; }
export interface HandoverKnowledge { id:string; title:string; kind:KnowledgeKind; jurisdiction:string; url:string|null; version:string|null; checkedAt:string|null; text:string; }
export interface Citation { sourceId:string; quote:string; location:string; }
export interface SourceAudit {
  sha256:string; cleanedSha256:string; cleanedText:string; originalChars:number; cleanedChars:number;
  cleaning:{removedControlChars:number; normalizedLineEndings:number; removedBOM:boolean; duplicateLines:number};
  chunks:{location:string; start:number; end:number}[];
}
export type AuditedHandoverDocument = HandoverDocument & SourceAudit;
export type AuditedHandoverKnowledge = HandoverKnowledge & SourceAudit;
export interface ProposedTask { id:string; title:string; ownerRole:string|null; durationDays:number|null; dependencies:string[]; acceptance:string|null; sourceRefs:Citation[]; origin:'contract'|'recommendation'; rationale:string; }
export interface HandoverConfiguration {
  version:1;
  context:HandoverContext;
  project:{name:string|null; client:string|null; description:string|null; budget:number|null; currency:string|null; target:string|null; sourceRefs:Citation[]};
  requirements:{id:string; category:'party'|'scope'|'requirement'|'obligation'|'deliverable'|'acceptance'|'payment'|'deadline'|'risk'|'guidance'|'other'; text:string; citations:Citation[]}[];
  tasks:ProposedTask[];
  milestones:{id:string; title:string; date:string|null; taskIds:string[]; sourceRefs:Citation[]}[];
  risks:{id:string; title:string; mitigation:string; sourceRefs:Citation[]}[];
  conflicts:{id:string; topic:string; detail:string; sourceRefs:Citation[]}[];
  openQuestions:{id:string; question:string; sourceRefs:Citation[]}[];
  applicability:{sourceId:string; status:'applicable'|'potential'|'not_applicable'|'unknown'; reason:string}[];
  documents:AuditedHandoverDocument[];
  knowledge:AuditedHandoverKnowledge[];
  run:{provider:string; model:string; startedAt:string; generatedAt:string; durationMs:number; calls:number; retries:number; stages:{phase:'extract'|'synthesize'; sourceId?:string; location?:string; attempt:number; durationMs:number; status:'ok'|'retry'}[]; reviewRequired:true; notices?:string[]};
}
export interface HandoverReview {
  confirmed:boolean; reviewer:string; kickoff:string; target?:string; targetOverrideReason?:string; projectName?:string; projectClient?:string; policyReviewConfirmed?:boolean;
  budgetHKD?:number; budgetConversionNote?:string;
  selectedTaskIds?:string[]; includeRecommendations?:boolean;
  taskDurations?:Record<string,number>; defaultDurationDays?:number; taskOwners?:Record<string,string>;
  taskEdits?:Record<string,{acceptance:string;dependencies:string[];reason:string}>;
  conflictResolutions?:Record<string,string>; questionResponses?:Record<string,string>;
  milestoneOverrides?:Record<string,{date:string; reason:string}>;
  riskRatings?:Record<string,{impact:1|2|3; likelihood:1|2|3; owner?:string}>;
  initialRiskRating?:{impact:1|2|3; likelihood:1|2|3};
}
export interface HandoverRecord { id:string; projectId:string; createdAt:string; reviewer:string; configuration:HandoverConfiguration; review:HandoverReview; taskIdMap:Record<string,string>; }
export type ExtendedWorkspace = Workspace & {handovers?:HandoverRecord[]};

// These guards also validate archived proposals on workspace JSON import. They
// are intentionally independent of the engine, which may import this module.
const bad = (path:string, message:string):never => {throw new Error(`${path}: ${message}`);};
const object = (value:unknown, path:string, required:string[], optional:string[]=[]) => {
  if (!value || typeof value!=='object' || Array.isArray(value)) return bad(path,'应为对象');
  const r=value as Record<string,unknown>;
  for(const k of required) if(!Object.hasOwn(r,k)) bad(`${path}.${k}`,'缺少字段');
  for(const k of Object.keys(r)) if(!required.includes(k)&&!optional.includes(k)) bad(`${path}.${k}`,'未知字段');
  return r;
};
const str=(v:unknown,p:string,max=5000,empty=false):string=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim())?v:bad(p,'字符串无效或超过长度限制');
const arr=(v:unknown,p:string,max=200):unknown[]=>Array.isArray(v)&&v.length<=max?v:bad(p,'数组无效或超过条数限制');
const num=(v:unknown,p:string,max=1e12,min=0,integer=false):number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&(!integer||Number.isInteger(v))?v:bad(p,'数值无效');
const bool=(v:unknown,p:string):boolean=>typeof v==='boolean'?v:bad(p,'应为布尔值');
const id=(v:unknown,p:string):string=>{const s=str(v,p,100);return /^[\p{L}\p{N}_.:-]+$/u.test(s)&&!['__proto__','constructor','prototype'].includes(s)?s:bad(p,'ID 无效');};
const choice=(v:unknown,p:string,values:string[])=>values.includes(v as string)?v as string:bad(p,'选项无效');
export const isHandoverDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
const date=(v:unknown,p:string):string=>isHandoverDate(v)?v:bad(p,'必须是有效 YYYY-MM-DD 日期');
const instant=(v:unknown,p:string)=>{const s=str(v,p,40);return /^\d{4}-\d{2}-\d{2}T/.test(s)&&isHandoverDate(s.slice(0,10))&&Number.isFinite(Date.parse(s))?s:bad(p,'时间戳无效');};
const nullable=(v:unknown,p:string,check:(v:unknown,p:string)=>unknown)=>v===null?null:check(v,p);
const ids=(v:unknown,p:string,max=200)=>{const a=arr(v,p,max).map((x,i)=>id(x,`${p}[${i}]`));if(new Set(a).size!==a.length)bad(p,'ID 重复');return a;};
const nonEmptyMap=(v:unknown,p:string,validate:(v:unknown,p:string)=>void)=>{
  const r=object(v,p,[],v&&typeof v==='object'?Object.keys(v):[]);
  if(Object.keys(r).length>200)bad(p,'条数超过 200');
  for(const [k,x] of Object.entries(r)){id(k,`${p}.key`);validate(x,`${p}.${k}`);}return r;
};

export function validateHandoverConfiguration(value:unknown):HandoverConfiguration {
  const r=object(value,'handover',['version','context','project','requirements','tasks','milestones','risks','conflicts','openQuestions','applicability','documents','knowledge','run']);
  if(r.version!==1)bad('handover.version','不支持的版本');
  const context=object(r.context,'context',['jurisdiction','industry','projectType','kickoffDate']);
  for(const k of ['jurisdiction','industry','projectType'])str(context[k],`context.${k}`,300,true);
  nullable(context.kickoffDate,'context.kickoffDate',date);
  const sources=new Map<string,{text:string;chunks:{location:string;start:number;end:number}[]}>();
  const auditKeys=['sha256','cleanedSha256','cleanedText','originalChars','cleanedChars','cleaning','chunks'];
  const source=(v:unknown,p:string,knowledge=false)=>{
    const x=object(v,p,knowledge?['id','title','kind','jurisdiction','url','version','checkedAt','text',...auditKeys]:['id','name','kind','text',...auditKeys]);
    const key=id(x.id,`${p}.id`);if(sources.has(key))bad(p,'来源 ID 重复');
    str(x[knowledge?'title':'name'],`${p}.name`,500);
    choice(x.kind,`${p}.kind`,knowledge?['policy','regulation','standard','best_practice','technical','industry']:['tender','contract','statement_of_work','handover','other']);
    const text=str(x.text,`${p}.text`,knowledge?12000:100000);
    const cleaned=str(x.cleanedText,`${p}.cleanedText`,knowledge?12000:100000);
    if(knowledge){str(x.jurisdiction,`${p}.jurisdiction`,300,true);nullable(x.version,`${p}.version`,(a,b)=>str(a,b,300,true));nullable(x.checkedAt,`${p}.checkedAt`,date);nullable(x.url,`${p}.url`,(a,b)=>{const u=str(a,b,2000);try{if(!['https:','http:'].includes(new URL(u).protocol))bad(b,'仅允许 HTTP(S) URL');}catch{bad(b,'URL 无效');}return u;});}
    for(const k of ['sha256','cleanedSha256'])if(!/^[a-f0-9]{64}$/i.test(str(x[k],`${p}.${k}`,64)))bad(p,'SHA-256 格式无效');
    if(num(x.originalChars,`${p}.originalChars`,100000,1,true)!==text.length||num(x.cleanedChars,`${p}.cleanedChars`,100000,1,true)!==cleaned.length)bad(p,'文本长度与审计信息不一致');
    const cleaning=object(x.cleaning,`${p}.cleaning`,['removedControlChars','normalizedLineEndings','removedBOM','duplicateLines']);
    for(const k of ['removedControlChars','normalizedLineEndings','duplicateLines'])num(cleaning[k],`${p}.cleaning.${k}`,100000,0,true);bool(cleaning.removedBOM,`${p}.cleaning.removedBOM`);
    let reconstructed=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    const removedControls=(reconstructed.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g)||[]).length;
    reconstructed=reconstructed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');
    const lines=reconstructed.split('\n').map(line=>line.trim()).filter(Boolean);
    if(reconstructed!==cleaned||cleaning.removedBOM!==text.startsWith('\uFEFF')||cleaning.normalizedLineEndings!==(text.match(/\r\n?/g)||[]).length||cleaning.removedControlChars!==removedControls||cleaning.duplicateLines!==lines.length-new Set(lines).size)bad(p,'清洗文本或处理记录与原文不一致');
    const locations=new Set<string>();
    const chunks=arr(x.chunks,`${p}.chunks`,1000).map((cv,i)=>{const cp=`${p}.chunks[${i}]`,c=object(cv,cp,['location','start','end']);const location=str(c.location,`${cp}.location`,200);const start=num(c.start,`${cp}.start`,cleaned.length,0,true),end=num(c.end,`${cp}.end`,cleaned.length,1,true);if(end<=start||!location.startsWith(`${key}#chunk-`)||locations.has(location))bad(cp,'文本分段无效');locations.add(location);return{location,start,end};});
    if(!chunks.length)bad(p,'缺少文本分段');
    if(chunks.some((chunk,i)=>chunk.start!==(i?chunks[i-1].end:0))||chunks.at(-1)!.end!==cleaned.length)bad(p,'文本分段必须连续覆盖全部清洗文本');
    sources.set(key,{text:cleaned,chunks});return text.length;
  };
  const docs=arr(r.documents,'documents',12);if(!docs.length)bad('documents','至少需要一份资料');
  if(docs.reduce<number>((n,d,i)=>n+source(d,`documents[${i}]`),0)>100000)bad('documents','总文本超过 100000 字符');
  if(arr(r.knowledge,'knowledge',20).reduce<number>((n,d,i)=>n+source(d,`knowledge[${i}]`,true),0)>40000)bad('knowledge','总文本超过 40000 字符');
  const citations=(v:unknown,p:string,required=false)=>{const list=arr(v,p,50);if(required&&!list.length)bad(p,'合同要求必须有原文引用');for(const [i,cv] of list.entries()){const cp=`${p}[${i}]`,c=object(cv,cp,['sourceId','quote','location']),sid=id(c.sourceId,`${cp}.sourceId`),quote=str(c.quote,`${cp}.quote`,5000),location=str(c.location,`${cp}.location`,200),s=sources.get(sid);if(!s)bad(cp,'引用来源不存在');const chunk=s!.chunks.find(x=>x.location===location);if(!chunk||!s!.text.slice(chunk.start,chunk.end).includes(quote))bad(cp,'引用未出现在指定原文分段');}};
  const project=object(r.project,'project',['name','client','description','budget','currency','target','sourceRefs']);
  nullable(project.name,'project.name',(a,b)=>str(a,b,240));nullable(project.client,'project.client',(a,b)=>str(a,b,240));nullable(project.description,'project.description',(a,b)=>str(a,b,5000));nullable(project.budget,'project.budget',num);nullable(project.currency,'project.currency',(a,b)=>str(a,b,20));nullable(project.target,'project.target',date);citations(project.sourceRefs,'project.sourceRefs');
  const used=new Set<string>();const unique=(v:unknown,p:string)=>{const s=id(v,p),key=`${p.split('[')[0]}:${s}`;if(used.has(key))bad(p,'ID 重复');used.add(key);return s;};
  arr(r.requirements,'requirements',5000).forEach((v,i)=>{const p=`requirements[${i}]`,x=object(v,p,['id','category','text','citations']);unique(x.id,p+'.id');choice(x.category,p+'.category',['party','scope','requirement','obligation','deliverable','acceptance','payment','deadline','risk','guidance','other']);str(x.text,p+'.text');citations(x.citations,p+'.citations',true);});
  const tasks=arr(r.tasks,'tasks',200).map((v,i)=>{const p=`tasks[${i}]`,x=object(v,p,['id','title','ownerRole','durationDays','dependencies','acceptance','sourceRefs','origin','rationale']);const key=unique(x.id,p+'.id');str(x.title,p+'.title',480);nullable(x.ownerRole,p+'.ownerRole',(a,b)=>str(a,b,200));nullable(x.durationDays,p+'.durationDays',(a,b)=>num(a,b,3650,1,true));const deps=ids(x.dependencies,p+'.dependencies',100);nullable(x.acceptance,p+'.acceptance',(a,b)=>str(a,b,5000));choice(x.origin,p+'.origin',['contract','recommendation']);str(x.rationale,p+'.rationale',5000,true);citations(x.sourceRefs,p+'.sourceRefs',x.origin==='contract');return{id:key,dependencies:deps};});
  const taskIds=new Set(tasks.map(t=>t.id));
  for(const task of tasks)for(const dep of task.dependencies)if(!taskIds.has(dep)||dep===task.id)bad(`tasks.${task.id}.dependencies`,'依赖不存在或自引用');
  const visited=new Set<string>(),visiting=new Set<string>(),taskById=new Map(tasks.map(t=>[t.id,t]));
  const visit=(key:string)=>{if(visiting.has(key))bad('tasks','存在循环依赖');if(visited.has(key))return;visiting.add(key);for(const dep of taskById.get(key)!.dependencies)visit(dep);visiting.delete(key);visited.add(key);};tasks.forEach(t=>visit(t.id));
  arr(r.milestones,'milestones',100).forEach((v,i)=>{const p=`milestones[${i}]`,x=object(v,p,['id','title','date','taskIds','sourceRefs']);unique(x.id,p+'.id');str(x.title,p+'.title',500);nullable(x.date,p+'.date',date);for(const taskId of ids(x.taskIds,p+'.taskIds'))if(!taskIds.has(taskId))bad(p,'里程碑任务不存在');citations(x.sourceRefs,p+'.sourceRefs');});
  arr(r.risks,'risks',100).forEach((v,i)=>{const p=`risks[${i}]`,x=object(v,p,['id','title','mitigation','sourceRefs']);unique(x.id,p+'.id');str(x.title,p+'.title',500);str(x.mitigation,p+'.mitigation',5000,true);citations(x.sourceRefs,p+'.sourceRefs');});
  arr(r.conflicts,'conflicts',100).forEach((v,i)=>{const p=`conflicts[${i}]`,x=object(v,p,['id','topic','detail','sourceRefs']);unique(x.id,p+'.id');str(x.topic,p+'.topic',500);str(x.detail,p+'.detail');citations(x.sourceRefs,p+'.sourceRefs',true);});
  arr(r.openQuestions,'openQuestions',200).forEach((v,i)=>{const p=`openQuestions[${i}]`,x=object(v,p,['id','question','sourceRefs']);unique(x.id,p+'.id');str(x.question,p+'.question');citations(x.sourceRefs,p+'.sourceRefs');});
  const knowledgeIds=new Set((r.knowledge as {id:string}[]).map(k=>k.id)),applicable=new Set<string>();
  arr(r.applicability,'applicability',20).forEach((v,i)=>{const p=`applicability[${i}]`,x=object(v,p,['sourceId','status','reason']),sid=id(x.sourceId,p+'.sourceId');if(!knowledgeIds.has(sid)||applicable.has(sid))bad(p,'知识来源不存在或重复');applicable.add(sid);choice(x.status,p+'.status',['applicable','potential','not_applicable','unknown']);str(x.reason,p+'.reason');});
  if(applicable.size!==knowledgeIds.size)bad('applicability','每条知识必须有适用性说明');
  const run=object(r.run,'run',['provider','model','startedAt','generatedAt','durationMs','calls','retries','stages','reviewRequired'],['notices']);str(run.provider,'run.provider',100);str(run.model,'run.model',200);instant(run.startedAt,'run.startedAt');instant(run.generatedAt,'run.generatedAt');num(run.durationMs,'run.durationMs',1e9);num(run.calls,'run.calls',10000,0,true);num(run.retries,'run.retries',10000,0,true);if(run.reviewRequired!==true)bad('run.reviewRequired','必须待人工审核');
  arr(run.stages,'run.stages',1000).forEach((v,i)=>{const p=`run.stages[${i}]`,x=object(v,p,['phase','attempt','durationMs','status'],['sourceId','location']);choice(x.phase,p+'.phase',['extract','synthesize']);num(x.attempt,p+'.attempt',10,1,true);num(x.durationMs,p+'.durationMs',1e9);choice(x.status,p+'.status',['ok','retry']);if(x.sourceId!==undefined&&!sources.has(id(x.sourceId,p+'.sourceId')))bad(p,'阶段来源不存在');if(x.location!==undefined)str(x.location,p+'.location',200);});
  if(run.notices!==undefined)arr(run.notices,'run.notices',100).forEach((v,i)=>str(v,`run.notices[${i}]`));
  return JSON.parse(JSON.stringify(r)) as HandoverConfiguration;
}

export function validateHandoverReview(value:unknown):HandoverReview {
  const r=object(value,'review',['confirmed','reviewer','kickoff'],['target','targetOverrideReason','projectName','projectClient','policyReviewConfirmed','budgetHKD','budgetConversionNote','selectedTaskIds','includeRecommendations','taskDurations','defaultDurationDays','taskOwners','taskEdits','conflictResolutions','questionResponses','milestoneOverrides','riskRatings','initialRiskRating']);
  bool(r.confirmed,'review.confirmed');str(r.reviewer,'review.reviewer',200);date(r.kickoff,'review.kickoff');
  for(const k of ['targetOverrideReason','budgetConversionNote'])if(r[k]!==undefined)str(r[k],`review.${k}`,5000,true);
  if(r.projectName!==undefined)str(r.projectName,'review.projectName',200);
  if(r.projectClient!==undefined)str(r.projectClient,'review.projectClient',200,true);
  if(r.policyReviewConfirmed!==undefined)bool(r.policyReviewConfirmed,'review.policyReviewConfirmed');
  if(r.target!==undefined)date(r.target,'review.target');
  if(r.budgetHKD!==undefined)num(r.budgetHKD,'review.budgetHKD');
  if(r.selectedTaskIds!==undefined)ids(r.selectedTaskIds,'review.selectedTaskIds');
  if(r.includeRecommendations!==undefined)bool(r.includeRecommendations,'review.includeRecommendations');
  if(r.defaultDurationDays!==undefined)num(r.defaultDurationDays,'review.defaultDurationDays',3650,1,true);
  if(r.taskDurations!==undefined)nonEmptyMap(r.taskDurations,'review.taskDurations',(v,p)=>{num(v,p,3650,1,true);});
  if(r.taskEdits!==undefined)nonEmptyMap(r.taskEdits,'review.taskEdits',(v,p)=>{const x=object(v,p,['acceptance','dependencies','reason']);str(x.acceptance,p+'.acceptance',5000,true);ids(x.dependencies,p+'.dependencies',100);str(x.reason,p+'.reason',5000);});
  for(const k of ['taskOwners','conflictResolutions','questionResponses'])if(r[k]!==undefined)nonEmptyMap(r[k],`review.${k}`,(v,p)=>{str(v,p,k==='taskOwners'?200:5000,k==='taskOwners');});
  if(r.milestoneOverrides!==undefined)nonEmptyMap(r.milestoneOverrides,'review.milestoneOverrides',(v,p)=>{const x=object(v,p,['date','reason']);date(x.date,p+'.date');str(x.reason,p+'.reason');});
  const rating=(v:unknown,p:string,allowOwner=false)=>{const x=object(v,p,['impact','likelihood'],allowOwner?['owner']:[]);num(x.impact,p+'.impact',3,1,true);num(x.likelihood,p+'.likelihood',3,1,true);if(x.owner!==undefined)str(x.owner,p+'.owner',200,true);};
  if(r.riskRatings!==undefined)nonEmptyMap(r.riskRatings,'review.riskRatings',(v,p)=>rating(v,p,true));
  if(r.initialRiskRating!==undefined)rating(r.initialRiskRating,'review.initialRiskRating');
  return JSON.parse(JSON.stringify(r)) as HandoverReview;
}

/** Derive an editable planning graph without changing the archived proposal. */
export function reviewedHandoverTasks(configuration:HandoverConfiguration,review:HandoverReview):ProposedTask[] {
  const originalIds=new Set(configuration.tasks.map(t=>t.id));
  for(const taskId of Object.keys(review.taskEdits??{}))if(!originalIds.has(taskId))bad(`review.taskEdits.${taskId}`,'编辑任务不属于本次配置');
  const tasks=configuration.tasks.map(task=>{const edit=review.taskEdits?.[task.id];return{...task,dependencies:[...(edit?.dependencies??task.dependencies)],acceptance:edit?edit.acceptance:task.acceptance};});
  const byId=new Map(tasks.map(t=>[t.id,t])),visited=new Set<string>(),visiting=new Set<string>();
  for(const task of tasks)for(const dependency of task.dependencies){
    if(!originalIds.has(dependency))bad(`review.taskEdits.${task.id}.dependencies`,'依赖不存在或不属于本次配置，不能引用其他项目的任务');
    if(dependency===task.id)bad(`review.taskEdits.${task.id}.dependencies`,'任务不能依赖自身');
  }
  const visit=(taskId:string)=>{if(visiting.has(taskId))bad('review.taskEdits','编辑后的任务存在循环依赖');if(visited.has(taskId))return;visiting.add(taskId);for(const dependency of byId.get(taskId)!.dependencies)visit(dependency);visiting.delete(taskId);visited.add(taskId);};
  tasks.forEach(task=>visit(task.id));return tasks;
}

export function validateHandoverRecords(value:unknown,workspace:Pick<Workspace,'projects'|'tasks'>):HandoverRecord[] {
  const seen=new Set<string>();
  return arr(value,'handovers',50).map((v,i)=>{const p=`handovers[${i}]`,r=object(v,p,['id','projectId','createdAt','reviewer','configuration','review','taskIdMap']),key=id(r.id,p+'.id'),projectId=id(r.projectId,p+'.projectId');if(seen.has(key))bad(p,'归档 ID 重复');seen.add(key);if(!workspace.projects.some(x=>x.id===projectId))bad(p,'归档项目不存在');instant(r.createdAt,p+'.createdAt');str(r.reviewer,p+'.reviewer',200);const config=validateHandoverConfiguration(r.configuration),review=validateHandoverReview(r.review);if(!review.confirmed||review.reviewer!==r.reviewer)bad(p,'归档缺少一致的人工确认');
    reviewedHandoverTasks(config,review);
    const keys=new Set(config.tasks.map(t=>t.id)),mapped=new Set<string>();nonEmptyMap(r.taskIdMap,p+'.taskIdMap',(v,mp)=>{const mappedId=id(v,mp),current=workspace.tasks.find(t=>t.id===mappedId);if(mapped.has(mappedId)||(current&&current.projectId!==projectId))bad(mp,'导入任务映射无效');mapped.add(mappedId);});for(const sourceId of Object.keys(r.taskIdMap as object))if(!keys.has(sourceId))bad(p,'原任务映射不存在');
    return JSON.parse(JSON.stringify({...r,configuration:config,review})) as HandoverRecord;
  });
}
