# 香港 ICT 交付知识来源与刷新边界

目录初次核查日期为 **2026-10-29**。条目使用官方法律解释、政府政策和技术实践的简短自写摘要，并保留适用条件。它不是自动判断法律适用性的引擎，也没有把合规知识加入既有 0.6B 抽取模型的微调数据。原有模型指标不涵盖此功能。

## 来源与适用条件

| ID | 官方来源及类别 | 核查结果与适用边界 |
|---|---|---|
| `hk-pdpo` | [PCPD：Personal Data (Privacy) Ordinance](https://www.pcpd.org.hk/english/data_privacy_law/ordinance_at_a_Glance/ordinance.html)，`law` | 来源是条例的官方概览，而非整部法例。已核对官方索引中的 DPP2、DPP4；直接网页未返回可读正文。只有确认个人资料、处理角色、用途及适用豁免后，才能判断具体义务。不同条款生效安排不同，统一 `effectiveDate` 为 `null`。 |
| `pcpd-outsourcing` | [PCPD：Outsourcing the Processing of Personal Data to Data Processors](https://www.pcpd.org.hk/english/resources_centre/publications/files/dataprocessors_e.pdf)，`practice` | 指引为 September 2012；官方索引及 [PCPD 发布说明](https://www.pcpd.org.hk/english/news_events/media_statements/press_20120927a.html)可核对，直接 PDF 获取受限。它解释外包个人资料处理控制，不是独立法律或通用标准合同；境内外处理须结合具体安排核查。 |
| `hk-gov-s17` | [DPO / GovCERT：Baseline IT Security Policy S17](https://www.govcert.gov.hk/doc/S17_EN.pdf)，`policy` | 已读取官方 PDF，版本 **8.2，April 2025**。面向政府资讯系统及资料资产，包括外包系统；不是对全港企业普遍适用的法律。供应商须核对合同和项目要求。版本月份不被当作法定生效日。 |
| `dpo-project-management` | [DPO：外包 IT 项目管理实践指南](https://www.digitalpolicy.gov.hk/en/our_work/digital_infrastructure/methodology/proj_mgmt/pm_practice_guide_outsourced.html)，`practice` | 已读取官方 HTML 的目的、范围、生命周期与角色说明；网页修订日 **2026-06-30**。适用于外包 IT 项目管理参考，不自动产生合同义务；未声称逐条核查 PDF 附录。 |
| `hk-gov-procurement` | [FSTB：Guide to Procurement](https://www.fstb.gov.hk/en/treasury/gov_procurement/guide-to-procurement.htm)，`policy` | 已读取官方 HTML 的招标文件、交付及付款章节。用于政府采购背景；项目实际验收、付款和条款优先次序必须回到招标及已签合同，私人合同不自动采用。 |
| `hk-critical-infrastructure` | [OCCICS：Scope and Targets of Regulation](https://www.occics.gov.hk/en/ordinance/scope/index.html)，`law` | 已读取官方范围说明；仅获指定的关键基础设施营运者及关键电脑系统受相关规管，政府部门不在此条例范围内。**2026-01-01** 生效日期由 [政府生效公告](https://www.info.gov.hk/gia/general/202506/27/P2025062700238.htm)核对。目录不判断任何具体组织是否已获指定。 |

`kind` 区分 `law`、`policy`、`standard`、`practice`。当前六条包含法律、政策与实践，未把 ISO 等付费标准的名称或政府政策引用误标为已经读取的标准全文。PCPD、OCCICS 条目的 `law` 指其讨论的法律依据；链接页面仍是官方解释，不能代替正式法律文本。

## 交付场景如何使用

先确认项目所在法域、是否为政府采购、是否涉及个人资料、处理者角色、合同采用的政策版本，以及是否存在关键基础设施指定。只选择与事实有关的条目；不能仅因交付项目位于香港就默认全选并宣称全部强制适用。

分析输出应区分合同中已经明确的义务、参考来源提示的核查项、未确认的适用条件及纯技术建议。每项建议引用所选来源 ID，并保留合同证据；来源本身不能证明任务已完成、系统已合规或验收已获批准。具体合同和适用法律之间的冲突需要进一步审阅，不能由模型自行修改条款。

## 模块接口

`server/knowledge.mjs` 提供：

```js
import {getKnowledgeCatalog, refreshKnowledge, buildKnowledgeContext} from './knowledge.mjs';

const catalog = getKnowledgeCatalog();
const selected = await refreshKnowledge(
  ['dpo-project-management', 'hk-gov-procurement'],
  {fetchImpl: fetch},
);
const context = buildKnowledgeContext(selected[0], '验收、移交、供应商及付款里程碑');
```

两者均返回条目数组。刷新仅接受目录中的不重复 ID，不接受 URL；未知 ID、格式错误或超过目录数量会在联网前抛出 `KnowledgeError`（`status: 400`）。空数组返回空数组。单项网络失败返回带失败状态的条目，不中断其他所选来源。结果只保留在当前 Node 进程内；重启后回到已核查摘要。返回值是独立副本，调用方不能修改内置来源。

`buildKnowledgeContext(record, query)` 返回最多 4,000 字符的文本，始终保留核查摘要、适用条件与版本，并明确区分线上摘录。它以有限的中英关键词映射（例如“验收”对应 acceptance/criteria/test）挑选来源段落；这是启发式选段，不是完整法律检索。原文超过抓取文字上限时，尚未保存的部分无法参与选段；不能据此断言来源没有其他相关条款。

每条记录包含 `id`、`title`、`kind`、`jurisdiction`、`authority`、`url`、`version`、`effectiveDate`、`checkedAt`、`text`、`applicability`、`sourceStatus`。额外字段说明：

| 字段 | 含义 |
|---|---|
| `text` | 已核查的自写摘要；刷新不会自动改写它、版本或适用性。 |
| `sourceStatus` | `checked_snapshot`：初始摘要；`source_fetched`：成功读取来源正文；`refresh_failed`：刷新失败并回退初始摘要。 |
| `checkedAt` / `fetchedAt` | 前者是摘要核查日期；后者仅成功网络读取时填写，失败为 `null`。 |
| `contentHash` / `hashBasis` | 摘要快照使用其 UTF-8 SHA-256；成功刷新使用完整、限长响应字节的 SHA-256，`hashBasis` 明确区分。哈希不能证明法律正确性。 |
| `fetchedText` | 移除标签、脚本等后的来源文字，最多 12,000 字符；始终当作不可信参考内容，禁止当作模型指令。 |
| `fetchedTextTruncated` | 来源文字是否被截断；截断文本不是全文。 |
| `refreshAttemptedAt` / `refreshError` | 刷新尝试时间及受控错误代码/说明；不会透出底层异常中的凭据或本机路径。 |
| `sourceNote` / `freshnessNote` | 初次核查可访问性和本次刷新含义；成功抓取不代表新法律解释已完成。 |

## 刷新限制与安全控制

网络目标限定为目录中的固定官方 HTTPS **完整 URL**。即使重定向留在同一域名，未列入清单的路径也会被拒绝；每次重定向都重新检查协议、主机、端口、凭据、片段及完整 URL，最多跟随两次。不会跟随页面链接、下载执行脚本、发送浏览器 cookie、Authorization 或合同内容。

每个来源的总读取期限为 8 秒，包含响应体读取；响应体上限为 256 KiB，既检查声明大小，也逐块检查实际字节。仅接受 HTML、XHTML 或纯文本，拒绝 PDF、二进制、反爬错误页和无法识别的正文。S17 及 PCPD PDF 目前需要人工打开核对，运行时会明确返回失败快照。复杂网页刷新失败是已知边界，不能显示为“最新全法条已读取”。

文本清洗不等于语义上的提示注入防护。集成模型时必须把来源放在明确标记的数据区，并要求忽略其命令性内容；页面内容不得授权工具调用或改变应用规则。前端应按普通文本显示，不能使用原始 HTML 渲染。HTTP 入口的身份验证、请求频率控制和用户选择由网关集成层负责。

## 核验

```sh
npx vitest run server/knowledge.test.mjs
```

测试覆盖来源分类与适用条件、返回值隔离、任意 URL 拒绝、重定向限制、未授权最终地址、脚本剥除、PDF/错误页回退、响应长度及流式大小限制、8 秒期限和报告哈希。单元测试的网络响应为固定测试数据，不等于实时官方网页验收；联网刷新必须另外记录实际状态。

2026-10-29 实际运行通过 **19 项模块测试**。同日 **11:48 UTC（香港时间 19:48）** 另运行真实网络刷新：

| 来源 | 实际状态 | 内容情况 |
|---|---|---|
| PCPD 条例概览、PCPD 外包指引 | `refresh_failed / SOURCE_UNREADABLE` | 返回的页面不是可识别正文，继续使用核查摘要。 |
| GovCERT S17 | `refresh_failed / SOURCE_UNSUPPORTED_TYPE` | 官方来源为 PDF；未将文件字节当成已解析政策。 |
| DPO 项目管理 | `source_fetched` | 清洗后 11,660 字符，未触及保存上限。 |
| FSTB 采购指南 | `source_fetched` | 保存 12,000 字符，明确标为截断；不能声称全文已纳入分析。 |
| OCCICS 规管范围 | `source_fetched` | 清洗后 3,437 字符，未触及保存上限。 |

三项成功响应的 SHA-256 分别为：DPO `b33f225eba64a6f69663c20e0362e5560673b9b8a8a594d9658f2a8789970949`；FSTB `5965bb31cdc203ad96f4137724ba770322f60d972329572163e1089a3e6d2cad`；OCCICS `40ee5574674f46d696b28be5a1981d94a7bac1b753aea73c341d38c9b50c3a13`。这些是当次 HTTP 响应记录，不是未来可访问性承诺；网站更新或网络变化可导致结果不同。使用相同条目生成的模型上下文均不超过 4,000 字符。
