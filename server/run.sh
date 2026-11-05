#!/bin/sh
# Start ioHealth in the foreground without Docker. Usage: ./run.sh
# The first run creates .venv (with uv when available, else python3 -m venv) and installs pyproject.toml. The
# settings in .env (copy .env.example) are loaded when the file exists; variables already in the environment win.
# A service (systemd unit `iohealth`, or launchd `net.iothing.iohealth.server`) can run this same script; then
# Maintenance › Updates and logs › Update now (update.sh) restarts it after an update.
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue;; *=*) ;; *) continue;; esac
    k="${line%%=*}"; case "$k" in ''|*[!A-Za-z0-9_]*) continue;; esac
    eval "[ -n \"\${$k+x}\" ]" || export "$line"
  done < .env
fi
if [ ! -x .venv/bin/python ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv .venv && uv pip install -p .venv/bin/python -e .
  else
    python3 -m venv .venv && .venv/bin/python -m pip install -e .
  fi
fi
exec .venv/bin/python -m app "$@"
