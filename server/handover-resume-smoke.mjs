// Explicit recovery of real extraction calls; only synthesis is newly inferred.
import {readFile,writeFile} from 'node:fs/promises';
import {resumeFromVerifiedExtractions} from './handover.mjs';
import {validateHandoverConfiguration} from '../src/handover-types.ts';
const root=new URL('../',import.meta.url);
const checkpointPath=process.argv[2]||'server/live-handover-2026-10-29T12-07-32-043Z.json';
const checkpoint=JSON.parse(await readFile(new URL(checkpointPath,root),'utf8'));
const startedAt=new Date().toISOString(),attemptId=startedAt.replace(/[:.]/g,'-');
const record={attemptId,startedAt,mode:'checkpoint_resume',originalCheckpoint:checkpointPath,calls:[],status:'running'};
const evidence=new URL(`server/live-handover-resume-${attemptId}.json`,root);
const save=()=>writeFile(evidence,JSON.stringify(record,null,2)+'\n');
try{
  const {configuration,resumption}=await resumeFromVerifiedExtractions(checkpoint,{ollamaUrl:'http://127.0.0.1:11434',handoverModel:'qwen3:8b',handoverTimeoutMs:180000},{signal:AbortSignal.timeout(390000),onProgress:p=>console.log(JSON.stringify(p)),fetchImpl:async(url,init)=>{
    const start=performance.now();const req=JSON.parse(init.body);record.calls.push({startedAt:new Date().toISOString(),requestContext:req.options?.num_ctx,status:'running'});await save();
    const response=await fetch(url,init);const text=await response.text();const parsed=JSON.parse(text);Object.assign(record.calls.at(-1),{status:'returned',durationMs:Math.round(performance.now()-start),httpStatus:response.status,promptEvalCount:parsed.prompt_eval_count,evalCount:parsed.eval_count,doneReason:parsed.done_reason,content:parsed.message?.content});await save();
    console.log(JSON.stringify({phase:'live-synthesis-returned',...record.calls.at(-1),content:undefined}));return new Response(text,{status:response.status,headers:response.headers});
  }});
  validateHandoverConfiguration(configuration);record.status='passed_schema';record.completedAt=new Date().toISOString();record.resumption=resumption;record.configuration=configuration;await save();
  await writeFile(new URL('public/samples/handover/recorded-run.json',root),JSON.stringify({configuration,metadata:{attemptId,mode:'checkpoint_resume',realModelRun:true,singleUninterruptedRun:false,syntheticDocuments:true,startedAt,completedAt:record.completedAt,resumption,knowledgeRefresh:checkpoint.knowledgeRefresh,validation:'Current extraction/citation validation rerun on original real provider outputs, followed by live synthesis; final frontend runtime schema passed. Human semantic review remains required.'}},null,2)+'\n');
  console.log(JSON.stringify({status:record.status,resumption,counts:{tasks:configuration.tasks.length,requirements:configuration.requirements.length,conflicts:configuration.conflicts.length,questions:configuration.openQuestions.length}}));
}catch(error){record.status='failed';record.completedAt=new Date().toISOString();record.error={code:error.code,message:error.message};await save();console.error(JSON.stringify({status:'failed',evidence:evidence.pathname,error:record.error}));process.exitCode=1;}
