# Handover document engine

The engine proposes a project configuration from supplied tender, contract, statement-of-work and handover text, plus selected knowledge snapshots. The result is always a draft. It does not create a project, approve obligations, establish legal applicability or determine document priority.

## Entry point

```js
import {generateHandoverDraft, HandoverError} from './server/handover.mjs';
const draft = await generateHandoverDraft(input, {
  ollamaUrl: 'http://127.0.0.1:11434',
  handoverModel: 'qwen3:8b',
  handoverTimeoutMs: 180000,
  // Optional cloud provider, server side only:
  apiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
  handoverOpenaiModel: process.env.HANDOVER_OPENAI_MODEL,
}, {signal: abortController.signal, onProgress: console.log});
```

`fetchImpl` can be injected for tests. Production calls use the real model transport. There is no fabricated result or fallback from an unavailable model to a template.

Input:

```ts
{
  provider: 'ollama' | 'openai';
  projectContext: {
    jurisdiction: string; industry: string; projectType: string;
    kickoffDate: string | null; // YYYY-MM-DD, context only
  };
  documents: {id: string; name: string; kind: DocumentKind; text: string}[];
  knowledge: {
    id: string; title: string; kind: KnowledgeKind; jurisdiction: string;
    url: string | null; version: string | null;
    checkedAt: string | null; // YYYY-MM-DD
    text: string;
  }[];
}
```

`DocumentKind`: `tender`, `contract`, `statement_of_work`, `handover`, `other`.

`KnowledgeKind`: `policy`, `regulation`, `standard`, `best_practice`, `technical`, `industry`.

`HandoverError` exposes a safe `status`, `code` and `message` for the job gateway. Source/model content is not returned inside error messages. The job layer owns authentication, body limits, concurrency, cancellation routes, retention and the overall job deadline.

## Processing and provenance

1. Validate source IDs, metadata, dates and size limits. Document and knowledge IDs are globally unique. Knowledge URLs are metadata; this module never fetches them. Knowledge selection/refresh belongs to the gateway's separate curated-source workflow.
2. Preserve the original text, remove a leading BOM and C0 controls, and normalize CRLF/CR to LF. Repeated clauses are counted but retained. Page, paragraph and row markers supplied by the parser remain in the text. Both original and cleaned text receive SHA-256 hashes.
3. Split cleaned text into bounded, contiguous chunks. Prefer paragraph/line boundaries, preserve surrogate pairs and cover every character without truncation. Each chunk has a stable `sourceId#chunk-01` location and UTF-16 `start`/`end` offsets into `cleanedText`.
4. The server first creates exact source passages of at most 400 characters. Ask the model to classify and summarize parties, scope, requirements, obligations, deliverables, acceptance, payment, deadlines, risks and questions by selecting passage IDs. The model does not recopy quotations. Every passage must be represented, including metadata as `other`; missing passage IDs fail validation. Knowledge contributes candidate guidance. The server attaches exact original quotes. Coverage proves that passages were represented, not that the model understood every obligation inside them. A model-declared incomplete extraction fails validation.
5. Give the model the extracted requirements, source metadata, open questions and a verified quote registry. Ask it to synthesize the charter, WBS, milestones, risks, conflicts, questions and knowledge applicability. Internal citation keys are resolved to full `{sourceId, quote, location}` objects before returning the draft.
6. Validate fields, quotations, references, dependency integrity, cycles and selected explicit commercial evidence. Retain extraction-stage questions even when synthesis omitted them. Return the complete source audit and run metrics with `reviewRequired: true`.

The public result follows `src/handover-types.ts`. `requirements.citations`, `project.sourceRefs`, and other `sourceRefs` consistently contain citation objects. No frontend lookup depends on internal `C0001` keys.

The run record includes provider/model, start/end time, duration, actual call count, repair count and each extraction/synthesis attempt. It is metadata about processing, not proof that a contract was interpreted correctly. Tests use explicitly injected transports; they are not local-model evaluation results.

## Contract and knowledge boundaries

Unknown names, parties, amounts, owners, dates, durations and acceptance criteria must remain null. A kickoff date is user context. It does not authorize the model to calculate a binding final date from relative wording such as “30 days after acceptance of the design.” Such triggers require a review question.

Numeric project budgets require a monetary amount and consistent currency in project-document quotes; a site count is not budget evidence. A project target requires a final-delivery/acceptance/completion label near its date; a signature date is not target evidence. Contract task durations require a number with day units in a cited project document, and that evidence must not be explicitly labelled an unapproved draft, planning estimate or working-day period. A contract-origin task also needs at least one project-document citation that is not from an explicitly unapproved draft. These checks are deliberately conservative: amounts expressed with ambiguous units or dates with unclear triggers may need to remain null. They verify narrow evidence conditions, not general semantic correctness.

