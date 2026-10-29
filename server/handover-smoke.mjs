// Real local-model evaluation on public synthetic documents. No mocked provider.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {generateHandoverDraft} from './handover.mjs';
import {refreshKnowledge,buildKnowledgeContext} from './knowledge.mjs';
import {validateHandoverConfiguration} from '../src/handover-types.ts';
const root=new URL('../',import.meta.url);
const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
const startedAt=new Date().toISOString();const started=performance.now();
const attemptId=startedAt.replace(/[:.]/g,'-');
const record={attemptId,startedAt,model:'qwen3:8b',syntheticDocuments:true,transport:'real local Ollama; no mocked provider',knowledgeRefresh:[],calls:[],progress:[]};
const evidence=new URL(`server/live-handover-${attemptId}.json`,root);
const checkpoint=()=>writeFile(evidence,JSON.stringify(record,null,2)+'\n');
try{
  const documents=await Promise.all([
    ['SYN-TENDER-01','synthetic-tender.txt','tender'],['SYN-CONTRACT-01','synthetic-contract.txt','contract'],['SYN-SOW-01','synthetic-statement-of-work.txt','statement_of_work'],
  ].map(async([id,name,kind])=>({id,name,kind,text:await readFile(new URL(`public/samples/handover/${name}`,root),'utf8')})));
  const sources=await refreshKnowledge(['hk-pdpo','pcpd-outsourcing','dpo-project-management']);
  record.knowledgeRefresh=sources.map(s=>({id:s.id,status:s.sourceStatus,error:s.refreshError,fetchedAt:s.fetchedAt,contentHash:s.contentHash}));
  console.log(JSON.stringify({phase:'knowledge-refreshed',sources:record.knowledgeRefresh}));
  const knowledge=sources.map(s=>({id:s.id,title:s.title,kind:s.kind==='law'?'regulation':s.kind==='practice'?'best_practice':s.kind,jurisdiction:s.jurisdiction,url:s.url,version:s.version,checkedAt:s.checkedAt,text:buildKnowledgeContext(s,documents.map(d=>d.text).join('\n'))}));
  const input={provider:'ollama',projectContext:{jurisdiction:'Hong Kong',industry:'ICT 系统集成',projectType:'网络与会议系统升级',kickoffDate:'2026-11-02'},documents,knowledge};
  record.input=input;await checkpoint();
  const configuration=await generateHandoverDraft(input,{ollamaUrl:'http://127.0.0.1:11434',handoverModel:'qwen3:8b',handoverTimeoutMs:180000},{signal:AbortSignal.any([stop.signal,AbortSignal.timeout(600000)]),onProgress:p=>{record.progress.push({...p,at:new Date().toISOString()});console.log(JSON.stringify(p));},fetchImpl:async(url,init)=>{
    const start=performance.now();const req=JSON.parse(init.body);const response=await fetch(url,init);const raw=await response.text();let payload;try{payload=JSON.parse(raw);}catch{payload={unparsedResponse:true};}
    record.calls.push({at:new Date().toISOString(),durationMs:Math.round(performance.now()-start),requestContext:req.options?.num_ctx,requestOutputBudget:req.options?.num_predict,httpStatus:response.status,promptEvalCount:payload.prompt_eval_count,evalCount:payload.eval_count,doneReason:payload.done_reason,model:payload.model,content:payload.message?.content});await checkpoint();
    console.log(JSON.stringify({phase:'provider-returned',call:record.calls.length,durationMs:record.calls.at(-1).durationMs,promptTokens:payload.prompt_eval_count,outputTokens:payload.eval_count,doneReason:payload.done_reason}));
    return new Response(raw,{status:response.status,headers:response.headers});
  }});
  validateHandoverConfiguration(configuration);
  record.status='passed_schema';record.completedAt=new Date().toISOString();record.durationMs=Math.round(performance.now()-started);record.configuration=configuration;await checkpoint();
  const output=new URL('public/samples/handover/recorded-run.json',root);await mkdir(new URL('public/samples/handover/',root),{recursive:true});
  await writeFile(output,JSON.stringify({configuration,metadata:{attemptId,model:record.model,startedAt,completedAt:record.completedAt,durationMs:record.durationMs,syntheticDocuments:true,realModelRun:true,knowledgeRefresh:record.knowledgeRefresh,validation:'Passed server evidence checks and frontend validateHandoverConfiguration; human semantic review still required.'}},null,2)+'\n');
  console.log(JSON.stringify({status:record.status,output:fileURLToPath(output),run:configuration.run,counts:{requirements:configuration.requirements.length,tasks:configuration.tasks.length,milestones:configuration.milestones.length,conflicts:configuration.conflicts.length,questions:configuration.openQuestions.length},project:configuration.project}));
}catch(error){record.status='failed';record.completedAt=new Date().toISOString();record.durationMs=Math.round(performance.now()-started);record.error={name:error.name,code:error.code||null,message:error.message};await checkpoint();console.error(JSON.stringify({status:'failed',evidence:fileURLToPath(evidence),durationMs:record.durationMs,error:record.error}));process.exitCode=1;}
