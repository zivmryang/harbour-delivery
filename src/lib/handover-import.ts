import type { Project, Risk, Task, Workspace } from '../types';
import {
  isHandoverDate, reviewedHandoverTasks, validateHandoverConfiguration, validateHandoverRecords, validateHandoverReview,
  type ExtendedWorkspace, type HandoverConfiguration, type HandoverDocument, type HandoverDocumentKind,
  type HandoverRecord, type HandoverReview,
} from '../handover-types';
import { validateWorkspace } from './engine';

export const HANDOVER_FILE_LIMIT = 10 * 1024 * 1024;
export const HANDOVER_TOTAL_LIMIT = 30 * 1024 * 1024;
export const HANDOVER_TEXT_LIMIT = 100000;
const documentKinds:HandoverDocumentKind[]=['tender','contract','statement_of_work','handover','other'];
const extensions=['txt','md','csv','docx','pdf'];
function error(message:string):never {throw new Error(message);}
const stamp=()=>crypto.randomUUID().replaceAll('-','').slice(0,16);

function checkFiles(files:readonly File[]) {
  if(!files.length||files.length>12)error('请选择 1–12 份项目资料。');
  if(files.reduce((sum,file)=>sum+file.size,0)>HANDOVER_TOTAL_LIMIT)error('资料总大小不可超过 30 MB。');
  for(const file of files){
    if(!file.name.trim()||file.name.length>240)error('文件名必须为 1–240 个字符，请缩短文件名后重试。');
    if(file.size>HANDOVER_FILE_LIMIT)error(`${file.name} 超过单文件 10 MB 限制。`);
    if(!file.size)error(`${file.name} 是空文件。`);
    const extension=file.name.split('.').pop()?.toLowerCase()??'';
    if(!extensions.includes(extension))error(`${file.name} 格式不支持；请选择 TXT、MD、CSV、DOCX 或 PDF。`);
  }
}

function paragraphs(text:string):string {
  const parts=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n[\t ]*\n+/).map(p=>p.trim()).filter(Boolean);
  if(!parts.length)error('文档没有可读取的文本；图片或扫描资料请先进行 OCR。');
  return parts.map((p,i)=>`【PARA ${i+1}】\n${p}`).join('\n\n');
}

function decodeText(buffer:ArrayBuffer):string {
  const bytes=new Uint8Array(buffer);
  const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{return error('文本编码无法读取，请另存为 UTF-8 或带 BOM 的 UTF-16 文件。');}
}

