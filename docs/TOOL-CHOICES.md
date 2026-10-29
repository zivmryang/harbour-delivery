# Tool choices and interoperability

Decision date: 29 October 2026.

Harbour Delivery is an open-source workspace for **Hong Kong ICT handover and delivery**, including task control, dependency analysis, supplier coordination, acceptance records, source-linked reporting and human review of AI outputs. This document maps project-management patterns to the implemented features and file formats. It is not a Hong Kong market-share ranking, a claim to replace the referenced products, or an official integration with them.

The current application is a single-browser workspace with JSON backup, CSV interchange and a separately configured AI gateway. There is no shared team database, identity provider, enterprise permission model or live synchronization with any project-management vendor.

## Hong Kong reference environment

Priorities are based on the intended ICT delivery workflow and specific published examples, not an assumption that every globally popular tool is widely adopted in Hong Kong.

| Reference environment | Local evidence and its limits | Priority for Harbour |
|---|---|---|
| Microsoft 365 collaboration; Project / Planner as planning candidates | A [Microsoft Hong Kong report dated 20 June 2022](https://news.microsoft.com/en-hk/2022/06/20/the-hong-kong-management-association-and-microsoft-hong-kong-showcase-technology-excellence-innovation-and-resilience/) describes ZA Bank using Teams to collaborate on files and share project status, and CLP using Microsoft 365. These are historical vendor-published examples; they do not establish adoption of Project or Planner, current market share, or a client's present licensing. | Design exportable plans, status reports, action lists and evidence references that can fit a client's Microsoft environment. Project and Planner remain separate planning candidates to confirm with that client. No Teams, SharePoint or Graph connector is implemented. |
| Jira / Confluence software delivery | [Appnovation's Hong Kong Jockey Club case study](https://www.appnovation.com/work/hkjc-winning-the-digital-horse-race-with-agile) describes an Atlassian deployment including Jira and Confluence, with cross-team development workflows. It is a delivery partner's historical case study with no publication date displayed; it is not proof of the current configuration or territory-wide adoption. | Retain stable work IDs, dependencies, source requirements and acceptance evidence. Current interoperability is limited CSV mapping; work-item hierarchy, Confluence content exchange and account synchronization remain unimplemented. |
| Hong Kong Government outsourced IT governance | The [DPO practice guide](https://www.digitalpolicy.gov.hk/en/our_work/digital_infrastructure/methodology/proj_mgmt/pm_practice_guide_outsourced.html) and its [appendices](https://www.digitalpolicy.gov.hk/en/our_work/digital_infrastructure/methodology/proj_mgmt/doc/Appendices_to_Practice_Guide_to_Project_Management_v2.1a.pdf) describe lifecycle controls, customer/contractor roles, change requests and highlight reporting. This is a management method, not a software product or automatic contract obligation. | Prioritize tender-to-delivery handover, contractual deliverables, named authority, baseline/change control and acceptance evidence. Government policy references are selected for the relevant project, not imposed on every private-sector Hong Kong contract. |

Smartsheet, monday and Asana remain useful feature-design references. This review has not established their relative Hong Kong adoption, so they are not presented as a local popularity ranking. Primavera is relevant only when a client's engineering/programme scheduling requirement calls for it. Mainland collaboration products are optional client-specific interchange targets, not the default reference environment for this Hong Kong ICT prototype.

The intake now offers explicit Hong Kong enterprise and government-outsourced-IT presets. Applying a preset updates the jurisdiction, project type and selected official references; it keeps uploaded project documents and user-supplied technical references. The enterprise preset selects the DPO guide as voluntary practice. The government preset additionally selects S17 and procurement guidance for review. Personal-data and designated-critical-infrastructure sources require deliberate selection against project facts. A preset does not establish legal applicability, contractual priority or compliance.

English and Traditional Chinese client reports, explicitly labelled Hong Kong timestamps, agreed working-day/site-access calendars and client-system integrations are further localization requirements to assess. The current UI remains primarily Simplified Chinese, briefing language options remain as documented, scheduling uses calendar days, and named approvers are local records rather than verified identities. Do not describe the prototype as a fully localized enterprise deployment.

## What was selected, and why

| Tool or product family | Management pattern considered | What Harbour Delivery implements | Current interchange boundary |
|---|---|---|---|
| Jira | Explicit issue states, accountability and traceable work records | Task IDs, owners, priorities, status transitions, dependency checks and completion gates | Reads selected Jira-shaped CSV headers, including Issue key, Summary, Assignee, Status and Due date. No Jira OAuth, API, issue creation or bidirectional sync. |
| Linear | A focused, quick-to-navigate task workflow | A compact board, search and direct task editing | Generic CSV after explicit field/status mapping. No Linear connection or imported workspace metadata. |
| Redmine | Controlled work tracking and inspectable records | Source code, local records and exportable operational history | Generic CSV only. No Redmine plugin, server or REST integration. |
| 禅道 / Zentao | Relationships among requirements, work, defects and verification | Acceptance criteria and evidence associated with delivery tasks | Generic/Chinese-header CSV. Separate native requirement, defect and test-case objects are not implemented. |
| Notion | Keeping work context next to structured records | Evidence descriptions and referenced briefing sources | Generic task CSV or Harbour JSON backup. No Notion page/database API or general-purpose wiki. |
| Asana | Cross-functional ownership and multiple work views | Shared task data rendered as a board, table and timeline | Generic CSV after mapping; no Asana team, custom-field or portfolio synchronization. |
| monday.com | Visible operational records, plan baselines and repeatable control rules | Structured tasks, risk scores, rule findings, status visibility and local baseline comparisons | Generic CSV only; no monday automation recipes or account integration. |
| ClickUp | Reducing fragmentation between planning and work context | Planning, RAID, acceptance, briefings and measurements in one local workspace | Generic CSV only. No time-tracking integration, whiteboard, remote documents or connected goals. |
| Trello | Clear visual movement through work stages | A five-state board with drag/drop and a keyboard-accessible status selector | Generic task CSV; no native Trello JSON/card API. Completion is subject to acceptance gates. |
| Microsoft Project desktop | Reasoning about durations, predecessors and the critical path | Calendar-day finish-to-start CPM, slack, critical task highlighting and multiple local plan baselines with date/budget comparisons | Export relevant task columns to CSV, then map headers. Native `.mpp`, resource levelling, work calendars and earned-value calculations are not supported. Baseline comparison is between recorded plans, not actual-progress variance. |
| Microsoft Planner | Team work planning and clear task ownership | Owner/status views and a project-level delivery summary | Generic CSV after conversion/mapping. No Microsoft Graph, Teams, Planner or Power Platform integration. |
| Smartsheet | Structured project control and comparable reporting | Project budget/spend fields, RAID, task evidence and workflow measurement records | Generic CSV or Harbour JSON. No Smartsheet sheet/report API or enterprise PPM capacity planning. |
| Oracle Primavera P6 | Dependency analysis for complex delivery | A limited calendar-day FS dependency analysis useful for demonstrating planning decisions | Generic task CSV only; `.xer` and native P6 XML are not supported. This engine is not suitable as the sole schedule of a large EPC programme. |
| 飞书项目 / 飞书 OKR / 多维表格 | Structured collaboration, ownership and linked records | Chinese task headers, task-to-risk links and source-linked briefings | Selected Chinese CSV headers are recognized. No Feishu/Lark API, messaging, OKR engine or live table synchronization. These products are not treated as interchangeable. |
| Teambition / 钉钉项目 | Combining task work with organizational process | Status transitions, role ownership and local operational history | Generic/Chinese-header CSV only; no DingTalk/Teambition account, approval, attendance or messaging integration. |
| 蓝凌 / 泛微项目模块 | Traceability through enterprise workflows | Recorded task changes, acceptance fields and human-review state | Generic CSV when a suitable authorized export exists. No OA workflow engine, SSO, signature, procurement approval or enterprise audit certification. |

The initial implementation focuses on a coherent delivery workflow. Connecting additional vendors would introduce separate credentials, permissions, tenant-specific schemas and synchronization behavior. Such integrations should follow a concrete operational requirement and an end-to-end validation plan.

## Official workflow references and implementation decisions

The following official product documentation was reviewed on 29 October 2026. These are references for workflow design, not evidence of equivalent functionality or vendor connectivity in Harbour.

| Official reference | Verified product behavior | Decision for Harbour |
|---|---|---|
| [Microsoft Project desktop baselines](https://support.microsoft.com/en-us/project/set-and-save-a-baseline) | A baseline preserves a project-plan snapshot for later comparison; desktop Project supports multiple saved baselines. | Keep earlier Harbour snapshots when creating a new version. Do not attribute this desktop feature to Planner or claim `.mpp` compatibility. |
| [Smartsheet baselines](https://help.smartsheet.com/articles/2482093-baselines) and [dependency scheduling](https://help.smartsheet.com/articles/765727-enabling-dependencies-using-predecessors) | Baseline dates and variance support plan comparison; dependency scheduling can adjust successor dates. | Show baseline/current bars and offer a separate downstream-shift preview. Harbour uses calendar-day FS only, does not move completed tasks, and requires a recorded decision before application. |
| [monday Gantt chart](https://support.monday.com/hc/en-us/articles/360015643840-The-Gantt-Chart-View-and-Widget) | A baseline keeps a fixed snapshot for comparison after timeline changes. The Gantt can show dependencies, critical paths and milestones. | Add selectable local baseline versions and compare current planned dates and budget against a selected snapshot. Do not imply parity with monday scheduling or resource management. |
| [monday project boards](https://support.monday.com/hc/en-us/articles/22598441769746-Project-boards-on-monday-com) | Project boards supply structured fields for ownership, dependencies, duration, effort and budget. The documented Enterprise creation flow can generate a project outline from a prompt. | Keep AI output connected to structured project records. A generated description alone is insufficient for initialization; unknown dates, ownership and estimates require review. |
| [Asana Smart Projects](https://help.asana.com/s/article/smart-projects) | AI suggests a description, sections and custom fields. Users preview the result, edit it or retry before creating a project. | Retain Harbour's proposal, review and explicit creation stages. This iteration adds control of subsequent plan changes rather than a separate chat interface. |
| [Jira work items and subtasks](https://support.atlassian.com/jira-software-cloud/docs/create-a-work-item-and-a-subtask/) | AI can suggest child work items from a parent; users accept, edit or decline suggestions, and accepted items link to the parent. | Deliverable-to-task hierarchy and per-item adoption of AI suggestions remain proposed follow-up work. Harbour currently has flat execution tasks and does not claim Jira hierarchy support. |
| [Asana approval tasks](https://help.asana.com/s/article/how-to-use-approvals) | Approval tasks distinguish approval, requests for changes and rejection. | Separate acceptance-decision objects and an explicit remediation loop remain proposed follow-up work. Existing task acceptance fields must not be described as a complete approval workflow. |

### Scope of this iteration

- **Versioned plan baselines:** preserve multiple named snapshots of the project's target, budget and task records, with a recorded reviewer, reason and timestamp. Compare a selected snapshot with the current plan to identify added, removed or changed tasks and planned-date/budget differences. The application preserves earlier snapshots when adding a version; the browser data and exported JSON remain editable.
- **Controlled schedule and budget changes:** record a proposed date/budget patch, its reason, requester and original plan; preview its effect before a reviewer applies or rejects it. Keep the decision and note as local records. This scope changes planned dates and budget; it does not create actual expenditure or certify work performed.
- **Plan-to-plan comparison:** a later planned finish is a change in the recorded schedule, not proof that actual work is late. These records do not provide actual-start/actual-finish tracking, earned value, resource levelling or a working-day calendar.

Typed names and local decision records are not authenticated organizational approvals, electronic signatures or an immutable audit trail. These controls support an inspectable single-user workflow; shared identities, access permissions and authoritative approval routing require a separate backend. CSV remains task-only interchange; use Harbour JSON backup to retain baseline and change records.

The priority is to retain the reviewed starting plan and make subsequent changes explainable. Deliverable hierarchy and richer acceptance decisions are intentionally listed as recommendations, not implemented features.

## Microsoft product names need to be separated

Microsoft Project desktop, Project for the web, Project Online and Planner are different products/services. Microsoft's current FAQ says Project for the web transitioned to Planner in August 2025 and lists Project Online retirement on 30 September 2026. It also explains that importing desktop `.mpp` files is not a general capability of Planner itself. Those lifecycle changes do not mean this project can replace Project desktop or import its files. Source: [Microsoft Planner FAQ](https://support.microsoft.com/en-us/planner/frequently-asked-questions-about-microsoft-planner).

For Harbour, “Project-style planning” refers to the limited dependency calculation and local plan comparisons documented above. Dates shown in the timeline come from task records; CPM calculates a theoretical duration from inclusive task durations and dependencies. The CPM calculation does not automatically reschedule tasks. A separately reviewed date/budget change can update the current plan, while saved baseline versions retain the earlier planned dates and budget. This does not add native Project file import, actual-progress variance, resource levelling or earned-value calculations.

## Actual CSV contract

Download [`tasks.csv`](../public/samples/tasks.csv), [`jira-tasks.csv`](../public/samples/jira-tasks.csv) or [`feishu-tasks.csv`](../public/samples/feishu-tasks.csv). These are synthetic examples, not vendor exports from a connected account.

| Harbour field | Recognized example headers | Treatment |
|---|---|---|
| `id` | `id`, `Issue key`, `Task ID`, `任务编号` | Stable ID; duplicate IDs are rejected. A missing ID gets a generated project/row ID. |
| `title` | `title`, `Summary`, `Name`, `任务名称`, `工作项名称` | Required. |
| `owner` | `owner`, `Assignee`, `Assigned to`, `负责人`, `经办人` | Stored as text, not resolved against any vendor directory. Empty ownership is flagged. |
| `vendor` | `vendor`, `Supplier`, `供应商` | Optional text. |
| `status` | `status`, `State`, `状态`, `工作项状态` | Recognized labels map to `todo`, `active`, `blocked`, `review`, `done`. Unknown states are rejected for deliberate review. |
| `priority` | `priority`, `优先级` | Maps recognized low/medium/high labels, including common P0–P4 values. |
| `start` | `start`, `Start date`, `开始日期`, `计划开始时间` | If absent, uses the due date as a one-day placeholder. Review the imported schedule. |
| `due` | `due`, `Due date`, `Finish`, `截止日期`, `计划结束时间` | Required; accepts `YYYY-MM-DD`, `YYYY/MM/DD`, or `d/MMM/yy`. |
| `dependencies` | `dependencies`, `Predecessors`, `前置任务`, `依赖` | Semicolon-separated task IDs are recommended. References must remain within the selected project. |
| `acceptance` | `acceptance`, `Acceptance criteria`, `验收标准` | Required before a task can pass the completion gate. |
| `accepted` | `accepted`, `验收通过` | Explicit true/false-style values; defaults to false. A Done label does not create approval. |
| `evidence` | `evidence`, `验收证据`, `证据` | A record reference or explanation; the application does not verify an external file or signature. |

Jira itself supports field mapping and configured date formats in its CSV import workflows. Harbour's smaller parser is its own contract and does not claim parity with every Jira import/export option. Importing Harbour output back into Jira requires the target system's mapping and permissions. Source: [Atlassian CSV import documentation](https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/).

Unknown CSV columns are ignored. Attachments, comments, change histories, custom fields and vendor access controls do not survive this task-only interchange. Use JSON backup for a lossless Harbour workspace round trip. CSV exports prefix formula-leading text with an apostrophe; generic CSV readers may display that character.

## Representative scenarios and validation

The application was developed with AI assistance. Its tests cover specific scheduling, completion, import and reporting behavior; model experiments retain configuration, predictions and failure cases for inspection. These records support reproducibility within the documented scope.

The three simulated scenarios exercise infrastructure rollout, workflow improvement and service transition. Their organizations, task records, budgets and workflow measurements are fictional examples. They are not production data or validated business-performance benchmarks.

For an organizational pilot, agree a bounded workflow, accountable owner, actual users, data permissions, baseline measurements, acceptance criteria and handover arrangements. Measure outcomes with representative inputs and retain the underlying observations. Keep pilot results separate from the bundled synthetic data and model benchmark results.

## Next integration gate

Add a real connector only after a pilot identifies the actual system of record. Before claiming it is complete, verify authentication, minimum scopes, pagination, custom-field mapping, stable IDs, update conflicts, failure/retry behavior and an authorized end-to-end account test. Until then, UI and documentation should say “CSV interchange” or “pattern reference,” never “connected.”
