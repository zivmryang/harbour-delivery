# Real AI gateway

Harbour Delivery separates deterministic project checks from generative models. The public GitHub Pages build has no bundled API key, no hosted inference service and no automatic access to your local machine. Its rules-based report is explicitly labelled. A live model runs through this local or separately hosted gateway.

## Local Ollama briefing

Use Node.js 22 or newer and an installed Ollama service:

```sh
ollama pull qwen3:0.6b
cp .env.example .env
npm run server
# In another terminal
npm run dev
```

The Vite development server proxies `/api` to `127.0.0.1:8787`. Ollama runs at `127.0.0.1:11434`. The 0.6B model is a small, inexpensive local test model, not a production-quality analyst. The gateway limits input, validates JSON structure and cited source IDs, and rejects narrow structured-task completion contradictions as `FACT_CONFLICT`. The completion gate checks the summary, decisions and actions. It looks for direct task-title/id references, overall project completion claims, and positive achievement statements citing unfinished structured tasks; then checks status, owner, acceptance, evidence and prerequisite completion. It handles common explicit pending/blocked/planned qualifiers. It is deliberately conservative and can reject ambiguous wording; it does not cover arbitrary paraphrases or establish the truth of user-supplied facts. It **cannot prove that every natural-language claim is faithful**. Review all output before marking it reviewed or using it externally.

`GET /api/health` reports whether the configured Ollama model is installed. `POST /api/brief` accepts:

```json
{"provider":"ollama","language":"en","project":{"id":"P1","name":"Synthetic rollout"},"facts":[{"id":"T1","text":"SIMULATION: UAT evidence is missing."}],"notes":"Identify what must be checked before acceptance."}
```

Successful responses contain `text`, `sourceIds`, `provider`, `model`, and `durationMs`. Failed, truncated, uncited, or structurally invalid outputs are rejected, rather than silently replaced with a fake AI result.

## Optional OpenAI briefing

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in the gateway `.env`. Choose an account-accessible model that supports Structured Outputs. These variables are server-only; never place credentials in `VITE_*`, source files, browser storage, or the public repository. The adapter calls the Responses API with `store:false` and a strict JSON schema. Clicking cloud generation sends the selected project facts and notes to OpenAI; use only data that you are authorised to share. `store:false` is not a claim of zero retention under all account policies.

No OpenAI request is made when the credential or model is missing. Unit tests mock the transport and therefore do not prove live OpenAI generation.

## Adapter-enabled MLX extraction

The independently trained LoRA adapter is for **structured project record extraction**. It does not specialise the briefing model. Start the adapter-enabled MLX server using the model-lab instructions, then configure `MLX_BASE_URL` and `MLX_MODEL` to match that service. The gateway expects OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints. `MLX_MODEL` is only the display/health-check identifier; the value in `.env.example` does not override the inference request model. Keep this value aligned with the public Hugging Face identifier returned by `/v1/models`, rather than changing it to `default_model`. Requests deliberately use `model: default_model`: in MLX-LM this selects the model and adapter loaded by the serving command. Sending the Hugging Face model id can load the unadapted base model instead.

`POST /api/extract` accepts:

```json
{"text":"Owner: Alex. Due: 2026-11-05. Status: blocked. Risk: high.","sourceId":"REC-001","model":"adapted"}
```

It returns `extraction`, `model`, `variant`, and `durationMs`. The extraction must have exactly `source_id`, `owner`, `due`, `status`, and `risk`. The source id must match the request; missing owner/date should be `null`. A unique ASCII owner-name case variant (for example `MEI` → source `Mei`) is restored to the actual source spelling and explicitly reported in `normalizations`. Ambiguous names, invented owners/dates, invalid dates, enums, fields or source references fail validation. The result is a draft and is never automatically written into project tasks. A reachable MLX server alone does not attest that the correct adapter is loaded; record the serving command and evaluation artefacts separately.

