import {describe,it,expect} from 'vitest';
import {seedWorkspace} from '../demo';
import type {Task} from '../types';
import {analyze,canComplete,criticalPath,generateBrief,validateWorkspace,workspaceFingerprint,validDate} from './engine';

const task=(id:string,days:number,deps:string[]=[]):Task=>({id,projectId:'p',title:id,owner:'demo',vendor:'demo',status:'done',priority:'medium',start:'2026-10-01',due:`2026-10-${String(days).padStart(2,'0')}`,dependencies:deps,acceptance:'checked',accepted:true,evidence:'demo record'});

describe('calendar-day CPM',()=>{
  it('uses the longest branch, calculates slack, includes endpoints',()=>{
    const result=criticalPath([task('A',2),task('B',3,['A']),task('C',1,['A']),task('D',2,['B','C'])]);
    expect(result.duration).toBe(7);expect(result.criticalIds).toEqual(['A','B','D']);expect(result.slack.C).toBe(2);
  });
  it('marks both equal-length critical branches',()=>{
    expect(criticalPath([task('A',2),task('B',2),task('C',1,['A','B'])]).criticalIds).toEqual(['A','B','C']);
  });
  it('handles empty and disconnected networks',()=>{
    expect(criticalPath([])).toEqual({criticalIds:[],duration:0,cycle:false,slack:{}});
    expect(criticalPath([task('A',3),task('B',1)]).slack.B).toBe(2);
  });
  it('returns no misleading path for cycles or a self-reference',()=>{
    expect(criticalPath([task('A',2,['B']),task('B',1,['A'])])).toMatchObject({cycle:true,criticalIds:[],duration:0});
    expect(criticalPath([task('A',1,['A'])]).cycle).toBe(true);
  });
});

describe('completion gate',()=>{
  it('requires evidence, acceptance, approval and owner',()=>{
    const t={...task('A',1),accepted:false,evidence:'',acceptance:'',owner:''};
    expect(canComplete(t,[t])).toHaveLength(4);
  });
  it('rejects incomplete dependencies even when target is done',()=>{
    const a={...task('A',1),status:'active' as const},b=task('B',2,['A']);
    expect(canComplete(b,[a,b]).join()).toContain('A');
  });
  it('rejects invalid acceptance in upstream chains',()=>{
    const a={...task('A',1),evidence:''},b=task('B',1,['A']),c=task('C',1,['B']);
    expect(canComplete(c,[a,b,c]).join()).toContain('B');
  });
  it('evaluates the edited task, detects cycles and rejects missing references',()=>{
    const a=task('A',1),b=task('B',1,['A']);
    expect(canComplete({...a,dependencies:['B']},[a,b]).join()).toContain('循环');
    expect(canComplete({...a,dependencies:['unknown']},[a]).join()).toContain('不存在');
  });
  it('allows valid completed acceptance with accepted predecessors',()=>{
    const a=task('A',1),b=task('B',1,['A']);expect(canComplete(b,[a,b])).toEqual([]);
  });
});

