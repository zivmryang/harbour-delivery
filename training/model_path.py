"""Resolve the exact base-model revision used in the published experiment."""
from huggingface_hub import snapshot_download
MODEL='mlx-community/Qwen3-0.6B-4bit'
REVISION='73e3e38d981303bc594367cd910ea6eb48349da8'

def model_path():
    return snapshot_download(MODEL,revision=REVISION,allow_patterns=['*.json','*.safetensors','*.jinja','*.txt','*.model'])

if __name__=='__main__': print(model_path())
