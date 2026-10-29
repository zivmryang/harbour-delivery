# Synthetic import samples

All organizations, names, budgets and measurements in these files are fictional. These files are import examples, not production records or validated performance benchmarks.

- `demo-workspace.json`: a complete version 1 workspace, including 3 projects, 20 tasks, RAID records, and explicitly simulated measurements. Import as a workspace backup.
- `tasks.csv`: the generic downloadable task template, containing a synthetic four-task delivery chain with valid predecessor references.
- `jira-tasks.csv`: a Jira-shaped file interchange sample. It does not connect to a Jira account. A `Done` status is preserved, but acceptance approval/evidence remains empty until the user reviews it.
- `feishu-tasks.csv`: a Chinese-header file interchange sample. It is not a native Feishu API integration or a guarantee that every tenant's custom export matches these headers.

CSV imports require a task title and due date. Accepted date formats are `YYYY-MM-DD`, `YYYY/MM/DD`, and Jira `d/MMM/yy`. A missing start date is set to the due date, producing a one-day placeholder for review. Unrecognized statuses are rejected; map them to `todo`, `active`, `blocked`, `review`, or `done`. Unknown columns are ignored. Dependencies use semicolon-separated IDs and must reference tasks within the same project when the workspace is validated.

Exported CSV neutralizes formula-leading text using an apostrophe. Generic CSV readers will preserve that apostrophe. Use the JSON backup for lossless archival and restoration.

The CPM engine uses inclusive calendar-day durations and finish-to-start dependencies. It does not perform resource levelling, working-day calendars, deadline constraints, or native MPP/P6 scheduling. Treat it as a dependency analysis aid, not a replacement for specialist engineering scheduling software.
