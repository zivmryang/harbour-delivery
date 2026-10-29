import {describe,it,expect} from 'vitest';
import {parseTasksCSV,exportTasksCSV} from './imports';
import {seedWorkspace} from '../demo';
import {canComplete} from './engine';
import {validateWorkspace} from './engine';
import {readFileSync} from 'node:fs';

describe('CSV interchange',()=>{
  it('round trips standard tasks, including comma, quote and multiline fields',()=>{
    const t=seedWorkspace().tasks[0];t.title='Network, "phase A"';t.evidence='Line one\nLine two, agreed';
    expect(parseTasksCSV(exportTasksCSV([t]),t.projectId)).toEqual([t]);
  });
  it('maps Jira fields and English dates without inventing acceptance',()=>{
    const tasks=parseTasksCSV('Issue key,Summary,Assignee,Status,Priority,Due date\nICT-1,Test rollout,Demo,Done,Highest,3/Nov/26','p');
    expect(tasks[0]).toMatchObject({id:'ICT-1',title:'Test rollout',status:'done',priority:'high',start:'2026-11-03',due:'2026-11-03',accepted:false,evidence:''});
    expect(canComplete(tasks[0],tasks).length).toBeGreaterThan(0);
  });
  it('maps Chinese and Feishu-style headers',()=>{
    const [t]=parseTasksCSV('任务编号,工作项名称,负责人,工作项状态,优先级,计划开始时间,计划结束时间,验收通过\nFS-1,测试,模拟人,进行中,中,2026/10/29,2026/11/2,否','p');
    expect(t).toMatchObject({status:'active',start:'2026-10-29',due:'2026-11-02',accepted:false});
  });
  it('handles BOM, CRLF, escaped quotes and empty lines',()=>{
    const [t]=parseTasksCSV('\uFEFFtitle,due\r\n"Review ""A""",2026-11-01\r\n\r\n','p');expect(t.title).toBe('Review "A"');
  });
  it('does not silently accept malformed rows, statuses, dates or booleans',()=>{
    expect(()=>parseTasksCSV('title,due\n"Unclosed,2026-11-01','p')).toThrow('引号');
    expect(()=>parseTasksCSV('title,due\nTask,2026-11-01,Extra','p')).toThrow('列数');
    expect(()=>parseTasksCSV('title,due,status\nTask,2026-11-01,Magic','p')).toThrow('状态');
    expect(()=>parseTasksCSV('title,due\nTask,2026-02-30','p')).toThrow('日期');
    expect(()=>parseTasksCSV('title,due,accepted\nTask,2026-11-01,maybe','p')).toThrow('验收通过');
  });
  it('rejects duplicate IDs and alias columns',()=>{
    expect(()=>parseTasksCSV('id,title,due\nX,A,2026-11-01\nX,B,2026-11-02','p')).toThrow('重复');
    expect(()=>parseTasksCSV('title,Summary,due\nA,B,2026-11-01','p')).toThrow('重复表头');
  });
  it('requires titles and due dates rather than inventing schedules',()=>{
    expect(()=>parseTasksCSV('title,owner\nA,B','p')).toThrow('截止日期');
    expect(()=>parseTasksCSV('title,due\n,2026-11-01','p')).toThrow('任务名称');
  });
  it('neutralizes spreadsheet formula injection on export',()=>{
    const t=seedWorkspace().tasks[0];t.title='=HYPERLINK("https://example.test")';t.owner=' +SUM(1,2)';t.vendor='@SUM(A1)';
    const csv=exportTasksCSV([t]);expect(csv).toContain('"\'=HYPERLINK');expect(csv).toContain('"\' +SUM');expect(csv).toContain('"\'@SUM');
  });
  it('enforces a bounded input size',()=>expect(()=>parseTasksCSV('a'.repeat(2_000_001),'p')).toThrow('2 MB'));
  it('the downloadable generic template appends as a valid dependency chain',()=>{
    const w=seedWorkspace();const csv=readFileSync(new URL('../../public/samples/tasks.csv',import.meta.url),'utf8');
    const imported=parseTasksCSV(csv,w.projects[0].id);expect(imported).toHaveLength(4);
    expect(validateWorkspace({...w,tasks:[...w.tasks,...imported]}).tasks).toHaveLength(24);
    expect(canComplete(imported[0],imported)).toEqual([]);
  });
});
