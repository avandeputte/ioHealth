#!/bin/sh
# One-time upgrade of a running iohealth to the suite's harmonized settings (iohealth 2.7.0 and later). It is
# only needed once per install; delete this script when every install is upgraded.
#
# Run it in the app folder (where setup.sh installed iohealth, e.g. /opt/iohealth/app), as the user that owns the
# install (root when it runs as a systemd service):
#
#   sh harmonize.sh                 the settings and the service, then ./update.sh installs the new version
#   sh harmonize.sh --dry-run       only show what would change
#   sh harmonize.sh --no-update     the settings and the service only (run ./update.sh yourself right after)
#   sh harmonize.sh --public-url https://health.example.com --cookie-domain example.com   also set those two
#   sh harmonize.sh --undo          put back the files it changed (their .pre-harmonize copies)
#   sh harmonize.sh --compose FILE  Docker: the same renames in a docker-compose.yml or env file, nothing else
#
# What it does: .env becomes config.env (the old file is kept as .env.pre-harmonize), the renamed
# settings below get their new names, PORT is written when the service passed it on its command line, and the
# systemd unit reads config.env and starts `python -m app`. Running it a second time changes nothing.
#
# Renamed settings:
#   IOTHING_COOKIE_DOMAIN -> COOKIE_DOMAIN, IOTHING_COOKIE -> COOKIE_NAME, IOTHING_SESSION_DAYS -> SESSION_DAYS
#   IOTHING_AUTH_DB_* and IOSUITE_SHARED_DB_* -> IOSUITE_DB_* (HOST, PORT, NAME, USER, PASSWORD)
#   LISTEN_ADDR=[host]:port -> HOST and PORT; ADMIN_USER / ADMIN_PASSWORD left by setup.sh are removed
set -e
cd "$(dirname "$0")"
APP="$(pwd)"
NAME=iohealth
OLDFILES=".env"
RENAMES="IOTHING_COOKIE_DOMAIN=COOKIE_DOMAIN IOTHING_COOKIE=COOKIE_NAME IOTHING_SESSION_DAYS=SESSION_DAYS IOTHING_AUTH_DB_HOST=IOSUITE_DB_HOST IOTHING_AUTH_DB_PORT=IOSUITE_DB_PORT IOTHING_AUTH_DB_NAME=IOSUITE_DB_NAME IOTHING_AUTH_DB_USER=IOSUITE_DB_USER IOTHING_AUTH_DB_PASSWORD=IOSUITE_DB_PASSWORD IOSUITE_SHARED_DB_HOST=IOSUITE_DB_HOST IOSUITE_SHARED_DB_PORT=IOSUITE_DB_PORT IOSUITE_SHARED_DB_NAME=IOSUITE_DB_NAME IOSUITE_SHARED_DB_USER=IOSUITE_DB_USER IOSUITE_SHARED_DB_PASSWORD=IOSUITE_DB_PASSWORD"
OLD_PORT=47800
NEW_PORT=47800
UNIT=/etc/systemd/system/$NAME.service
KEEP=.pre-harmonize

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m  ! \033[0m%s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

DRY=0; UPDATE=1; UNDO=0; PUBURL=""; COOKIE=""; COMPOSE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1;;
    --no-update) UPDATE=0;;
    --undo) UNDO=1;;
    --public-url) PUBURL="${2:?--public-url needs a value}"; shift;;
    --cookie-domain) COOKIE="${2:?--cookie-domain needs a value}"; shift;;
    --compose) COMPOSE="${2:?--compose needs a file}"; shift;;
    -h|--help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0;;
    *) die "unknown option $1 (try --help)";;
  esac
  shift
done

