#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
runtime_dir="$project_dir/.local-rag"
model_dir="$runtime_dir/reranker"
base_url=https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX/resolve/6f5ff65298512715a1e669753bc754d2bc8f367b
mkdir -p "$model_dir"

# 已有文件先检查校验和。下载到临时文件，确认完整后才供本地服务读取。
download() {
  remote_path=$1
  target="$model_dir/${remote_path##*/}"
  sha=$2
  if [ -f "$target" ] && printf '%s  %s\n' "$sha" "$target" | shasum -a 256 -c -; then
    return
  fi
  curl -fsSL --retry 2 --connect-timeout 15 -o "$target.part" "$base_url/$remote_path?download=true"
  printf '%s  %s\n' "$sha" "$target.part" | shasum -a 256 -c -
  mv "$target.part" "$target"
}

download tokenizer.json 8bf8afbfd11306bd872018c53bfdf2e160a56f8edbcf49933324404791c148d3
download onnx/model_int8.onnx 912fc1215c2dbff6499700534bd8d31253af01573861abbfc43afd1fab6cce5d
python3.12 -m venv "$runtime_dir/reranker-venv"
"$runtime_dir/reranker-venv/bin/python" -m pip install -r "$project_dir/model-services/reranker/requirements.txt"
