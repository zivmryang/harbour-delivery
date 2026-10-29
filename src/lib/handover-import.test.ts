import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {seedWorkspace} from '../demo';
import {validateWorkspace} from './engine';
import {validateHandoverConfiguration,validateHandoverRecords,type HandoverConfiguration,type HandoverReview} from '../handover-types';
import {HANDOVER_FILE_LIMIT,parseHandoverFile,parseHandoverFiles,reviewConfigurationToWorkspace} from './handover-import';

const mock=vi.hoisted(()=>({docx:'First paragraph\n\nSecond paragraph',pages:[['Page one'],['Page two']],destroy:vi.fn(),cleanup:vi.fn()}));
vi.mock('mammoth',()=>({extractRawText:vi.fn(async()=>({value:mock.docx,messages:[]}))}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({GlobalWorkerOptions:{workerSrc:''},getDocument:vi.fn(()=>({promise:Promise.resolve({numPages:mock.pages.length,getPage:async(n:number)=>({getTextContent:async()=>({items:mock.pages[n-1].map(str=>({str,hasEOL:true,transform:[1,0,0,1,0,100]}))}),cleanup:mock.cleanup})}),destroy:mock.destroy}))}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',()=>({default:'/assets/pdf.worker.mjs'}));

const sourceText='Synthetic contract. Deliver a design in 2 days. Deploy in 3 days. Target 2026-12-20. Price HKD 480000. Owner to be confirmed.';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const cite={sourceId:'DOC-1',quote:'Deliver a design in 2 days.',location:'DOC-1#chunk-01'};
function proposal():HandoverConfiguration {
  return{version:1,context:{jurisdiction:'Hong Kong',industry:'Synthetic',projectType:'ICT',kickoffDate:null},
    project:{name:'Synthetic delivery',client:'Synthetic customer',description:'Synthetic integration',budget:480000,currency:'HKD',target:'2026-12-20',sourceRefs:[{...cite,quote:'Target 2026-12-20. Price HKD 480000.'}]},
    requirements:[{id:'REQ-1',category:'deliverable',text:'Produce design',citations:[cite]}],
    tasks:[{id:'T1',title:'Produce design',ownerRole:'Design lead',durationDays:2,dependencies:[],acceptance:'Design signed off',sourceRefs:[cite],origin:'contract',rationale:'Required deliverable'},
      {id:'T2',title:'Deploy',ownerRole:null,durationDays:3,dependencies:['T1'],acceptance:null,sourceRefs:[{...cite,quote:'Deploy in 3 days.'}],origin:'contract',rationale:'Required deployment'},
      {id:'T3',title:'Optional peer review',ownerRole:null,durationDays:null,dependencies:['T1'],acceptance:null,sourceRefs:[],origin:'recommendation',rationale:'Recommended quality review'}],
    milestones:[{id:'M1',title:'Deployment accepted',date:'2026-12-20',taskIds:['T2'],sourceRefs:[{...cite,quote:'Target 2026-12-20.'}]}],
    risks:[{id:'R1',title:'Owner not assigned',mitigation:'Confirm accountable person',sourceRefs:[{...cite,quote:'Owner to be confirmed.'}]}],
    conflicts:[],openQuestions:[{id:'Q1',question:'Who will attend weekly reviews?',sourceRefs:[]}],applicability:[],
    documents:[{id:'DOC-1',name:'synthetic-contract.txt',kind:'contract',text:sourceText,sha256:hash(sourceText),cleanedSha256:hash(sourceText),cleanedText:sourceText,originalChars:sourceText.length,cleanedChars:sourceText.length,cleaning:{removedControlChars:0,normalizedLineEndings:0,removedBOM:false,duplicateLines:0},chunks:[{location:'DOC-1#chunk-01',start:0,end:sourceText.length}]}],knowledge:[],
    run:{provider:'ollama',model:'fixture',startedAt:'2026-10-29T01:00:00.000Z',generatedAt:'2026-10-29T01:00:01.000Z',durationMs:1000,calls:2,retries:0,stages:[{phase:'extract',sourceId:'DOC-1',location:'DOC-1#chunk-01',attempt:1,durationMs:500,status:'ok'},{phase:'synthesize',attempt:1,durationMs:500,status:'ok'}],reviewRequired:true}};
}
function review(overrides:Partial<HandoverReview>={}):HandoverReview{return{confirmed:true,reviewer:'Test reviewer',kickoff:'2026-11-01',riskRatings:{R1:{impact:2,likelihood:3}},...overrides};}
const file=(name:string,text='content')=>new File([text],name);

describe('local source parsing',()=>{
  beforeEach(()=>{mock.docx='First paragraph\n\nSecond paragraph';mock.pages=[['Page one'],['Page two']];mock.destroy.mockClear();});
  it('preserves Markdown paragraphs and ordinary text without rendering source HTML',async()=>{
    const result=await parseHandoverFile(file('scope.md','# Scope\r\n\r\n<script>untrusted</script>'),{id:'D1',kind:'statement_of_work'});
    expect(result).toMatchObject({id:'D1',kind:'statement_of_work',text:'【PARA 1】\n# Scope\n\n【PARA 2】\n<script>untrusted</script>'});
  });
  it('retains CSV quoted commas, escaped quotes and multiline cells with row markers',async()=>{
    const result=await parseHandoverFile(file('scope.csv','Item,Detail\r\nD1,"Line one, two\r\nLine ""three"""'));
    expect(result.text).toContain('【ROW 2】');expect(result.text).toContain('Line one, two\\nLine \\"three\\"');
  });
  it('rejects malformed CSV instead of silently changing columns',async()=>{
    await expect(parseHandoverFile(file('bad.csv','a,"unterminated'))).rejects.toThrow('未闭合');
    await expect(parseHandoverFile(file('bad.csv','"a"tail,b'))).rejects.toThrow('无效字符');
  });
  it('extracts DOCX text as numbered paragraphs',async()=>{
    expect((await parseHandoverFile(file('source.docx'))).text).toBe('【PARA 1】\nFirst paragraph\n\n【PARA 2】\nSecond paragraph');
  });
  it('retains PDF page and paragraph identity and releases resources',async()=>{
    const result=await parseHandoverFile(file('source.pdf'));
    expect(result.text).toContain('【PAGE 1】\n【PARA 1】\nPage one');expect(result.text).toContain('【PAGE 2】');expect(mock.destroy).toHaveBeenCalledOnce();
  });
  it('rejects a scanned or blank page even when another PDF page has text',async()=>{
    mock.pages=[['Readable text'],[]];await expect(parseHandoverFile(file('scan.pdf'))).rejects.toThrow('第 2 页');expect(mock.destroy).toHaveBeenCalledOnce();
  });
  it('rejects empty DOCX/text and does not invent OCR content',async()=>{
    mock.docx='\n \n';await expect(parseHandoverFile(file('scan.docx'))).rejects.toThrow('OCR');
    await expect(parseHandoverFile(file('empty.txt',' '))).rejects.toThrow('没有可读取');
    await expect(parseHandoverFile(file('empty.txt',''))).rejects.toThrow('空文件');
  });
  it('validates individual and combined byte limits before reading',async()=>{
    const oversized={name:'large.pdf',size:HANDOVER_FILE_LIMIT+1,arrayBuffer:vi.fn()} as unknown as File;
    await expect(parseHandoverFile(oversized)).rejects.toThrow('10 MB');expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    const large={name:'part.pdf',size:HANDOVER_FILE_LIMIT,arrayBuffer:vi.fn()} as unknown as File;
    await expect(parseHandoverFiles([large,large,large,large])).rejects.toThrow('30 MB');expect(large.arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects oversized combined text, unsupported formats and invalid encodings',async()=>{
    await expect(parseHandoverFiles([file('one.txt','a'.repeat(60000)),file('two.txt','b'.repeat(60000))])).rejects.toThrow('合计超过');
    await expect(parseHandoverFile(file('source.exe'))).rejects.toThrow('格式不支持');
    await expect(parseHandoverFile(new File([new Uint8Array([255])],'bad.txt'))).rejects.toThrow('编码');
  });
  it('assigns distinct IDs and keeps supplied document kinds by file order',async()=>{
    const docs=await parseHandoverFiles([file('a.txt'),file('b.txt')],['tender','contract']);expect(docs.map(d=>d.kind)).toEqual(['tender','contract']);expect(docs[0].id).not.toBe(docs[1].id);
  });
});

describe('reviewed configuration import',()=>{
  it('creates a separate project with inclusive FS dates, unassigned owners and unverified tasks',()=>{
    const existing=seedWorkspace(),before=structuredClone(existing),p=proposal(),r=review();
    const next=reviewConfigurationToWorkspace(p,r,existing),project=next.projects.at(-1)!;
    const tasks=next.tasks.filter(t=>t.projectId===project.id);
    expect(existing).toEqual(before);expect(tasks).toHaveLength(2);expect(tasks.map(t=>[t.start,t.due])).toEqual([['2026-11-01','2026-11-02'],['2026-11-03','2026-11-05']]);
    expect(tasks.every(t=>t.status==='todo'&&!t.accepted&&!t.evidence&&!t.owner)).toBe(true);expect(tasks[0].owner).not.toBe('Design lead');
    expect(tasks[1].dependencies).toEqual([tasks[0].id]);expect(next.risks.at(-1)).toMatchObject({impact:2,likelihood:3,status:'open',owner:''});
    expect(next.handovers![0].configuration).toEqual(p);expect(next.handovers![0].configuration.openQuestions).toHaveLength(1);
    p.project.name='Mutated';r.reviewer='Mutated';expect(next.projects.at(-1)!.name).toBe('Synthetic delivery');expect(next.handovers![0].reviewer).toBe('Test reviewer');
    const {handovers,...core}=next;expect(validateWorkspace(JSON.parse(JSON.stringify(core)))).toEqual(core);expect(validateHandoverRecords(JSON.parse(JSON.stringify(handovers)),core)).toEqual(handovers);
    expect(validateWorkspace(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(validateWorkspace(JSON.parse(JSON.stringify(existing)))).toEqual(existing);
  });
  it('rejects missing confirmation and reviewer',()=>{
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({confirmed:false}),seedWorkspace())).toThrow('明确确认');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({reviewer:''}),seedWorkspace())).toThrow('reviewer');
  });
  it('rejects invalid calendar dates and a target before kickoff',()=>{
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({kickoff:'2026-02-30'}),seedWorkspace())).toThrow('日期');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({kickoff:'2027-01-01'}),seedWorkspace())).toThrow('早于启动');
  });
  it('requires an explicit target if source documents do not supply it',()=>{
    const p=proposal();p.project.target=null;expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('目标日期缺失');
    expect(reviewConfigurationToWorkspace(p,review({target:'2026-12-19'}),seedWorkspace()).projects.at(-1)!.target).toBe('2026-12-19');
  });
  it('requires a reason to override an original target and archives both dates',()=>{
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({target:'2026-12-19'}),seedWorkspace())).toThrow('调整理由');
    const next=reviewConfigurationToWorkspace(proposal(),review({target:'2026-12-19',targetOverrideReason:'Client confirmed earlier internal target'}),seedWorkspace());
    expect(next.projects.at(-1)!.target).toBe('2026-12-19');expect(next.handovers![0].configuration.project.target).toBe('2026-12-20');
  });
  it('does not exchange foreign currencies or treat an unknown budget as zero',()=>{
    const p=proposal();p.project.currency='CNY';expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('不会默认填零');
    expect(()=>reviewConfigurationToWorkspace(p,review({budgetHKD:500000}),seedWorkspace())).toThrow('不会自动换汇');
    const next=reviewConfigurationToWorkspace(p,review({budgetHKD:500000,budgetConversionNote:'Finance approved HKD planning envelope; original CNY amount retained'}),seedWorkspace());expect(next.projects.at(-1)!.budget).toBe(500000);expect(next.handovers![0].configuration.project.currency).toBe('CNY');
    p.project.currency='HKD';p.project.budget=null;expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('预算');
  });
  it('blocks unresolved conflicts, while nonblocking unanswered questions remain in the archive',()=>{
    const p=proposal();p.conflicts=[{id:'C1',topic:'Dates conflict',detail:'Different document deadlines',sourceRefs:[cite]}];
    expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('尚未人工解决');
    expect(reviewConfigurationToWorkspace(p,review({conflictResolutions:{C1:'Owner confirms the signed contract date'}}),seedWorkspace()).handovers![0].configuration.openQuestions).toHaveLength(1);
  });
  it('rejects cyclic/missing dependencies and partial selection that drops dependencies',()=>{
    const p=proposal();p.tasks[0].dependencies=['T2'];expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('循环');
    p.tasks[0].dependencies=['missing'];expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('依赖不存在');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({selectedTaskIds:['T2']}),seedWorkspace())).toThrow('未被选中');
  });
  it('keeps recommendations optional and visibly labeled, requiring explicit unknown-duration estimates',()=>{
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({selectedTaskIds:['T1','T3']}),seedWorkspace())).toThrow('实施建议');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({includeRecommendations:true}),seedWorkspace())).toThrow('工期未知');
    const next=reviewConfigurationToWorkspace(proposal(),review({includeRecommendations:true,defaultDurationDays:7}),seedWorkspace());
    expect(next.tasks.at(-1)!.title).toBe('[实施建议] Optional peer review');expect(next.tasks.at(-1)!.due).toBe('2026-11-09');expect(next.handovers![0].configuration.tasks[2].durationDays).toBeNull();
  });
  it('applies reviewed acceptance and dependency edits while preserving original proposal and citations',()=>{
    const p=proposal(),before=structuredClone(p),existing=seedWorkspace(),old=structuredClone(existing);
    const edits={T2:{acceptance:'All six site records checked and signed by the designated reviewer.',dependencies:[],reason:'Confirmed independent preparation scope against the source document; corrected missing acceptance detail.'}};
    const next=reviewConfigurationToWorkspace(p,review({taskEdits:edits}),existing),task=next.tasks.at(-1)!;
    expect(task.acceptance).toBe(edits.T2.acceptance);expect(task.dependencies).toEqual([]);expect(task.start).toBe('2026-11-01');expect(task.due).toBe('2026-11-03');expect(task.accepted).toBe(false);expect(task.evidence).toBe('');
    expect(p).toEqual(before);expect(existing).toEqual(old);expect(next.handovers![0].configuration).toEqual(before);expect(next.handovers![0].review.taskEdits).toEqual(edits);
    expect(validateWorkspace(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it('permits removing unsupported acceptance criteria but requires an explicit nonblank reason',()=>{
    const edit={acceptance:'',dependencies:['T1'],reason:'The source does not establish this acceptance criterion; awaiting clarification.'};
    const next=reviewConfigurationToWorkspace(proposal(),review({taskEdits:{T2:edit}}),seedWorkspace());expect(next.tasks.at(-1)!.acceptance).toBe('');expect(next.tasks.at(-1)!.accepted).toBe(false);
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({taskEdits:{T2:{...edit,reason:' '}}}),seedWorkspace())).toThrow('reason');
  });
  it('checks edited graphs before scheduling, rejecting cycles and self-dependencies',()=>{
    const edit={acceptance:'Check design',dependencies:['T2'],reason:'Proposed ordering correction'};
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({taskEdits:{T1:edit}}),seedWorkspace())).toThrow('循环依赖');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({taskEdits:{T1:{...edit,dependencies:['T1']}}}),seedWorkspace())).toThrow('依赖自身');
  });
  it('rejects unknown edited task ids and dependencies outside this configuration',()=>{
    const existing=seedWorkspace(),edit={acceptance:'Source-confirmed criterion',dependencies:[existing.tasks[0].id],reason:'Planning correction'};
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({taskEdits:{T2:edit}}),existing)).toThrow('其他项目');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({taskEdits:{missing:{...edit,dependencies:[]}}}),existing)).toThrow('编辑任务不属于');
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({taskEdits:{T2:{...edit,dependencies:['unknown']}}}),existing)).toThrow('依赖不存在');
  });
  it('validates selected dependency completeness after edits and rejects tampered archived edits',()=>{
    const p=proposal();p.tasks[2].dependencies=[];
    const edits={T2:{acceptance:'Source-confirmed criterion',dependencies:['T3'],reason:'Explicitly adopt the optional review as a planning predecessor'}};
    expect(()=>reviewConfigurationToWorkspace(p,review({taskEdits:edits}),seedWorkspace())).toThrow('此依赖是实施建议');
    const next=reviewConfigurationToWorkspace(p,review({taskEdits:edits,includeRecommendations:true,defaultDurationDays:1}),seedWorkspace());
    expect(next.tasks.find(t=>t.id===next.handovers![0].taskIdMap.T2)!.dependencies).toEqual([next.handovers![0].taskIdMap.T3]);
    next.handovers![0].review.taskEdits!.T2.dependencies=['other-project-task'];expect(()=>validateWorkspace(next)).toThrow('不属于本次配置');
  });
  it('requires human risk scores and permits a named owner only through review',()=>{
    expect(()=>reviewConfigurationToWorkspace(proposal(),review({riskRatings:undefined}),seedWorkspace())).toThrow('尚未人工评分');
    const next=reviewConfigurationToWorkspace(proposal(),review({taskOwners:{T1:'Assigned reviewer'},riskRatings:{R1:{impact:3,likelihood:2,owner:'Risk owner'}}}),seedWorkspace());
    expect(next.tasks.at(-2)!.owner).toBe('Assigned reviewer');expect(next.risks.at(-1)!.owner).toBe('Risk owner');
  });
  it('enforces original milestone dates and retains a justified override',()=>{
    const p=proposal();p.milestones[0].date='2026-11-04';expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('排期超出里程碑');
    const next=reviewConfigurationToWorkspace(p,review({milestoneOverrides:{M1:{date:'2026-11-06',reason:'Documented owner decision'}}}),seedWorkspace());expect(next.handovers![0].configuration.milestones[0].date).toBe('2026-11-04');
  });
  it('rejects invented citation text or a quote placed outside its declared chunk',()=>{
    const p=proposal();p.tasks[0].sourceRefs=[{...cite,quote:'Not present'}];expect(()=>validateHandoverConfiguration(p)).toThrow('引用未出现在');
    p.tasks[0].sourceRefs=[{...cite,location:'DOC-1#chunk-02'}];expect(()=>validateHandoverConfiguration(p)).toThrow('引用未出现在');
  });
  it('rejects source audit text that no longer corresponds to the archived original',()=>{
    const p=proposal();p.documents[0].cleanedText=p.documents[0].cleanedText.replace('Synthetic','Malicious');
    expect(()=>validateHandoverConfiguration(p)).toThrow('原文不一致');
    const q=proposal();q.documents[0].chunks[0].end--;
    expect(()=>validateHandoverConfiguration(q)).toThrow('连续覆盖');
  });
  it('retains historical mappings after deletion but refuses cross-project mappings',()=>{
    const next=reviewConfigurationToWorkspace(proposal(),review(),seedWorkspace()),imported=next.handovers![0].taskIdMap.T2;
    next.tasks=next.tasks.filter(t=>t.id!==imported);
    expect(validateWorkspace(JSON.parse(JSON.stringify(next))).handovers![0].taskIdMap.T2).toBe(imported);
    next.handovers![0].taskIdMap.T1=next.tasks[0].id;expect(()=>validateHandoverRecords(next.handovers,next)).toThrow('映射无效');
  });
  it('explains a contract task depending on an excluded recommendation',()=>{
    const p=proposal();p.tasks[2].dependencies=[];p.tasks[0].dependencies=['T3'];
    expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('此依赖是实施建议');
    expect(reviewConfigurationToWorkspace(p,review({includeRecommendations:true,defaultDurationDays:1}),seedWorkspace()).tasks.at(-3)!.dependencies).toHaveLength(1);
  });
  it('keeps external knowledge as reviewed candidate guidance and refuses knowledge-only contract tasks',()=>{
    const p=proposal(),text='Synthetic guidance: consider a review.';
    p.knowledge=[{id:'K1',title:'Synthetic policy',kind:'policy',jurisdiction:'Synthetic',url:null,version:null,checkedAt:null,text,sha256:hash(text),cleanedSha256:hash(text),cleanedText:text,originalChars:text.length,cleanedChars:text.length,cleaning:{removedControlChars:0,normalizedLineEndings:0,removedBOM:false,duplicateLines:0},chunks:[{location:'K1#chunk-01',start:0,end:text.length}]}];p.applicability=[{sourceId:'K1',status:'potential',reason:'Human review required'}];
    expect(()=>reviewConfigurationToWorkspace(p,review(),seedWorkspace())).toThrow('适用性');
    expect(reviewConfigurationToWorkspace(p,review({policyReviewConfirmed:true}),seedWorkspace()).handovers![0].configuration.applicability[0].status).toBe('potential');
    p.tasks[0].sourceRefs=[{sourceId:'K1',quote:text,location:'K1#chunk-01'}];expect(()=>reviewConfigurationToWorkspace(p,review({policyReviewConfirmed:true}),seedWorkspace())).toThrow('不能标记为合同义务');
  });
});