A task marked `origin: contract` must cite a project document. External guidance alone cannot establish a contract obligation. Recommendations have a separate origin and rationale. Policies and regulations that the model marks applicable are downgraded to potential applicability, with an explicit local-review requirement. Jurisdiction, source version and checked date are provided to the model, but metadata is not proof of current legal effect. A reviewer must decide applicability and any conflict with project terms.

The engine does not assume “contract overrides tender” or any other priority. Model-detected conflicts remain unresolved. A further deterministic check scans all cleaned document passages for **explicitly labelled** totals and final dates, independently of which facts the model chose to summarize. When these disagree, the draft budget/currency or target is set to null and a conflict plus question is added. This limited check will not detect every conflict, omitted clause, amendment, tax basis or different milestone scope. It may conservatively flag two differently scoped final dates; the reviewer resolves the distinction.

## Resource limits and failure behavior

| Limit | Value |
| --- | --- |
| Documents | 1–12 |
| Document text | 100,000 characters per file and total |
| Knowledge sources | At most 20 |
| Knowledge text | 12,000 per source, 40,000 total |
| Chunk | At most 4,200 UTF-16 characters |
| Exact quote | At most 400 characters |
| Extracted items/questions per chunk | 60 / 30 |
| Proposed tasks / milestones / risks | 150 / 80 / 100 |
| Final conflicts / unresolved questions | 100 / 200 |
| Individual model call | At most 180 seconds |
| Output validation repair | At most one extra call per stage/chunk |
| Synthesis input | Conservative estimate at most 22,000 tokens |

Large source sets are not silently truncated. If extracted requirements and quotes exceed the synthesis context budget, `HANDOVER_SYNTHESIS_TOO_DENSE` requests a smaller scope. Excess unresolved questions similarly fail with `HANDOVER_REVIEW_TOO_DENSE`. The original input limits are an acceptance ceiling, not a promise that every allowed source set fits one synthesis call.

Invalid model JSON, incomplete/truncated output, bad citations or invalid configuration cause one explicit repair attempt. The retry is recorded; a second failure rejects the draft. Provider failures, access errors, rate limits and timeouts do not trigger hidden fallback. A cancelled or failed run never returns a partial configuration for adoption.

Common error codes:

| Code | Meaning |
| --- | --- |
| `INVALID_HANDOVER_INPUT` | Source/context limits or fields invalid |
| `HANDOVER_PROVIDER_NOT_CONFIGURED` | Missing server-side cloud key/model |
| `HANDOVER_PROVIDER_UNAVAILABLE` | Configured service cannot be reached |
| `HANDOVER_PROVIDER_ERROR` | Provider rejected the request |
| `HANDOVER_PROVIDER_TIMEOUT` | Model call exceeded its deadline |
| `HANDOVER_VALIDATION_FAILED` | Model output failed structure/source checks after repair |
| `NO_EXTRACTABLE_REQUIREMENTS` | No grounded items found |
| `HANDOVER_CANCELLED` | Abort requested |
| `HANDOVER_SYNTHESIS_TOO_DENSE` | Complete extracted evidence exceeds synthesis context budget |
| `HANDOVER_REVIEW_TOO_DENSE` | Too many unresolved questions for one draft |

## Model transport and testing

Ollama uses `/api/chat` with a JSON schema, `stream: false`, `think: false`, temperature zero, a 16,384- or 32,768-token context selected from a conservative input-plus-output estimate, and bounded output (4,096 for extraction; 7,000 for synthesis). The handover model is configured separately from the small briefing model; the default is `qwen3:8b`.

OpenAI uses the fixed Responses API endpoint with server credentials, strict JSON-schema output and `store: false`. The selected provider receives the uploaded document and knowledge text. The application must keep provider selection visible and server secrets out of browser code.

```sh
npx vitest run server/handover.test.mjs
# Optional real local-model evaluation; may take several minutes:
node server/handover-smoke.mjs
```

The tests cover cleaning/chunk continuity, exact quotation and location, source limits, null handling, unsupported commercial values, dependency errors, legal-candidate handling, conflicting totals/dates, two-stage transport, one recorded repair, cancellation, provider error sanitization, fixed cloud transport and compatibility with the frontend runtime schema. They do not claim complete document understanding or replace representative document/model evaluation.

## Recorded local-model evaluation