## Browser origin and hosting

The gateway binds to loopback by default and allows only the standard local Vite origins. Additional browser origins must be explicitly configured in `ALLOWED_ORIGIN`, comma-separated and without paths or wildcards. To host on a non-loopback address, set a unique `AI_GATEWAY_TOKEN` of at least 24 characters, use HTTPS via a reverse proxy, and configure the frontend to send it as a Bearer token. Do not publish an unauthenticated paid provider proxy. A local HTTP gateway may be blocked from an HTTPS public page by browser mixed-content/private-network rules; local `npm run dev` is the supported local inference route.

Controls include a 64 KiB request limit, six generation/extraction requests per minute per connecting IP, bounded model timeouts, exact origin checks, source-id validation, and sanitised error responses. No project input or API credential is logged by the gateway. Do not treat this single-user gateway as a multi-tenant production service: add organisation authentication, quotas, access controls and operational monitoring before such use.

## Tests and evidence

```sh
npm test -- server/index.test.mjs
node server/smoke.mjs
```

The first command runs mocked transport and HTTP tests. The second makes a **real** Ollama request with synthetic facts and prints a timestamped JSON result. It tests generation and source-reference validity; it does not establish accuracy on arbitrary inputs, production reliability or business impact. Preserve separately reviewed outputs when validating a new model or deployment configuration.

Official implementation references, consulted 2026-10-29:

- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Qwen3 0.6B model](https://ollama.com/library/qwen3:0.6b)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Completion hallucination regression

Browser QA observed a small-model summary that recited future and blocked task titles as completed achievements. `server/reported-completion-conflict.json` preserves the exact observed summary supplied by QA and the corresponding source task states; it is labelled a QA observation, not a reconstructed raw provider response. Regression tests ensure that this wording is now rejected with HTTP 502 `FACT_CONFLICT` and is not saved as a reviewable report. The prompt also explicitly distinguishes task names from achievements. Any `live-brief-guard-smoke.json` result is a separate real generation, not evidence that the original output was good.

A second browser-QA failure paraphrased the task list as an overall completed project, including a completed claim in the decision section. It is preserved in `server/reported-completion-conflict-2.json`. The gate now checks project-wide scope and per-item cited source status across all three output sections. This remains a bounded, conservative rule guard rather than an entailment model; subtle paraphrases, negation, contradictory source facts and claims unrelated to completion still require human review.


## Document handover jobs

The **资料移交建项** workflow uses a separately configured `HANDOVER_MODEL=qwen3:8b`. Install it with `ollama pull qwen3:8b`. The existing 0.6B briefing model and fine-tuned MLX extraction adapter are unchanged; neither is presented as a full contract planner.

`POST /api/handover/jobs` accepts a provider, project context, parsed documents, curated knowledge IDs, an optional `suppliedKnowledge` array of user-provided references and a `refreshSources` flag (default true). It returns a job ID. Poll `GET /api/handover/jobs/:id`, or cancel with `POST /api/handover/jobs/:id/cancel` and `{}`. One job runs at a time; up to eight results are kept in process memory for 30 minutes. The overall deadline is fifteen minutes. The gateway does not log source texts or save them to disk.

`GET /api/knowledge` reads the catalogue. `POST /api/knowledge/refresh` takes `{ "ids": [...] }` and fetches only selected allowlisted official sources. Uploaded reference URLs, if supplied as metadata, are never fetched. Failed refreshes are visibly labelled snapshots; successful extraction of a web page does not establish current legal applicability.

The UI parses text PDF, DOCX and plain text locally; scanned pages require OCR. Only clicking analysis sends those texts to the configured gateway. The local model keeps inference on the configured machine; the OpenAI option forwards the submitted text to OpenAI using the server-side credential. Never commit contracts, exports or credentials.

See [engine limits and validation](HANDOVER-ENGINE.md) and [official source catalogue](KNOWLEDGE-SOURCES.md).
