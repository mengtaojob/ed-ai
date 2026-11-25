#!/bin/sh
set -eu

python_bin="${LAYA_PYTHON:-$HOME/.venvs/laya/bin/python}"
if [ -z "${LAYA_PYTHON:-}" ] && [ ! -x "$python_bin" ]; then
  python_bin=python3.12
fi

export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
export LAYA_HOST=127.0.0.1
export LAYA_PORT="${LAYA_PORT:-8000}"
export LAYA_DEVICE="${LAYA_DEVICE:-cpu}"
export LAYA_THREADS="${LAYA_THREADS:-4}"
export LAYA_MODELS=multilingual
export LAYA_DEFAULT_MODEL=multilingual
export LAYA_PRELOAD=1

exec "$python_bin" -m laya.serve
