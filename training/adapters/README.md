# Harbour extraction adapter

This 2.9 MB QLoRA adapter (2,895,443 bytes, or 2.76 MiB) was actually trained locally on 29 October 2026.

- Base: `mlx-community/Qwen3-0.6B-4bit`, revision `73e3e38d981303bc594367cd910ea6eb48349da8`.
- Base lineage: Qwen/Qwen3-0.6B, Apache-2.0. Adapter distributed under Apache-2.0; see `LICENSE`.
- Task: one-record structured extraction of source, owner, due date, status and risk.
- 60 optimiser steps; rank 4; final 8 layers; 96 synthetic training records.
- This adapter is not a full model and requires the base weights (downloaded separately).
- It is not trained to plan projects, generate long reports or make autonomous acceptance decisions.
- Actual metrics, errors and full prediction records are in `../results/` and `../../public/model-evaluation.json`.

Use `training/serve.sh` from the repository root to bind the adapter to a loopback-only MLX server. In HTTP requests use model `default_model`, which preserves the adapter binding configured on the command line. Sending the original Hugging Face model ID can load the base model without the adapter.
