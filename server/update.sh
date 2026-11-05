#!/bin/sh
# Update an installed ioHealth in place (a checkout, or a copy of server/ run with run.sh; Docker users
# pull the image instead).
#
#   ./update.sh            fetch the latest code, refresh the packages, restart the service
#   ./update.sh --check    only say whether something newer exists (IOHEALTH_REF is honoured)
#   ./update.sh --force    reinstall and restart even when the installed commit is already the latest
#   IOHEALTH_REF=<sha|branch> ./update.sh   install that commit instead of the tip of main
#     (right after a push GitHub may still report the previous commit; naming the sha avoids that)
#   IOHEALTH_RESULT=<file>  write the outcome ("ok: ..." or "error: ...") there before the
#     restart, so ioHealth can show it afterwards (its own child process dies in the restart)
#
# Keeps .env and the Python environment. A git checkout is pulled; an installed copy (no .git) is replaced from
# the GitHub tarball (the server lives in server/ of the repository). The Python packages the new
# version asks for are installed first, and the code moves only once that succeeded, so a failed package install
# leaves the installed version running as it was. Settings › Server › Update now runs this script.
set -e
cd "$(dirname "$0")"
APP="$(pwd)"
REPO="${IOHEALTH_REPO:-avandeputte/ioHealth}"
BRANCH="${IOHEALTH_BRANCH:-main}"
REF="${IOHEALTH_REF:-$BRANCH}"
RESULT="${IOHEALTH_RESULT:-}"
SUBDIR="server"
case "$REF" in -*|*..*|*/*/*) printf 'error: bad ref: %s\n' "$REF" >&2; exit 1;; esac  # a commit id or a branch, never an option or a path
FORCE=0; CHECK=0
for a in "$@"; do case "$a" in --force) FORCE=1;; --check) CHECK=1;; *) printf 'error: unknown option %s (--check, --force)\n' "$a" >&2; exit 2;; esac; done
TMP=""; NOTED=0
cleanup() { rc=$?; [ -n "$TMP" ] && rm -rf "${TMP:?}"; [ $rc -ne 0 ] && [ "$NOTED" = 0 ] && [ -n "$RESULT" ] && printf 'error: update.sh failed (exit %s); see the log\n' "$rc" > "$RESULT" 2>/dev/null; true; }
trap cleanup EXIT
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
note() { [ -n "$RESULT" ] && printf '%s\n' "$*" > "$RESULT" 2>/dev/null || true; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; note "error: $*"; NOTED=1; exit 1; }
# a checkout: the repository root is one level up; an installed copy records its commit in COMMIT
GITROOT=""; [ -d "$APP/../.git" ] && GITROOT="$(cd "$APP/.." && pwd)"
local_commit() { if [ -n "$GITROOT" ]; then git -C "$GITROOT" rev-parse HEAD 2>/dev/null; elif [ -f COMMIT ]; then cat COMMIT; else echo unknown; fi; }
PYF="$(ls -d .venv/bin/python 2>/dev/null || command -v python3)"
fetch() { "$PYF" -c 'import sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={"User-Agent": "iohealth-update", "Accept": "application/vnd.github+json"})
with urllib.request.urlopen(req, timeout=60) as r, open(sys.argv[2], "wb") as f:
    f.write(r.read())' "$1" "$2"; }
remote_commit() { "$PYF" -c 'import sys, json, urllib.request
req = urllib.request.Request(sys.argv[1], headers={"User-Agent": "iohealth-update", "Accept": "application/vnd.github+json"})
with urllib.request.urlopen(req, timeout=30) as r:
    print(json.load(r)["sha"])' "https://api.github.com/repos/$REPO/commits/${1:-$BRANCH}" 2>/dev/null; }
if [ "$CHECK" = 1 ]; then
  L="$(local_commit)"; R="$(remote_commit "$REF")" || R=""
  [ -n "$R" ] || die "could not reach GitHub (api.github.com) from here, or no such commit: $REF"
  if [ "$L" = "$R" ]; then echo "up to date ($(echo "$L" | cut -c1-7))"; else echo "update available: $(echo "$R" | cut -c1-7) (installed $(echo "$L" | cut -c1-7))"; fi
  exit 0
fi

VPY="$APP/.venv/bin/python"
[ -x "$VPY" ] || die "no .venv here; run ./run.sh once first"
TMP="$(mktemp -d)"
STAGE=""

say "Fetching the latest code"
if [ -n "$GITROOT" ]; then
  git -C "$GITROOT" fetch -q origin "$REF" || die "git fetch failed (could not reach GitHub?)"
  if [ "$FORCE" = 0 ] && [ "$(git -C "$GITROOT" rev-parse HEAD)" = "$(git -C "$GITROOT" rev-parse FETCH_HEAD)" ]; then
    say "Already up to date ($(local_commit | cut -c1-7)); nothing to do"; note "ok: already up to date ($(local_commit | cut -c1-7))"; exit 0
  fi
  git -C "$GITROOT" merge-base --is-ancestor HEAD FETCH_HEAD || die "this checkout has commits that are not on $REF (not a fast-forward); update it by hand"
  git -C "$GITROOT" diff --quiet HEAD -- || die "local changes in the checkout (git stash them first)"
  git -C "$GITROOT" show "FETCH_HEAD:$SUBDIR/pyproject.toml" > "$TMP/pyproject.toml" 2>/dev/null || die "the fetched commit has no $SUBDIR/pyproject.toml"
else
  R="$(remote_commit "$REF")" || R=""; [ -n "$R" ] || die "could not reach GitHub (or no such commit: $REF)"
  if [ "$FORCE" = 0 ] && [ "$R" = "$(local_commit)" ]; then
    say "Already up to date ($(echo "$R" | cut -c1-7)); nothing to do"; note "ok: already up to date ($(echo "$R" | cut -c1-7))"; exit 0
  fi
  fetch "https://github.com/$REPO/archive/$R.tar.gz" "$TMP/src.tgz" || die "download failed"
  tar xzf "$TMP/src.tgz" -C "$TMP"
  SRC="$(ls -d "$TMP"/*/ | head -1)$SUBDIR"
  STAGE="$APP/.update-stage"; rm -rf "${STAGE:?}"; mkdir -p "$STAGE"
  for item in app static pyproject.toml run.sh update.sh setup.sh; do
    [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$STAGE/$item"
  done
  [ -d "$STAGE/app" ] && [ -d "$STAGE/static" ] && [ -f "$STAGE/pyproject.toml" ] || { rm -rf "${STAGE:?}"; die "the downloaded tarball looks incomplete"; }
  cp "$STAGE/pyproject.toml" "$TMP/pyproject.toml"
fi

say "Refreshing the Python packages (the new version's, before the code moves)"
"$VPY" - "$TMP/pyproject.toml" > "$TMP/requirements.txt" <<'PYEOF' || die "could not read the fetched pyproject.toml"
import sys, tomllib
with open(sys.argv[1], "rb") as f:
    print("\n".join(tomllib.load(f).get("project", {}).get("dependencies", [])))
PYEOF
pipi() { if command -v uv >/dev/null 2>&1; then uv pip install -q -p "$VPY" "$@"; else "$VPY" -m pip install -q "$@"; fi; }
pipi -r "$TMP/requirements.txt" || { [ -n "$STAGE" ] && rm -rf "${STAGE:?}"; die "installing the Python packages failed; the installed version is unchanged (code and packages)"; }

say "Installing the new code"
if [ -n "$GITROOT" ]; then
  git -C "$GITROOT" merge -q --ff-only FETCH_HEAD || die "git merge failed (local changes?); the packages were refreshed, the code is unchanged"
else
  MOVED=""
  swap_back() { for item in $MOVED; do rm -rf "${APP:?}/${item:?}"; [ -e "$APP/$item.old" ] && mv "$APP/$item.old" "$APP/$item"; done; rm -rf "${STAGE:?}"; }
  for item in app static pyproject.toml run.sh update.sh setup.sh; do
    [ -e "$STAGE/$item" ] || continue
    rm -rf "${APP:?}/${item:?}.old"
    if [ -e "$APP/$item" ]; then mv "$APP/$item" "$APP/$item.old" || { swap_back; die "could not set $item aside; the previous files are back in place"; }; fi
    MOVED="$MOVED $item"
    mv "$STAGE/$item" "$APP/$item" || { swap_back; die "could not install $item; the previous files are back in place"; }
  done
  for item in $MOVED; do rm -rf "${APP:?}/${item:?}.old"; done
  rm -rf "${STAGE:?}"
  echo "$R" > COMMIT
fi
chmod 755 update.sh run.sh setup.sh 2>/dev/null || true
pipi --no-deps -e . 2>/dev/null || echo "  note: the package metadata could not be refreshed (pip install -e .); ioHealth runs regardless"

NEWV="$(sed -n 's/^__version__ = "\([^"]*\)".*/\1/p' app/__init__.py)"
note "ok: updated to v$NEWV on $(date '+%Y-%m-%d %H:%M')"

say "Restarting the service"
restart_unit() { if [ "$(id -u)" != 0 ] && command -v sudo >/dev/null 2>&1; then sudo -n systemctl restart "$1"; else systemctl restart "$1"; fi; }
SVC=""; for s in iohealth; do command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$s" 2>/dev/null && { SVC="$s"; break; }; done
if [ -n "$SVC" ]; then
  if restart_unit "$SVC"; then echo "  systemd: restarted $SVC"; else
    echo "  could not restart $SVC from here; run: sudo systemctl restart $SVC"
    note "ok: updated to v$NEWV; the service could not be restarted from here: sudo systemctl restart $SVC"
  fi
elif [ "$(uname -s)" = Darwin ]; then
  L="$(launchctl list 2>/dev/null | grep -o 'net\.iothing\.iohealth\.server' | head -1)"
  if [ -n "$L" ]; then launchctl kickstart -k "gui/$(id -u)/$L" && echo "  launchd: restarted $L"; else echo "  no service found; restart ioHealth yourself"; fi
else
  echo "  no service found; restart ioHealth yourself"
fi
say "Updated to v$NEWV ($(local_commit | cut -c1-7))"
