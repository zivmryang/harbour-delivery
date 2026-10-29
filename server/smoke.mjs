// This is a REAL model smoke test, separate from mocked unit tests.
import {generateBrief,readConfig,validateInput} from './index.mjs';
const input=validateInput({provider:process.env.SMOKE_PROVIDER||'ollama',language:'en',project:{id:'DEMO-1',name:'Synthetic network rollout'},facts:[{id:'TASK-1',text:'SIMULATION: acceptance testing is blocked because the vendor has not supplied the configuration evidence. No acceptance sign-off has been issued.'},{id:'TASK-2',text:'SIMULATION: the service handover depends on TASK-1. The handover must not be marked completed.'}],notes:'Identify the evidence needed before acceptance. This is a synthetic test, not a real customer project.'});
const started=new Date().toISOString();
try{
  const result=await generateBrief(input,readConfig());
  const passed=result.sourceIds.length>0 && result.sourceIds.every(id=>input.facts.some(f=>f.id===id));
  console.log(JSON.stringify({kind:'live-model-smoke',started,completed:new Date().toISOString(),passed,input,result,scope:'Checks live generation and source-id validity only; human review of content remains required.'},null,2));
  if(!passed)process.exitCode=1;
}catch(error){console.error(JSON.stringify({kind:'live-model-smoke',started,passed:false,error:error.code||error.name,message:error.message}));process.exitCode=1;}
