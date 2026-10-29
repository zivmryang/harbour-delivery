import type {Workspace, Task, Status} from './types';

/** All organizations, people, costs and results are fictional demonstration data. */
export function seedWorkspace():Workspace {
  const task=(id:string,projectId:string,title:string,owner:string,status:Status,start:string,due:string,dependencies:string[],vendor:string,priority:Task['priority']='medium'):Task=>({id,projectId,title,owner,vendor,status,priority,start,due,dependencies,acceptance:'负责人确认检查清单完成，未关闭的重要问题有明确处理决定。',accepted:status==='done',evidence:status==='done'?`SIM-${id}：模拟验收记录（非真实客户成果）`:'',});
  return {
    version:1,asOf:'2026-10-29',
    projects:[
      {id:'harbourlink',name:'HarbourLink 网络升级',client:'HarbourLink Studio · 模拟客户',description:'6 个模拟站点的网络、视频与服务移交。以关键依赖、供应商协作和验收准备为核心。',budget:480000,spent:312000,target:'2026-11-13',category:'ICT Infrastructure'},
      {id:'civicflow',name:'CivicFlow 服务流程',client:'CivicFlow Collective · 模拟机构',description:'内部服务请求与周报流程试点，验证 AI 辅助整理与人工复核的实际边界。',budget:60000,spent:28000,target:'2026-11-20',category:'AI Workflow'},
      {id:'cloudbridge',name:'CloudBridge 迁移准备',client:'CloudBridge Workshop · 模拟客户',description:'系统迁移、回退演练和运维交接，关注测试证据及上线决策。',budget:180000,spent:186000,target:'2026-11-10',category:'Service Transition'},
    ],
    tasks:[
      task('HL-01','harbourlink','确认业务需求与交付范围','项目负责人 A','done','2026-10-19','2026-10-20',[],'内部团队'),
      task('HL-02','harbourlink','完成 6 站点勘察与接入清单','工程协调员 B','done','2026-10-21','2026-10-23',['HL-01'],'模拟网络供应商'),
      task('HL-03','harbourlink','确认交换机到货与设备预配置','供应商负责人 C','blocked','2026-10-24','2026-10-28',['HL-02'],'模拟网络供应商','high'),
      task('HL-04','harbourlink','复核网络与视频平台接口','集成负责人 D','active','2026-10-24','2026-10-30',['HL-02'],'模拟平台供应商','high'),
      task('HL-05','harbourlink','执行试点站点部署','工程协调员 B','todo','2026-10-31','2026-11-03',['HL-03','HL-04'],'模拟网络供应商'),
      task('HL-06','harbourlink','组织端到端 UAT 与缺陷关闭','测试负责人 E','review','2026-11-04','2026-11-07',['HL-05'],'联合测试组','high'),
      task('HL-07','harbourlink','确认服务支持与升级联系人','','todo','2026-11-04','2026-11-06',['HL-05'],'服务台'),
      task('HL-08','harbourlink','完成验收及服务移交','项目负责人 A','todo','2026-11-08','2026-11-13',['HL-06','HL-07'],'服务台','high'),
      task('CF-01','civicflow','访谈使用者并记录现状基线','流程负责人 F','done','2026-10-20','2026-10-23',[],'模拟机构'),
      task('CF-02','civicflow','定义数据字段、隐私与验收规则','流程负责人 F','done','2026-10-24','2026-10-26',['CF-01'],'模拟机构'),
      task('CF-03','civicflow','搭建周报与行动项工作流','自动化开发员 G','active','2026-10-27','2026-11-03',['CF-02'],'交付团队','high'),
      task('CF-04','civicflow','执行异常输入与来源追溯测试','测试负责人 H','todo','2026-11-04','2026-11-07',['CF-03'],'交付团队'),
      task('CF-05','civicflow','试用、测量与用户培训','流程负责人 F','todo','2026-11-08','2026-11-16',['CF-04'],'模拟机构'),
      task('CF-06','civicflow','确认业务效果并移交维护','项目负责人 I','todo','2026-11-17','2026-11-20',['CF-05'],'模拟机构'),
      task('CB-01','cloudbridge','确认应用清单与迁移边界','迁移负责人 J','done','2026-10-19','2026-10-22',[],'模拟云服务商'),
      task('CB-02','cloudbridge','完成备份与恢复验证','技术负责人 K','active','2026-10-23','2026-10-28',['CB-01'],'模拟云服务商','high'),
      task('CB-03','cloudbridge','协调切换窗口与通知计划','迁移负责人 J','active','2026-10-23','2026-10-30',['CB-01'],'模拟业务团队'),
      task('CB-04','cloudbridge','执行迁移与回退演练','技术负责人 K','todo','2026-10-31','2026-11-04',['CB-02','CB-03'],'模拟云服务商','high'),
      task('CB-05','cloudbridge','完成用户确认与监控交接','服务负责人 L','todo','2026-11-05','2026-11-07',['CB-04'],'服务台'),
      task('CB-06','cloudbridge','批准正式切换与移交','迁移负责人 J','todo','2026-11-08','2026-11-10',['CB-05'],'模拟业务团队','high'),
    ],
    risks:[
      {id:'RAID-HL-01',projectId:'harbourlink',title:'设备到货延迟影响试点部署',type:'issue',owner:'供应商负责人 C',impact:3,likelihood:3,status:'open',mitigation:'今天确认可交付批次，评估分站点实施方案；由项目负责人批准计划变更。',taskId:'HL-03'},
      {id:'RAID-HL-02',projectId:'harbourlink',title:'视频平台接口版本待联合验证',type:'risk',owner:'集成负责人 D',impact:3,likelihood:2,status:'mitigated',mitigation:'保留联调环境并安排两家供应商共同验证。',taskId:'HL-04'},
      {id:'RAID-CF-01',projectId:'civicflow',title:'旧纪要可能缺少行动项负责人',type:'assumption',owner:'流程负责人 F',impact:2,likelihood:3,status:'open',mitigation:'缺失值输出为待确认，禁止模型自行指定负责人。',taskId:'CF-03'},
      {id:'RAID-CB-01',projectId:'cloudbridge',title:'恢复演练未完成，不能批准切换',type:'dependency',owner:'技术负责人 K',impact:3,likelihood:2,status:'open',mitigation:'取得恢复时间及完整性测试记录后再进行上线评审。',taskId:'CB-02'},
    ],
    measurements:[
      {id:'MET-HL-01',projectId:'harbourlink',label:'模拟：一份周报的编制与复核',before:60,after:38,beforeErrors:3,afterErrors:1,sampleSize:10,reviewer:'模拟评审员',date:'2026-10-28',provenance:'simulation'},
      {id:'MET-HL-02',projectId:'harbourlink',label:'模拟：会议行动项整理',before:25,after:18,beforeErrors:2,afterErrors:1,sampleSize:10,reviewer:'模拟评审员',date:'2026-10-28',provenance:'simulation'},
      {id:'MET-CF-01',projectId:'civicflow',label:'模拟：服务请求分类',before:18,after:11,beforeErrors:4,afterErrors:2,sampleSize:12,reviewer:'模拟使用者',date:'2026-10-27',provenance:'simulation'},
      {id:'MET-CF-02',projectId:'civicflow',label:'模拟：业务报告复核',before:45,after:34,beforeErrors:2,afterErrors:1,sampleSize:12,reviewer:'模拟使用者',date:'2026-10-27',provenance:'simulation'},
      {id:'MET-CB-01',projectId:'cloudbridge',label:'模拟：迁移问题归纳',before:40,after:29,beforeErrors:2,afterErrors:1,sampleSize:10,reviewer:'模拟工程师',date:'2026-10-28',provenance:'simulation'},
      {id:'MET-CB-02',projectId:'cloudbridge',label:'模拟：移交清单整理',before:30,after:22,beforeErrors:3,afterErrors:1,sampleSize:10,reviewer:'模拟工程师',date:'2026-10-28',provenance:'simulation'},
    ],briefs:[],audit:[],
  };
}
