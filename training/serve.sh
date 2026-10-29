#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
MODEL_PATH=$(training/.venv/bin/python training/model_path.py)
exec training/.venv/bin/mlx_lm.server --model "$MODEL_PATH" --adapter-path training/adapters --host 127.0.0.1 --port 8080 --allowed-origins http://127.0.0.1:8787 --temp 0 --max-tokens 160 --chat-template-args '{"enable_thinking":false}'
