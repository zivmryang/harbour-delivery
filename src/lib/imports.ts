import type {Task, Status, Priority} from '../types';
import {validDate} from './engine';

const headers: Record<string, keyof Task> = {
  id:'id', key:'id', issuekey:'id', taskid:'id', 任务id:'id', 任务编号:'id', 编号:'id',
  title:'title', summary:'title', name:'title', taskname:'title', 任务名称:'title', 任务:'title', 标题:'title', 工作项名称:'title',
  owner:'owner', assignee:'owner', assignedto:'owner', 负责人:'owner', 经办人:'owner',
  vendor:'vendor', supplier:'vendor', 供应商:'vendor',
  status:'status', state:'status', 状态:'status', 任务状态:'status', 工作项状态:'status',
  priority:'priority', 优先级:'priority',
  start:'start', startdate:'start', 开始日期:'start', 开始时间:'start', 计划开始时间:'start',
  due:'due', duedate:'due', finish:'due', enddate:'due', 截止日期:'due', 截止时间:'due', 结束日期:'due', 计划结束时间:'due',
  dependencies:'dependencies', dependency:'dependencies', predecessors:'dependencies', 前置任务:'dependencies', 依赖:'dependencies',
  acceptance:'acceptance', acceptancecriteria:'acceptance', 验收标准:'acceptance',
  accepted:'accepted', 验收通过:'accepted',
  evidence:'evidence', 验收证据:'evidence', 证据:'evidence',
};
const norm=(s:string)=>s.trim().toLowerCase().replace(/[\s_\-()]/g,'');

function parseRows(text:string):string[][] {
  if(text.length>2_000_000)throw new Error('CSV 超过 2 MB 限制');
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  const pushField=()=>{row.push(field);field='';closed=false;};
  const pushRow=()=>{pushField();if(row.some(s=>s.trim()))rows.push(row);row=[];if(rows.length>2001)throw new Error('每次最多导入 2,000 项任务');};
  const input=text.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw new Error('CSV 引号格式错误');quoted=true;continue;}
    if(c===','){pushField();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;pushRow();continue;}
    if(closed&&c.trim())throw new Error('CSV 结束引号后出现多余内容');
    if(!closed)field+=c;
  }
  if(quoted)throw new Error('CSV 存在未闭合引号');
  if(field||row.length||closed)pushRow();
  return rows;
}

function dateValue(raw:string):string {
  const s=raw.trim();if(validDate(s))return s;
  const slash=s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if(slash){const d=`${slash[1]}-${slash[2].padStart(2,'0')}-${slash[3].padStart(2,'0')}`;if(validDate(d))return d;}
  const jira=s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2}|\d{4})$/);
  if(jira){const m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(jira[2].toLowerCase())+1;const y=jira[3].length===2?'20'+jira[3]:jira[3];const d=`${y}-${String(m).padStart(2,'0')}-${jira[1].padStart(2,'0')}`;if(validDate(d))return d;}
  throw new Error(`日期「${s}」无效，请使用 YYYY-MM-DD（也支持 YYYY/MM/DD 和 Jira d/MMM/yy）`);
}
const statuses:Record<string,Status>={todo:'todo','to do':'todo',backlog:'todo',open:'todo',new:'todo',待办:'todo',待开始:'todo',未开始:'todo',active:'active','in progress':'active',doing:'active',进行中:'active',处理中:'active',blocked:'blocked',受阻:'blocked',阻塞:'blocked',review:'review','in review':'review',testing:'review',验收中:'review',评审中:'review',待验收:'review',done:'done',closed:'done',complete:'done',completed:'done',已完成:'done',完成:'done',已关闭:'done'};
const priorities:Record<string,Priority>={low:'low',lowest:'low',低:'low',p3:'low',p4:'low',medium:'medium',normal:'medium',中:'medium',普通:'medium',p2:'medium',high:'high',highest:'high',critical:'high',高:'high',紧急:'high',p0:'high',p1:'high'};

/** File interchange only. No third-party account access or synchronization occurs. */
export function parseTasksCSV(text:string,projectId:string):Task[]{
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(projectId))throw new Error('项目 ID 无效');
  const rows=parseRows(text);if(rows.length<2)throw new Error('CSV 需要表头和至少一条数据');
  const columns=rows[0].map(h=>headers[norm(h)]);
  if(!columns.includes('title'))throw new Error('未找到任务名称列（title / Summary / 任务名称）');
  if(!columns.includes('due'))throw new Error('未找到截止日期列（due / Due date / 截止日期）');
  const known=columns.filter(Boolean);if(new Set(known).size!==known.length)throw new Error('CSV 存在指向同一字段的重复表头');
  const ids=new Set<string>();
  return rows.slice(1).map((cells,i)=>{
    const row=i+2;if(cells.length!==columns.length)throw new Error(`第 ${row} 行列数与表头不一致`);
    const v:Partial<Record<keyof Task,string>>={};cells.forEach((cell,j)=>{if(columns[j])v[columns[j]]=cell.trim();});
    const id=v.id||`${projectId}-import-${i+1}`;
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)||ids.has(id))throw new Error(`第 ${row} 行 ID 无效或重复`);ids.add(id);
    if(!v.title||v.title.length>500)throw new Error(`第 ${row} 行任务名称为空或过长`);
    let due:string,start:string;try{due=dateValue(v.due||'');start=dateValue(v.start||v.due||'');}catch(e){throw new Error(`第 ${row} 行：${(e as Error).message}`);}
    if(due<start)throw new Error(`第 ${row} 行截止日早于开始日`);
    const status=statuses[(v.status||'todo').toLowerCase()];if(!status)throw new Error(`第 ${row} 行状态「${v.status}」尚不支持，请映射为 todo / active / blocked / review / done`);
    const priority=priorities[(v.priority||'medium').toLowerCase()];if(!priority)throw new Error(`第 ${row} 行优先级无效`);
    const acceptedRaw=(v.accepted||'false').toLowerCase();if(!['true','false','1','0','yes','no','是','否'].includes(acceptedRaw))throw new Error(`第 ${row} 行验收通过必须为 true / false`);
    const dependencies=(v.dependencies||'').split(/[;,|，；]/).map(s=>s.trim()).filter(Boolean);
    if(new Set(dependencies).size!==dependencies.length||dependencies.some(d=>!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(d)))throw new Error(`第 ${row} 行依赖 ID 无效或重复`);
    if((v.owner||'').length>200||(v.vendor||'').length>200||(v.acceptance||'').length>5000||(v.evidence||'').length>10000)throw new Error(`第 ${row} 行内容超过长度限制`);
    return {id,projectId,title:v.title,owner:v.owner||'',vendor:v.vendor||'',status,priority,start,due,dependencies,acceptance:v.acceptance||'',accepted:['true','1','yes','是'].includes(acceptedRaw),evidence:v.evidence||''};
  });
}

/** Neutralizes formula-leading fields when opened in spreadsheet software.
 * The apostrophe remains visible in generic CSV readers by design. */
export function exportTasksCSV(tasks:Task[]):string {
  const columns:(keyof Task)[]=['id','title','owner','vendor','status','priority','start','due','dependencies','acceptance','accepted','evidence'];
  const quote=(value:unknown)=>{let s=String(value);if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return '\uFEFF'+[columns.join(','),...tasks.map(t=>columns.map(c=>quote(c==='dependencies'?t.dependencies.join(';'):t[c])).join(','))].join('\r\n');
}