The synthetic smoke runner uses all three files in `public/samples/handover/`, plus `hk-pdpo`, `pcpd-outsourcing` and `dpo-project-management`. It refreshes those curated sources, records any labelled snapshot fallback, and sends the resulting context to the real local Ollama model. Provider responses, elapsed times and token counts are preserved in `server/live-handover-*.json`. Only a complete result passing both server checks and the frontend runtime schema is written to `public/samples/handover/recorded-run.json`.

The first run started at `2026-10-29T11:58:05.679Z` and failed after **103,878 ms** and two real calls. Qwen3 8B changed `用户验收测试报告` to `用户验收和测试报告`; the repair attempt changed `设备序列号` to `设备序列命`. Exact quotation validation rejected both outputs. Review also found omitted amount/date summaries. No configuration was adopted. This prompted the passage-ID extraction and mandatory passage-coverage change; the quotation validator was not relaxed. Evidence: `server/live-handover-2026-10-29T11-58-05-679Z.json`.

The second run started at `2026-10-29T12:04:54.012Z` and was stopped after **157,104 ms**. Inspection revealed an implementation defect: a shared JSON-schema object caused the passage-ID enum to also constrain description text. Partial outputs were rejected; this run is not counted as a successful model evaluation. The schema fields now use independent objects, a regression assertion checks that description text is unconstrained, and validation rejects a description consisting only of a passage ID. Evidence: `server/live-handover-2026-10-29T12-04-54-012Z.json`.

The third fresh run (`2026-10-29T12:07:32.043Z`) successfully extracted all six sources in seven real calls, including one repair for an omitted passage. It then timed out during synthesis and ended after **504,996 ms**. No partial project was adopted. The seven exact provider outputs are the checkpoint used for the explicitly labelled recovery; they are revalidated under the current extraction rules on every recovery.

The first recovery (`2026-10-29T12:21:12.143Z`) made two new real synthesis calls, **157,544 ms** and **109,736 ms**. Both returned complete JSON but used source IDs instead of citation keys for project references. Both were rejected. The synthesis schema now constrains only `sourceRefs` to the known citation-key enum; dependency and milestone-task IDs retain their separate types. This regression is tested. These failed calls remain in `server/live-handover-resume-2026-10-29T12-21-12-143Z.json`.

`resumeFromVerifiedExtractions` is an offline evaluation recovery helper, not a public job API. It consumes original provider outputs in their original sequence, reruns extraction structure, coverage and exact-citation validation, and calls the model only for synthesis. It rejects missing/unused historical outputs and model mismatch. The configuration notices and separate `metadata.resumption` distinguish historical extraction timings from new live synthesis; a recovered result must never be described as a successful single uninterrupted run.

The second recovery (`2026-10-29T12:26:03.108Z`, see the exact evidence filename in recorded metadata) passed after **one new real synthesis call of 114,197 ms**: 7,353 prompt tokens and 1,718 output tokens. It reused and revalidated the seven real extraction calls, whose historical provider duration totals **324,244 ms**. The recorded draft passed the server evidence/structure checks and `validateHandoverConfiguration`: five tasks, 56 extracted items (including metadata/guidance), three conflicts and eight open questions. `metadata.singleUninterruptedRun` is false. The successful components must not be presented as a fresh single-run success or as all attempted processing time.

### Semantic review of the recorded draft

This is a usable **review specimen**, not an automatically approved configuration. The original configuration remains unchanged. `metadata.qualityReview` records these findings:

- The five core deliverables are present; all task durations and project budget/currency/target remain null. All three knowledge sources remain potential applicability. These are appropriate boundaries for the contradictory synthetic documents.
- D4/D5 and several risks cite early passages that establish some project context but do not include the detailed acceptance/risk statement. Exact quotation validation establishes provenance, not that the quoted passage supports every field.
- Acceptance summaries need fuller criteria: D1 must cover all six sites and equipment/lines/constraints; D2 must include topology, equipment configuration, migration and rollback; D4 must test networking, conference audio/video and rollback; D5 must include two trainings, attendance, a Chinese operations manual, configuration backups and handover inventory. These facts remain available in the source audit and requirements bank.
- D1→D2 and D4→D5 dependencies come from the explicitly unapproved task-book draft. Reviewers must treat them as proposed planning logic, not established contractual dependencies.
- Supplier/client owner-role suggestions are not named, authorised task owners. Responsibility remains to be confirmed. Some extracted summary wording also needs checking against the exact passages.

A demo reviewer should record any acceptance/dependency corrections separately, preserving the original model configuration and the source evidence. A schema pass, a completed inference or an agent review must not be labelled client acceptance.