# sed into a copy, then back into the same file (keeps its owner and mode; works with GNU and BSD sed)
edit() { f="$1"; shift; sed -E "$@" "$f" > "$f.tmp" && cat "$f.tmp" > "$f" && rm -f "$f.tmp"; }
has() { grep -qE "^[[:space:]]*(-[[:space:]]+)?(export[[:space:]]+)?\"?$2\"?[[:space:]]*[:=]" "$1"; }
value() { sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$2=//p" "$1" | tail -n 1 | sed -E 's/^["'\'']//; s/["'\'']$//'; }
setkey() {  # setkey FILE KEY VALUE: replace the line, or add it
  if has "$1" "$2"; then edit "$1" -e "s|^([[:space:]]*(export[[:space:]]+)?)$2=.*|\\1$2=$3|"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}

# the renames, in an env file (KEY=value) or a compose file (KEY: value, - KEY=value)
rename_all() {
  for pair in $RENAMES; do
    o="${pair%%=*}"; n="${pair#*=}"
    has "$1" "$o" || continue
    if has "$1" "$n"; then
      edit "$1" -e "/^[[:space:]]*(-[[:space:]]+)?(export[[:space:]]+)?\"?$o\"?[[:space:]]*[:=]/d"
      note "$o removed ($n is already set)"
    else
      edit "$1" -e "s/^([[:space:]]*(-[[:space:]]+)?(export[[:space:]]+)?\"?)$o(\"?[[:space:]]*[:=])/\\1$n\\4/"
      note "$o -> $n"
    fi
  done
  app_specific "$1"
}

app_specific() {
  if grep -qE '^[[:space:]]*(export[[:space:]]+)?LISTEN_ADDR=' "$1"; then
    LA="$(value "$1" LISTEN_ADDR)"; LP="${LA##*:}"; LH="${LA%:*}"
    edit "$1" -e '/^[[:space:]]*(export[[:space:]]+)?LISTEN_ADDR=/d'
    if [ -n "$LP" ] && ! has "$1" PORT; then setkey "$1" PORT "$LP"; fi
    if [ -n "$LH" ] && [ "$LH" != 0.0.0.0 ] && ! has "$1" HOST; then setkey "$1" HOST "$LH"; fi
    note "LISTEN_ADDR=$LA -> HOST / PORT"
  fi
  # a compose file: LISTEN_ADDR: ":47800" -> PORT: "47800"
  edit "$1" -e 's/^([[:space:]]*(-[[:space:]]+)?"?)LISTEN_ADDR("?[[:space:]]*[:=][[:space:]]*"?)[^:"]*:([0-9]+)/\1PORT\3\4/'
  if [ -z "$COMPOSE" ] && grep -qE '^(ADMIN_USER|ADMIN_PASSWORD)=' "$1"; then
    # setup.sh used to keep the first admin's password here; the account exists, so the password goes
    edit "$1" -e '/^(ADMIN_USER|ADMIN_PASSWORD)=/d'
    note "ADMIN_USER / ADMIN_PASSWORD removed (the account they made stays; setup.sh no longer keeps a password here)"
  fi
}

show_diff() {  # show_diff ORIGINAL NEW LABEL
  if [ -f "$1" ]; then diff -u "$1" "$2" | sed "1,2d; s|^|    |" || true; else note "(new file $3)"; sed 's|^|    + |' "$2"; fi
}

# ---------------------------------------------------------------- Docker: one compose or env file
if [ -n "$COMPOSE" ]; then
  [ -f "$COMPOSE" ] || die "no such file: $COMPOSE"
  W="$(mktemp)"; cp "$COMPOSE" "$W"
  say "Renames in $COMPOSE"
  rename_all "$W"
  if [ "$OLD_PORT" != "$NEW_PORT" ]; then
    # the container listens on $NEW_PORT now; the host side of the mapping stays as it was
    edit "$W" -e "s/([0-9]+):$OLD_PORT([^0-9]|\$)/\\1:$NEW_PORT\\2/g" -e "s|127\\.0\\.0\\.1:$OLD_PORT/|127.0.0.1:$NEW_PORT/|g"
  fi
  [ -n "$PUBURL" ] && ! has "$W" PUBLIC_URL && warn "add PUBLIC_URL: $PUBURL to the environment yourself"
  [ -n "$COOKIE" ] && ! has "$W" COOKIE_DOMAIN && warn "add COOKIE_DOMAIN: $COOKIE to the environment yourself"
  has "$W" PUBLIC_URL || note "PUBLIC_URL is not set (the address people reach $NAME at; optional)"
  has "$W" COOKIE_DOMAIN || note "COOKIE_DOMAIN is not set (the domain the sign-in is shared on; optional)"
  if cmp -s "$COMPOSE" "$W"; then say "Nothing to change in $COMPOSE"; rm -f "$W"; exit 0; fi
  show_diff "$COMPOSE" "$W" "$COMPOSE"
  if [ "$DRY" = 1 ]; then rm -f "$W"; say "Dry run: nothing changed"; exit 0; fi
  [ -f "$COMPOSE$KEEP" ] || cp -p "$COMPOSE" "$COMPOSE$KEEP"
  cat "$W" > "$COMPOSE"; rm -f "$W"
  say "Done ($COMPOSE$KEEP is the old one). Now: docker compose pull && docker compose up -d"
  exit 0
fi

[ -f app/__init__.py ] || die "run this in the $NAME app folder (the one with setup.sh and the app/ folder)"
OLD=""; for f in $OLDFILES; do [ -f "$f" ] && { OLD="$f"; break; }; done
HAS_UNIT=0; [ -f "$UNIT" ] && HAS_UNIT=1
systemd_reload() { command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload 2>/dev/null || true; }

# ---------------------------------------------------------------- undo
if [ "$UNDO" = 1 ]; then
  say "Putting back the files harmonize.sh changed"
  for f in $OLDFILES; do
    [ -f "$f$KEEP" ] || continue
    mv "$f$KEEP" "$f"; note "$f restored"
    if [ -f "config.env$KEEP" ]; then mv "config.env$KEEP" config.env; note "config.env restored"; else rm -f config.env; note "config.env removed"; fi
  done
  [ ! -f "config.env$KEEP" ] || { mv "config.env$KEEP" config.env; note "config.env restored"; }
  if [ -f "$UNIT$KEEP" ]; then mv "$UNIT$KEEP" "$UNIT"; systemd_reload; note "$UNIT restored"; fi
  say "Done. The code is not downgraded: install the version before 2.7.0 with update.sh if it was already updated."
  exit 0
fi

# ---------------------------------------------------------------- the settings file
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
if [ -f config.env ]; then
  cp config.env "$W/config.env"
  [ -n "$OLD" ] && warn "both $OLD and config.env exist: config.env is the one kept ($OLD is left alone)"
  SRC=config.env
elif [ -n "$OLD" ]; then
  cp "$OLD" "$W/config.env"; SRC="$OLD"
else
  : > "$W/config.env"; SRC=""
  warn "no settings file here ($OLDFILES or config.env): a config.env with what this script knows is written"
fi
say "Settings: ${SRC:-none} -> config.env"
rename_all "$W/config.env"

# the port the service listened on, when its command line said it (the new start command reads PORT)
if [ "$HAS_UNIT" = 1 ]; then
  UPORT="$(sed -nE 's/^ExecStart=.*--port[ =]+([0-9]+).*/\1/p' "$UNIT" | head -n 1)"
  if [ -n "$UPORT" ] && ! has "$W/config.env" PORT; then setkey "$W/config.env" PORT "$UPORT"; note "PORT=$UPORT (from the service's command line)"; fi
  UHOST="$(sed -nE 's/^ExecStart=.*--host[ =]+([^ ]+).*/\1/p' "$UNIT" | head -n 1)"
  if [ -n "$UHOST" ] && [ "$UHOST" != 0.0.0.0 ] && ! has "$W/config.env" HOST; then setkey "$W/config.env" HOST "$UHOST"; note "HOST=$UHOST (from the service's command line)"; fi
fi
if [ "$OLD_PORT" != "$NEW_PORT" ]; then
  P="$(value "$W/config.env" PORT)"
  if [ -z "$P" ] || [ "$P" = "$OLD_PORT" ]; then
    setkey "$W/config.env" PORT "$NEW_PORT"
    warn "the port moves from $OLD_PORT to $NEW_PORT (every app of the suite has its own): point your reverse proxy, bookmarks and clients at :$NEW_PORT (PORT=$OLD_PORT in config.env keeps the old one)"
  fi
fi

if [ -n "$PUBURL" ]; then setkey "$W/config.env" PUBLIC_URL "$PUBURL"; note "PUBLIC_URL=$PUBURL"; fi
if [ -n "$COOKIE" ]; then setkey "$W/config.env" COOKIE_DOMAIN "$COOKIE"; note "COOKIE_DOMAIN=$COOKIE"; fi
if ! grep -q "PUBLIC_URL=" "$W/config.env"; then
  printf '%s\n' "# PUBLIC_URL=https://health.example.com   the address people and the other apps reach $NAME at (empty: the address it is reached at)" >> "$W/config.env"
  note "PUBLIC_URL is not set: a commented line is added (optional; --public-url sets it)"
fi
if ! grep -q "COOKIE_DOMAIN=" "$W/config.env"; then
  printf '%s\n' "# COOKIE_DOMAIN=example.com   the domain the sign-in is shared on by every app (empty: this host only)" >> "$W/config.env"
  note "COOKIE_DOMAIN is not set: a commented line is added (optional; --cookie-domain sets it)"
fi

# ---------------------------------------------------------------- the systemd service
if [ "$HAS_UNIT" = 1 ]; then
  cp "$UNIT" "$W/unit"
  edit "$W/unit" -e "s|^EnvironmentFile=.*|EnvironmentFile=$APP/config.env|" -e "s|^ExecStart=.*|ExecStart=$APP/.venv/bin/python -m app|"
  grep -q '^EnvironmentFile=' "$W/unit" || edit "$W/unit" -e "s|^(ExecStart=.*)|EnvironmentFile=$APP/config.env\\
\\1|"
fi
PLIST="$(ls "$HOME"/Library/LaunchAgents/*"$NAME"*.plist 2>/dev/null | head -n 1 || true)"

# ---------------------------------------------------------------- show, then write
CHANGED=0
if [ -n "$SRC" ] && cmp -s "$SRC" "$W/config.env" && [ "$SRC" = config.env ]; then note "config.env: nothing to change"; else
  CHANGED=1; say "config.env"; show_diff "${SRC:-/nonexistent}" "$W/config.env" config.env; fi
if [ "$HAS_UNIT" = 1 ]; then
  if cmp -s "$UNIT" "$W/unit"; then note "$UNIT: nothing to change"; else CHANGED=1; say "$UNIT"; show_diff "$UNIT" "$W/unit" "$UNIT"; fi
fi
if [ "$DRY" = 1 ]; then say "Dry run: nothing changed"; exit 0; fi

if [ "$HAS_UNIT" = 1 ] && ! cmp -s "$UNIT" "$W/unit" && [ ! -w "$UNIT" ]; then die "the service $UNIT is root's: run it as root (sudo sh harmonize.sh)"; fi
if [ "$CHANGED" = 1 ]; then
  if [ -f config.env ]; then [ -f "config.env$KEEP" ] || cp -p config.env "config.env$KEEP"; cat "$W/config.env" > config.env
  else (umask 077; cp "$W/config.env" config.env); fi
  chmod 600 config.env
  if [ -n "$OLD" ] && [ "$SRC" = "$OLD" ]; then mv "$OLD" "$OLD$KEEP"; note "$OLD kept as $OLD$KEEP"; fi
  if [ "$HAS_UNIT" = 1 ] && ! cmp -s "$UNIT" "$W/unit"; then
    [ -f "$UNIT$KEEP" ] || cp -p "$UNIT" "$UNIT$KEEP"; cat "$W/unit" > "$UNIT"; systemd_reload; note "$UNIT updated (the old one is $UNIT$KEEP)"
  fi
fi
[ -n "$PLIST" ] && warn "macOS login item $PLIST: run ./setup.sh again after the update, which rewrites it"

# ---------------------------------------------------------------- the new version
if [ "$UPDATE" = 0 ]; then say "Done. Now run ./update.sh (the service needs the new version for config.env)"; exit 0; fi
[ -f update.sh ] || die "no update.sh here; install the new version yourself"
say "Installing the new version (update.sh)"
# in a git checkout this downloaded copy would block the merge (the new version has a harmonize.sh of its own)
ASIDE=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ -f harmonize.sh ] && ! git ls-files --error-unmatch harmonize.sh >/dev/null 2>&1; then mv harmonize.sh .harmonize.sh; ASIDE=1; fi
if ! sh ./update.sh; then
  [ "$ASIDE" = 1 ] && [ ! -f harmonize.sh ] && mv .harmonize.sh harmonize.sh
  die "update.sh failed (see above). The settings are already converted; sh harmonize.sh --undo puts them back."
fi
[ "$ASIDE" = 1 ] && rm -f .harmonize.sh
if [ "$HAS_UNIT" = 1 ] && command -v systemctl >/dev/null 2>&1; then systemctl restart "$NAME" || true; fi
P="$(value config.env PORT)"; P="${P:-$NEW_PORT}"
PY="$APP/.venv/bin/python"; [ -x "$PY" ] || PY=python3
if "$PY" - "$P" <<'PYEOF'
import sys, time, urllib.error, urllib.request
for _ in range(30):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/status", timeout=3); sys.exit(0)
    except urllib.error.HTTPError:
        sys.exit(0)  # it answers (a status page that wants a sign-in is still an answer)
    except Exception:
        time.sleep(1)
sys.exit(1)
PYEOF
then say "Done: $NAME answers on port $P with config.env. This script can be deleted."
else warn "$NAME does not answer on port $P yet; see journalctl -u $NAME (or the log in Maintenance › Updates and logs)"; fi
