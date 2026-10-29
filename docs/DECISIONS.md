# Architecture decisions

Recorded 2026-10-29. This document records the design choices and operational limits of the initial implementation.

## One connected delivery workflow

The workspace supports ICT delivery, project governance and reviewed AI-assisted reporting. The selected workflow connects handover documents and selected knowledge → model extraction/synthesis → reviewed project setup → tasks → dependencies → risks → acceptance → reviewed communication. Import/export is file-based and explicit. Vendor account connectors would add credentials, custom schemas and synchronization behavior beyond this initial scope. The tool-by-tool mapping is documented in [TOOL-CHOICES.md](TOOL-CHOICES.md).

## Deterministic controls before generative prose

Date arithmetic, completion prerequisites, CPM and schema checking are executable rules. LLMs draft communication or extract structured fields, but cannot mark tasks complete, approve a go-live or change the workspace. A report's input fingerprint invalidates its review when relevant project facts change.

## A deliberately narrow local-model task

A 16 GB Apple Silicon machine can support a small 4-bit Qwen3 model and LoRA training. The selected task has a measurable five-field output: source, owner, date, status and risk. Training a broad project-manager persona would make evaluation much less meaningful. The experiment uses a fixed 60-step run and untouched held-out examples; results and errors are retained even where they weaken the claim of improvement.

## Separate model processes

Ollama supplies general project-brief generation. MLX serves a pinned base model and the extraction adapter. Its HTTP request must use `default_model` to select the command-line-loaded adapter. Naming the repository in the request can accidentally load the base model, so this integration detail is recorded and tested.

## Local-first data and a static public demonstration

The UI stores structured data in this browser, with JSON backup and file exchange. It does not publish user-entered data to GitHub. The public repository contains only synthetic examples and technical experimental evidence. Public hosting is reproducible and inexpensive; live inference is a separately configured local or HTTPS service.

This choice sacrifices team accounts, permissions, shared updates and server backups. Those would be prerequisites for an actual multi-user organisational rollout. The model gateway binds to loopback and checks origins; a public listener additionally requires a bearer token. The design is not claimed to be production-certified or independently audited.

## Validation boundaries

The application was developed with AI assistance. Automated tests, recorded training outputs and saved predictions document specific engineering behavior and experiment results. They do not establish production reliability or business impact. Model failures remain available for inspection, and all bundled project scenarios are synthetic. Before an organizational rollout, validate the workflow with representative inputs, actual users, agreed acceptance criteria and an operational owner; measure adoption and outcomes separately from the included experiment.


## Document grounding before project initialization

The handover model is separate from the small extraction experiment. Source cleaning preserves lexical content and records hashes and chunk locations. A model selects server-defined source passages during extraction; the server attaches exact quotations. Synthesis refers to a verified citation registry. Complete passage coverage and selected numeric checks detect specific omissions and contradictions, not all semantic errors.

Long operations use cancellable in-memory jobs. A failed or timed-out run does not produce an adoptable partial project. Review supplies missing estimates and scores, resolves document conflicts and confirms knowledge applicability. Applying a reviewed proposal creates a new project with all tasks unstarted, preserves the original proposal, and records overrides. A local archive can be edited by its owner and is not an immutable audit service.
