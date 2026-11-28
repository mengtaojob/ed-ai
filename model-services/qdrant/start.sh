#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
runtime_dir="$project_dir/.local-rag/qdrant"
cd "$runtime_dir"

# 仅本机访问，数据库与快照默认放在这个忽略目录。
export QDRANT__SERVICE__HOST=127.0.0.1
export QDRANT__TELEMETRY_DISABLED=true
exec ./qdrant
