#!/bin/sh
# Start iohealth in the foreground, with the settings in config.env (HOST and PORT there say where it listens; the
# default port is 47800). The first run creates .venv (with uv when available, else python3 -m venv) and installs the
# app; ./setup.sh does that too and also writes config.env. The service setup.sh installs and the container run the
# same `python -m app`.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv .venv && uv pip install -p .venv/bin/python -e .
  else
    python3 -m venv .venv && .venv/bin/python -m pip install -e .
  fi
fi
exec .venv/bin/python -m app "$@"