/** Preserve CSV cell boundaries and quoted line breaks; this is source text, not task synchronization. */
function csvText(text:string):string {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const normalized=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const endCell=()=>{row.push(cell);cell='';closed=false;};
  const endRow=()=>{endCell();if(row.some(v=>v.trim()))rows.push(row);row=[];};
  for(let i=0;i<normalized.length;i++){
    const char=normalized[i];
    if(quoted){if(char==='"'){if(normalized[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;continue;}
    if(closed&&char!==','&&char!=='\n')error('CSV 引号后有无效字符，请导出标准 CSV 文件。');
    if(char==='"'){if(cell.length)error('CSV 引号位置无效。');quoted=true;}
    else if(char===',')endCell();else if(char==='\n')endRow();else cell+=char;
  }
  if(quoted)error('CSV 存在未闭合的引号。');
  if(cell||row.length||closed)endRow();
  if(!rows.length)error('CSV 没有非空文本。');
  return rows.map((cells,i)=>`【ROW ${i+1}】\n${cells.map((v,j)=>`列 ${j+1}: ${JSON.stringify(v)}`).join('\n')}`).join('\n\n');
}

async function pdfText(buffer:ArrayBuffer):Promise<string> {
  // The legacy build includes compatibility polyfills needed by Node 22 and
  // browsers without newer Promise APIs. Keep its worker on the same build.
  const [pdfjs,worker]=await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const loading=pdfjs.getDocument({data:new Uint8Array(buffer),useWorkerFetch:false,disableFontFace:true,stopAtErrors:true});
  try{
    const document=await loading.promise;
    if(document.numPages>200)error('PDF 超过 200 页，请拆分相关章节。');
    const pages:string[]=[];let chars=0;
    for(let pageNo=1;pageNo<=document.numPages;pageNo++){
      const page=await document.getPage(pageNo),content=await page.getTextContent();
      let text='',previousY:number|undefined;
      for(const item of content.items){
        if(!('str' in item))continue;
        const y=item.transform?.[5];
        if(previousY!==undefined&&typeof y==='number'&&Math.abs(y-previousY)>2&&!text.endsWith('\n'))text+='\n';
        text+=item.str;
        if(item.hasEOL)text+='\n';else if(item.str&&!/\s$/.test(item.str))text+=' ';
        previousY=y;
      }
      if(!text.trim())error(`PDF 第 ${pageNo} 页没有可提取文本，可能是扫描页或空白页。请先 OCR，或确认并移除空白页后重试；不会静默略过。`);
      const marked=`【PAGE ${pageNo}】\n${paragraphs(text)}`;
      chars+=marked.length;if(chars>HANDOVER_TEXT_LIMIT)error('PDF 文本超过 100000 字符，请拆分相关章节。');
      pages.push(marked);page.cleanup();
    }
    return pages.join('\n\n');
  }catch(e){
    if(e instanceof Error&&e.name==='PasswordException')error('PDF 需要密码，请先在本地解密后导入。');
    throw e;
  }finally{await loading.destroy();}
}

export async function parseHandoverFile(file:File,options:{kind?:HandoverDocumentKind;id?:string}={}):Promise<HandoverDocument> {
  checkFiles([file]);
  const kind=options.kind??'other';if(!documentKinds.includes(kind))error('资料类别无效。');
  const id=options.id??`DOC-${stamp()}`;
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)||['__proto__','constructor','prototype'].includes(id))error('资料 ID 无效。');
  const buffer=await file.arrayBuffer(),extension=file.name.split('.').pop()!.toLowerCase();let text:string;
  if(extension==='pdf')text=await pdfText(buffer);
  else if(extension==='docx'){
    const mammoth=await import('mammoth');
    const result=await mammoth.extractRawText({arrayBuffer:buffer});text=paragraphs(result.value);
  }else{const decoded=decodeText(buffer);text=extension==='csv'?csvText(decoded):paragraphs(decoded);}
  if(text.length>HANDOVER_TEXT_LIMIT)error(`${file.name} 文本超过 100000 字符，请拆分相关章节。`);
  return{id,name:file.name,kind,text};
}

export async function parseHandoverFiles(files:readonly File[],kinds?:readonly HandoverDocumentKind[]):Promise<HandoverDocument[]> {
  checkFiles(files);if(kinds&&kinds.length!==files.length)error('资料类别数量与文件数量不一致。');
  const documents:HandoverDocument[]=[];let chars=0;
  // Serial extraction bounds browser memory for large PDF/DOCX inputs.
  for(let i=0;i<files.length;i++){
    const document=await parseHandoverFile(files[i],{kind:kinds?.[i]});chars+=document.text.length;
    if(chars>HANDOVER_TEXT_LIMIT)error('项目资料合计超过 100000 字符，请只保留相关章节。');documents.push(document);
  }
  return documents;
}

const day=(iso:string)=>Date.parse(`${iso}T00:00:00Z`)/86400000;
const iso=(days:number)=>new Date(days*86400000).toISOString().slice(0,10);

/** Creates a new project after explicit review. Nothing in the existing workspace is modified. */
export function reviewConfigurationToWorkspace(result:HandoverConfiguration,choices:HandoverReview,existingWorkspace:Workspace):ExtendedWorkspace {
  const configuration=validateHandoverConfiguration(result),review=validateHandoverReview(choices);
  if(!review.confirmed)error('必须由审核人明确确认配置后才能创建项目。');
  if(configuration.knowledge.length&&!review.policyReviewConfirmed)error('必须人工确认知识及法规候选的适用性；候选资料不自动成为合同义务。');
  const documentIds=new Set(configuration.documents.map(d=>d.id));
  for(const task of configuration.tasks)if(task.origin==='contract'&&!task.sourceRefs.some(c=>documentIds.has(c.sourceId)))error(`任务 ${task.id} 仅引用知识资料，不能标记为合同义务。`);
  for(const conflict of configuration.conflicts)if(!review.conflictResolutions?.[conflict.id]?.trim())error(`冲突 ${conflict.id} 尚未人工解决：${conflict.topic}`);
  const name=review.projectName??configuration.project.name;if(!name?.trim())error('项目名称缺失，请人工输入。');
  const client=review.projectClient??configuration.project.client??'';
  if(name.length>200||client.length>200)error('项目或客户名称超过 200 字符，请人工缩短展示名称；原文保留在归档。');
  const target=review.target??configuration.project.target;
  if(!target||!isHandoverDate(target))error('目标日期缺失或无效，请人工输入有效日期。');
  if(target<review.kickoff)error('目标日期不可早于启动日期。');
  if(configuration.project.target&&target!==configuration.project.target&&!review.targetOverrideReason?.trim())error('目标日期与原始资料不同，必须记录调整理由。');
  const currency=configuration.project.currency?.trim().toUpperCase();
  const hkd=['HKD','HK$'].includes(currency??'');
  let budget:number;
  if(review.budgetHKD!==undefined){
    if((!hkd||configuration.project.budget===null||review.budgetHKD!==configuration.project.budget)&&!review.budgetConversionNote?.trim())error('请记录人工确定港币预算的依据及原币种；系统不会自动换汇。');
    budget=review.budgetHKD;
  }else if(hkd&&configuration.project.budget!==null)budget=configuration.project.budget;
  else error('预算或币种未明确为 HKD，请输入人工确认的港币预算及说明；不会默认填零或自动换汇。');
  const editedTasks=reviewedHandoverTasks(configuration,review);
  const selectedIds=review.selectedTaskIds??editedTasks.filter(t=>t.origin==='contract'||review.includeRecommendations).map(t=>t.id);
  const byId=new Map(editedTasks.map(t=>[t.id,t]));
  if(!selectedIds.length)error('至少选择一项任务。');
  for(const key of selectedIds){const task=byId.get(key);if(!task)error(`所选任务 ${key} 不存在。`);if(task!.origin==='recommendation'&&!review.includeRecommendations)error('实施建议必须另行明确选择纳入计划。');}
  const selected=new Set(selectedIds);
  for(const key of selectedIds)for(const dep of byId.get(key)!.dependencies)if(!selected.has(dep))error(`任务 ${key} 的依赖 ${dep} 未被选中。${byId.get(dep)?.origin==='recommendation'?'此依赖是实施建议；请明确勾选纳入建议后再审核，不能静默删除依赖。':'请一并选择前置任务，不能静默删除依赖。'}`);
  const verifyKeys=(map:Record<string,unknown>|undefined,keys:Set<string>,label:string)=>{for(const key of Object.keys(map??{}))if(!keys.has(key))error(`${label} 引用不存在的 ID：${key}`);};
  const allTasks=new Set(byId.keys());verifyKeys(review.taskDurations,allTasks,'工期');verifyKeys(review.taskOwners,allTasks,'责任人');
  verifyKeys(review.conflictResolutions,new Set(configuration.conflicts.map(c=>c.id)),'冲突解决');verifyKeys(review.questionResponses,new Set(configuration.openQuestions.map(q=>q.id)),'问题答复');verifyKeys(review.milestoneOverrides,new Set(configuration.milestones.map(m=>m.id)),'里程碑调整');verifyKeys(review.riskRatings,new Set(configuration.risks.map(r=>r.id)),'风险评分');
  const token=stamp(),projectId=`HO-${token}`,recordId=`HANDOVER-${token}`,taskIdMap:Record<string,string>={};
  selectedIds.forEach((key,i)=>{taskIdMap[key]=`${projectId}-T${i+1}`;});
  const scheduled=new Map<string,Task>();
  const schedule=(key:string):Task=>{
    const prior=scheduled.get(key);if(prior)return prior;
    const proposed=byId.get(key)!;
    const duration=review.taskDurations?.[key]??proposed.durationDays??review.defaultDurationDays;
    if(duration===undefined||duration===null)error(`任务 ${key} 工期未知，请人工输入工期或统一估算。`);
    const dependencies=proposed.dependencies.map(schedule),start=Math.max(day(review.kickoff),...dependencies.map(t=>day(t.due)+1)),due=start+duration!-1;
    if(due>day(target))error(`任务 ${key} 的排期超出目标日期，请调整工期、依赖或有依据地调整目标。`);
    const task:Task={id:taskIdMap[key],projectId,title:`${proposed.origin==='recommendation'?'[实施建议] ':''}${proposed.title}`,owner:review.taskOwners?.[key]??'',vendor:'',status:'todo',priority:'medium',start:iso(start),due:iso(due),dependencies:proposed.dependencies.map(id=>taskIdMap[id]),acceptance:proposed.acceptance??'',accepted:false,evidence:''};
    scheduled.set(key,task);return task;
  };
  const tasks=selectedIds.map(schedule);
  for(const milestone of configuration.milestones){
    const deadline=review.milestoneOverrides?.[milestone.id]?.date??milestone.date;
    if(deadline&&deadline<review.kickoff&&milestone.taskIds.some(id=>selected.has(id)))error(`里程碑 ${milestone.id} 早于启动日期，请明确解决原文日期冲突。`);
    if(deadline&&milestone.taskIds.some(id=>scheduled.has(id)&&scheduled.get(id)!.due>deadline))error(`排期超出里程碑 ${milestone.id} 的日期 ${deadline}，请调整排期或记录里程碑调整及理由。`);
  }
  const risks:Risk[]=configuration.risks.map((risk,i)=>{
    const rating=review.riskRatings?.[risk.id]??review.initialRiskRating;
    if(!rating)error(`风险 ${risk.id} 尚未人工评分。`);
    return{id:`${projectId}-R${i+1}`,projectId,title:risk.title,type:'risk',owner:review.riskRatings?.[risk.id]?.owner??'',impact:rating.impact,likelihood:rating.likelihood,status:'open',mitigation:risk.mitigation,taskId:''};
  });
  const project:Project={id:projectId,name,client,description:configuration.project.description??'',budget:budget!,spent:0,target,category:'资料审核建项'};
  const createdAt=new Date().toISOString();
  const record:HandoverRecord={id:recordId,projectId,createdAt,reviewer:review.reviewer,configuration,review,taskIdMap};
  // Clone the existing workspace too: callers cannot mutate historical source
  // archives by editing a proposal or review object after applying it.
  const next:ExtendedWorkspace=structuredClone(existingWorkspace);
  next.projects.push(project);next.tasks.push(...tasks);next.risks.push(...risks);
  next.audit.push({id:`AUDIT-${token}`,at:createdAt,action:'人工审核资料后创建项目',entityId:projectId,detail:`审核人：${review.reviewer}；资料归档：${recordId}；新增 ${tasks.length} 项待办任务、${risks.length} 项风险；人工纠正 ${Object.keys(review.taskEdits??{}).length} 项任务的验收条件或依赖。计划采用日历天、完成后次日开始的依赖排期；模型建议保留独立标记。原文、合同日期、引用、人工调整理由及未答问题保存在归档。`});
  next.handovers=[...(next.handovers??[]),record];
  // Validate domain data and optional archive separately for backward-compatible
  // use by callers whose core workspace validator predates handovers.
  const {handovers,...core}=next;
  const checked=validateWorkspace(core) as ExtendedWorkspace;
  checked.handovers=validateHandoverRecords(handovers,checked);
  return checked;
}
