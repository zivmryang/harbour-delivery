import {describe,it,expect,afterEach,vi} from 'vitest';
import {createServer,readConfig,validateHandoverJobInput} from './index.mjs';
import {HandoverError} from './handover.mjs';

const servers=[];
const input=()=>({provider:'ollama',projectContext:{jurisdiction:'Hong Kong',industry:'ICT',projectType:'Synthetic network handover',kickoffDate:null},documents:[{id:'DOC-1',name:'Synthetic contract',kind:'contract',text:'Synthetic contract: deliver a tested network and obtain acceptance.'}],knowledgeIds:[],refreshSources:false});
const noNetwork=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}});
const draft={version:1,project:{name:'Synthetic draft'},run:{reviewRequired:true}};
const completed=async(_,__,{onProgress})=>{onProgress?.({phase:'extract',message:'Extracting synthetic test source.',completed:1,total:2});return structuredClone(draft);};
async function gateway(options={}){
  const server=createServer({config:readConfig({}),fetchImpl:noNetwork,handoverImpl:completed,...options});servers.push(server);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;
}
const post=(url,body=input(),headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const status=(base,id,headers={})=>fetch(`${base}/api/handover/jobs/${id}`,{headers});
async function create(base,value=input(),headers={}){const response=await post(`${base}/api/handover/jobs`,value,headers);expect(response.status).toBe(202);return (await response.json()).jobId;}
async function waitFor(base,id,predicate,headers={}){
  for(let attempt=0;attempt<40;attempt++){const response=await status(base,id,headers);const job=await response.json();if(predicate(job))return job;await new Promise(resolve=>setImmediate(resolve));}
  throw new Error('Test job did not reach expected state.');
}
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));});