describe('control findings and brief provenance',()=>{
  it('detects seeded budget, delay, missing owner and dependency findings',()=>{
    const findings=analyze(seedWorkspace());
    expect(findings.some(f=>f.id==='budget-cloudbridge')).toBe(true);
    expect(findings.some(f=>f.id==='overdue-HL-03')).toBe(true);
    expect(findings.some(f=>f.id==='owner-HL-07')).toBe(true);
    expect(findings.some(f=>f.id==='waiting-HL-06-HL-05')).toBe(true);
    expect(analyze(seedWorkspace(),'civicflow').some(f=>f.id.includes('HL'))).toBe(false);
  });
  it('does not mark due-today tasks overdue or count invalid Done as verified',()=>{
    const w=seedWorkspace();w.tasks[2].due=w.asOf;
    expect(analyze(w).some(f=>f.id==='overdue-HL-03')).toBe(false);
    w.tasks[0].evidence='';expect(analyze(w).some(f=>f.id==='gate-HL-01')).toBe(true);
    expect(generateBrief(w,'harbourlink').text).toContain('0/8');
  });
  it('reports date and cycle errors rather than silently approving them',()=>{
    const w=seedWorkspace();w.tasks[0].dependencies=['HL-02'];w.tasks[2].start='2026-11-09';
    expect(analyze(w).some(f=>f.id==='cycle-harbourlink')).toBe(true);expect(analyze(w).some(f=>f.id==='date-HL-03')).toBe(true);
  });
  it('labels rules clearly and cites only source records',()=>{
    const w=seedWorkspace(),brief=generateBrief(w,'harbourlink','en');
    expect(brief.text).toContain('Deterministic rules draft');expect(brief.text).toContain('Human review required');
    const allIds=new Set([...w.projects,...w.tasks,...w.risks].map(x=>x.id));expect(brief.sources.every(s=>allIds.has(s))).toBe(true);
    expect(()=>generateBrief(w,'missing')).toThrow('项目不存在');
  });
  it('fingerprint changes with source data but not audit/report metadata',()=>{
    const w=seedWorkspace(),before=workspaceFingerprint(w,'harbourlink');
    w.audit.push({id:'audit-1',at:'2026-10-29T12:00:00Z',action:'test',entityId:'harbourlink',detail:''});
    expect(workspaceFingerprint(w,'harbourlink')).toBe(before);w.tasks[0].title+=' updated';expect(workspaceFingerprint(w,'harbourlink')).not.toBe(before);
  });
  it('fingerprint ignores record order, metrics and reviewer edits but tracks source changes',()=>{
    const w=seedWorkspace(),before=workspaceFingerprint(w,'harbourlink');
    w.tasks.reverse();w.risks.reverse();w.tasks.forEach(t=>t.dependencies.reverse());
    w.measurements[0].after=99;
    w.briefs.push({id:'B-1',projectId:'harbourlink',createdAt:'2026-10-29T12:00:00Z',mode:'rules',text:'draft',sources:['HL-01'],reviewed:true,reviewer:'Reviewer',inputHash:before});
    expect(workspaceFingerprint(w,'harbourlink')).toBe(before);
    w.briefs[0].reviewer='Another reviewer';expect(workspaceFingerprint(w,'harbourlink')).toBe(before);
    w.asOf='2026-10-30';expect(workspaceFingerprint(w,'harbourlink')).not.toBe(before);
  });
});

describe('strict backup validation',()=>{
  it('round trips all seeded data and isolates returned data',()=>{
    const original=seedWorkspace(),out=validateWorkspace(JSON.parse(JSON.stringify(original)));expect(out).toEqual(original);out.tasks[0].dependencies.push('x');expect(original.tasks[0].dependencies).toEqual([]);
  });
  it('validates actual dates including leap years',()=>{
    expect(validDate('2026-02-30')).toBe(false);expect(validDate('2024-02-29')).toBe(true);expect(validDate('2026-02-29')).toBe(false);
    const w=seedWorkspace();w.asOf='2026-13-01';expect(()=>validateWorkspace(w)).toThrow('日期');
  });
  it('rejects missing fields, unknown fields, non-finite costs and fake booleans',()=>{
    const w=seedWorkspace();expect(()=>validateWorkspace({...w,privateData:'unknown'})).toThrow('未知字段');
    expect(()=>validateWorkspace({...w,version:2})).toThrow('版本');w.projects[0].budget=Infinity;expect(()=>validateWorkspace(w)).toThrow('数值');
    const other=seedWorkspace() as any;other.tasks[0].accepted='true';expect(()=>validateWorkspace(other)).toThrow('布尔');delete other.tasks[0].accepted;expect(()=>validateWorkspace(other)).toThrow('缺少');
  });
  it('rejects duplicates, cross-project or unknown references and cycles',()=>{
    let w=seedWorkspace();w.tasks[1].id=w.tasks[0].id;expect(()=>validateWorkspace(w)).toThrow('重复');
    w=seedWorkspace();w.tasks[0].dependencies=['CF-01'];expect(()=>validateWorkspace(w)).toThrow('依赖');
    w=seedWorkspace();w.tasks[0].dependencies=['HL-02'];expect(()=>validateWorkspace(w)).toThrow('循环');
    w=seedWorkspace();w.risks[0].taskId='missing';expect(()=>validateWorkspace(w)).toThrow('引用');
  });
  it('requires positive sample size and supported provenance',()=>{
    const w=seedWorkspace();w.measurements[0].sampleSize=0;expect(()=>validateWorkspace(w)).toThrow('样本量');
    const x=seedWorkspace() as any;x.measurements[0].provenance='proven';expect(()=>validateWorkspace(x)).toThrow('选项');
  });
});