describe('handover task input and model health',()=>{
  it('defaults to separate qwen3:8b and accepts only server-controlled knowledge ids',()=>{
    expect(readConfig({}).handoverModel).toBe('qwen3:8b');expect(readConfig({HANDOVER_MODEL:'local-choice'}).handoverModel).toBe('local-choice');
    const request=input();delete request.refreshSources;
    expect(validateHandoverJobInput(request).refreshSources).toBe(true);
    expect(()=>validateHandoverJobInput({...request,knowledge:[{url:'http://localhost/private'}]})).toThrow();
    expect(()=>validateHandoverJobInput({...request,knowledgeIds:['https://example.com']})).toThrow();
    expect(()=>validateHandoverJobInput({...request,knowledgeIds:['hk-pdpo','hk-pdpo']})).toThrow();
  });
  it('reports handover installation independently of the old briefing model',async()=>{
    const base=await gateway({fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/api/tags')?{models:[{name:'qwen3:8b'}]}:{data:[]}))});
    const health=await (await fetch(`${base}/api/health`)).json();
    expect(health.providers.ollama.available).toBe(false);
    expect(health.providers.handover).toMatchObject({model:'qwen3:8b',available:true});
    expect(health.handover).toMatchObject({maxConcurrent:1,activeJobs:0,cacheLimit:8,ttlMs:1800000,timeoutMs:900000});
  });
  it('rejects invalid context, document limits, duplicate sources and external knowledge',async()=>{
    let time=Date.now();const handler=vi.fn(completed);const base=await gateway({handoverImpl:handler,now:()=>time});
    const invalid=[
      {...input(),provider:'other'}, {...input(),projectContext:{...input().projectContext,kickoffDate:'2026-02-30'}},
      {...input(),documents:[]}, {...input(),documents:[{...input().documents[0],text:'x'.repeat(100001)}]},
      {...input(),knowledgeIds:['unknown']}, {...input(),refreshSources:'true'},
      {...input(),documents:[{...input().documents[0],id:'hk-pdpo'}],knowledgeIds:['hk-pdpo']},
      {...input(),documents:[...input().documents,...input().documents]},
    ];
    for(const request of invalid){time+=60001;const res=await post(`${base}/api/handover/jobs`,request);expect(res.status).toBe(400);expect((await res.json()).error).toBe('INVALID_HANDOVER_INPUT');}
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('asynchronous handover job lifecycle',()=>{
  it('creates an unpredictable id, reports progress and returns a reviewed draft without changing project state',async()=>{
    let release;let observed;
    const handler=async(value,config,options)=>{observed={value,config};options.onProgress({phase:'extract',message:'Checking source evidence.',completed:1,total:3});return new Promise(resolve=>{release=()=>resolve(structuredClone(draft));});};
    const base=await gateway({handoverImpl:handler});const id=await create(base);
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    const running=await waitFor(base,id,job=>job.status==='running'&&job.progress.phase==='extract');
    expect(running.progress).toEqual({phase:'extract',message:'Checking source evidence.',completed:1,total:3});
    expect(running.result).toBeUndefined();expect(running.documents).toBeUndefined();expect(observed.config.handoverModel).toBe('qwen3:8b');
    release();const result=await waitFor(base,id,job=>job.status==='completed');
    expect(result.result).toEqual(draft);expect(result.progress.completed).toBe(result.progress.total);
    expect(observed.value.documents).toEqual(input().documents);
  });
  it('allows only one active job and cancels it through AbortController',async()=>{
    let signal;const handler=async(_,__,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Synthetic provider aborted')),{once:true}));};
    const base=await gateway({handoverImpl:handler});const id=await create(base);
    await waitFor(base,id,job=>job.status==='running');
    const busy=await post(`${base}/api/handover/jobs`);expect(busy.status).toBe(429);expect((await busy.json()).error).toBe('HANDOVER_BUSY');
    const cancelled=await post(`${base}/api/handover/jobs/${id}/cancel`,{});expect(cancelled.status).toBe(200);expect((await cancelled.json()).status).toBe('cancelled');
    expect(signal.aborted).toBe(true);expect((await (await status(base,id)).json()).result).toBeUndefined();
    const again=await create(base);expect(again).not.toBe(id);
  });
  it('does not allow late provider completion to overwrite cancellation',async()=>{
    let resolveModel;const base=await gateway({handoverImpl:async()=>new Promise(resolve=>{resolveModel=resolve;})});
    const id=await create(base);await waitFor(base,id,job=>job.status==='running');
    await post(`${base}/api/handover/jobs/${id}/cancel`,{});resolveModel(draft);
    const job=await waitFor(base,id,job=>job.status==='cancelled');expect(job.result).toBeUndefined();
  });
  it('enforces the fifteen-minute overall deadline and keeps a safe timeout result',async()=>{
    let time=Date.now();let signal;
    const base=await gateway({now:()=>time,handoverImpl:async(_,__,options)=>{signal=options.signal;return new Promise(()=>{});}});
    const id=await create(base);await waitFor(base,id,job=>job.status==='running');
    time+=900001;const job=await (await status(base,id)).json();
    expect(job.status).toBe('failed');expect(job.error.code).toBe('HANDOVER_JOB_TIMEOUT');expect(signal.aborted).toBe(true);
  });
  it('expires documents and results after thirty minutes',async()=>{
    let time=Date.now();const base=await gateway({now:()=>time});const id=await create(base);
    await waitFor(base,id,job=>job.status==='completed');time+=1800001;
    const res=await status(base,id);expect(res.status).toBe(404);expect((await res.json()).error).toBe('HANDOVER_JOB_NOT_FOUND');
  });
  it('keeps at most eight jobs by evicting oldest terminal entries',async()=>{
    let time=Date.now();const base=await gateway({now:()=>time});const ids=[];
    for(let i=0;i<9;i++){time+=60001;const id=await create(base);ids.push(id);await waitFor(base,id,job=>job.status==='completed');}
    expect((await status(base,ids[0])).status).toBe(404);
    expect((await status(base,ids[1])).status).toBe(200);expect((await status(base,ids[8])).status).toBe(200);
  });
  it('does not spend the generation quota on status polling or cancellation',async()=>{
    const base=await gateway();const id=await create(base);await waitFor(base,id,job=>job.status==='completed');
    for(let i=0;i<12;i++)expect((await status(base,id)).status).toBe(200);
    expect((await post(`${base}/api/handover/jobs/${id}/cancel`,{})).status).toBe(200);
    expect((await post(`${base}/api/handover/jobs`)).status).toBe(202);
  });
  it('redacts underlying validation and unexpected provider errors from HTTP job results',async()=>{
    for(const failure of [new HandoverError(502,'HANDOVER_VALIDATION_FAILED','PRIVATE-CONTRACT-CONTENT'),Error('PRIVATE-CONTRACT-CONTENT')]){
      const base=await gateway({handoverImpl:async()=>{throw failure;}});const id=await create(base);
      const job=await waitFor(base,id,job=>job.status==='failed');
      expect(JSON.stringify(job)).not.toContain('PRIVATE-CONTRACT-CONTENT');expect(job.error.message).toBeTruthy();expect(job.result).toBeUndefined();
    }
  });
});

describe('knowledge integration and gateway protections',()=>{
  it('accepts uploaded technical knowledge without ever fetching its metadata URL',async()=>{
    let received;const fetchImpl=vi.fn(noNetwork);
    const base=await gateway({fetchImpl,handoverImpl:async value=>{received=value;return draft;}});
    const source={id:'USER-K-08d0c4da-f9f2-4bcd-81e1-2b196db562d0',title:'Synthetic vendor handover reference',kind:'technical',jurisdiction:'Hong Kong',url:'http://127.0.0.1/private-not-to-be-fetched',version:'Synthetic v1',text:'Synthetic technical guidance: verify the recovery configuration before handover.'};
    const id=await create(base,{...input(),suppliedKnowledge:[source]});await waitFor(base,id,job=>job.status==='completed');
    expect(received.knowledge).toEqual([{...source,checkedAt:null}]);expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects uploaded knowledge with unsafe IDs, unsupported types or excessive combined size',()=>{
    const source={id:'USER-K-08d0c4da-f9f2-4bcd-81e1-2b196db562d0',title:'Synthetic reference',kind:'technical',jurisdiction:'Hong Kong',text:'Synthetic guidance.'};
    expect(()=>validateHandoverJobInput({...input(),suppliedKnowledge:[{...source,id:'hk-pdpo'}]})).toThrow();
    expect(()=>validateHandoverJobInput({...input(),suppliedKnowledge:[{...source,kind:'law'}]})).toThrow();
    expect(()=>validateHandoverJobInput({...input(),suppliedKnowledge:Array.from({length:9},()=>source)})).toThrow();
    const four=Array.from({length:4},(_,i)=>({...source,id:`USER-K-08d0c4da-f9f2-4bcd-81e1-2b196db562d${i}`,text:'x'.repeat(11000)}));
    expect(()=>validateHandoverJobInput({...input(),suppliedKnowledge:four})).toThrow();
  });
  it('exposes the server catalogue and maps legal/practice kinds with preserved source metadata',async()=>{
    let received;const base=await gateway({handoverImpl:async(value)=>{received=value;return draft;}});
    const catalog=await (await fetch(`${base}/api/knowledge`)).json();expect(catalog.sources).toHaveLength(6);
    const id=await create(base,{...input(),knowledgeIds:['hk-critical-infrastructure','pcpd-outsourcing']});
    const job=await waitFor(base,id,job=>job.status==='completed');
    expect(received.knowledge.map(item=>item.kind).sort()).toEqual(['best_practice','regulation']);
    const law=job.knowledge.find(item=>item.id==='hk-critical-infrastructure');
    expect(law.effectiveDate).toBe('2026-01-01');expect(law.sourceStatus).toBe('checked_snapshot');
    expect(received.knowledge.find(item=>item.id===law.id).text).toContain('政府部门不在');
  });
  it('refreshes selected official sources by default without sending document content to those sources',async()=>{
    const calls=[];let received;
    const fetchImpl=async(url,options)=>{calls.push({url,options});return new Response('Personal data DPP2 DPP4. '+'Synthetic official-source test fixture. '.repeat(10),{headers:{'Content-Type':'text/plain'}});};
    const base=await gateway({fetchImpl,handoverImpl:async value=>{received=value;return draft;}});
    const request={...input(),knowledgeIds:['hk-pdpo']};delete request.refreshSources;
    const id=await create(base,request);const job=await waitFor(base,id,job=>job.status==='completed');
    expect(calls).toHaveLength(1);expect(calls[0].url).toMatch(/^https:\/\/www\.pcpd\.org\.hk\//);
    expect(calls[0].options.body).toBeUndefined();expect(JSON.stringify(calls)).not.toContain(request.documents[0].text);
    expect(job.knowledge[0].sourceStatus).toBe('source_fetched');expect(received.knowledge[0].text).toContain('线上摘录');
  });
  it('returns failed refresh snapshots explicitly and rejects an arbitrary refresh URL',async()=>{
    const base=await gateway({fetchImpl:async()=>{throw Error('PRIVATE-NETWORK-PATH');}});
    const response=await post(`${base}/api/knowledge/refresh`,{ids:['hk-gov-s17']});expect(response.status).toBe(200);
    const result=await response.json();expect(result.sources[0].sourceStatus).toBe('refresh_failed');expect(JSON.stringify(result)).not.toContain('PRIVATE-NETWORK-PATH');
    expect((await post(`${base}/api/knowledge/refresh`,{ids:['http://127.0.0.1/']})).status).toBe(400);
    expect((await post(`${base}/api/knowledge/refresh`,{ids:[],url:'http://127.0.0.1/'})).status).toBe(400);
  });
  it('uses the existing token and exact CORS-origin checks on all new endpoints',async()=>{
    const token='test-handover-token-123456789';const headers={Authorization:`Bearer ${token}`};
    const base=await gateway({config:readConfig({AI_GATEWAY_TOKEN:token})});
    expect((await fetch(`${base}/api/knowledge`)).status).toBe(401);
    expect((await post(`${base}/api/knowledge/refresh`,{ids:[]})).status).toBe(401);
    expect((await post(`${base}/api/handover/jobs`)).status).toBe(401);
    const id=await create(base,input(),headers);
    expect((await status(base,id)).status).toBe(401);expect((await post(`${base}/api/handover/jobs/${id}/cancel`,{})).status).toBe(401);
    expect((await fetch(`${base}/api/knowledge`,{headers:{...headers,Origin:'https://untrusted.invalid'}})).status).toBe(403);
    expect((await fetch(`${base}/api/knowledge`,{headers})).status).toBe(200);
    expect(()=>readConfig({HOST:'0.0.0.0'})).toThrow();
  });
  it('allows up to one MiB only for handover creation and leaves other requests at 64 KiB',async()=>{
    const base=await gateway();
    const request={...input(),documents:[{...input().documents[0],text:'x'.repeat(70000)}]};
    const id=await create(base,request);await waitFor(base,id,job=>job.status==='completed');
    expect((await post(`${base}/api/brief`,{padding:'x'.repeat(70000)})).status).toBe(413);
    expect((await post(`${base}/api/knowledge/refresh`,{ids:[],padding:'x'.repeat(70000)})).status).toBe(413);
    expect((await post(`${base}/api/handover/jobs`,{padding:'x'.repeat(1048576)})).status).toBe(413);
  });
  it('returns safe method/not-found errors and requires JSON for creation',async()=>{
    const base=await gateway();
    expect((await fetch(`${base}/api/handover/jobs`,{method:'POST',body:'{}'})).status).toBe(415);
    expect((await fetch(`${base}/api/handover/jobs`)).status).toBe(405);
    const res=await status(base,'00000000-0000-4000-8000-000000000001');expect(res.status).toBe(404);
    expect((await res.json()).message).not.toContain('/Users/');
  });
});
