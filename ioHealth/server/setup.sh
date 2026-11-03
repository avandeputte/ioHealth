#!/bin/sh
# ioHealth setup without Docker: asks a few questions (or takes flags), then installs the Python packages, writes
# .env and, on Linux with systemd as root, installs and starts the `iohealth` service and waits until it answers
# (the first start of 2.0 on a 1.x database migrates it to accounts, which can take a while on years of data).
#
#   ./setup.sh                 ask the questions
#   ./setup.sh --yes ...       no questions: what .env already holds, the flags below, and the defaults
#
# Flags: --db HOST:PORT/DATABASE:USER:PASSWORD        the health data (MariaDB / MySQL)
#        --auth-db HOST:PORT/DATABASE:USER:PASSWORD   the ioThing suite's shared accounts (default: the same server)
#        --cookie-domain DOMAIN   --data-owner NAME   --tz ZONE   --port N (47800)   --admin NAME:PASSWORD
#        --service | --no-service   --system-deps | --no-system-deps   --python PATH
# Secrets can stay off the command line: IOHEALTH_DB, IOHEALTH_AUTH_DB, IOHEALTH_ADMIN and IOHEALTH_SYNC_TOKEN in the
# environment do what --db, --auth-db, --admin and SYNC_TOKEN in .env do. Run it again at any time: it keeps .env and
# only changes what you answer.
set -e
cd "$(dirname "$0")"
APP="$(pwd)"
say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
YES=0; DBS=""; AUTHS=""; COOKIE=""; OWNER_ACC=""; TZV=""; PORT=""; ADMIN=""; SERVICE=""; SYSDEPS=""; PY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift;; --db) DBS="$2"; shift 2;; --auth-db) AUTHS="$2"; shift 2;; --cookie-domain) COOKIE="$2"; shift 2;;
    --data-owner) OWNER_ACC="$2"; shift 2;; --tz) TZV="$2"; shift 2;; --port) PORT="$2"; shift 2;; --admin) ADMIN="$2"; shift 2;;
    --service) SERVICE=1; shift;; --no-service) SERVICE=0; shift;; --system-deps) SYSDEPS=1; shift;; --no-system-deps) SYSDEPS=0; shift;;
    --python) PY="$2"; shift 2;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) die "unknown option $1 (try --help)";;
  esac
done
[ -n "$DBS" ] || DBS="${IOHEALTH_DB:-}"
[ -n "$AUTHS" ] || AUTHS="${IOHEALTH_AUTH_DB:-}"
[ -n "$ADMIN" ] || ADMIN="${IOHEALTH_ADMIN:-}"
ask() { _v="$1"; _q="$2"; _d="$3"
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then eval "$_v=\"\$_d\""; return; fi
  printf '%s [%s]: ' "$_q" "$_d"; read -r _a || _a=""; [ -n "$_a" ] && eval "$_v=\"\$_a\"" || eval "$_v=\"\$_d\""; }
asksecret() { _v="$1"; _q="$2"
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then eval "$_v=''"; return; fi
  printf '%s: ' "$_q"; stty -echo 2>/dev/null; read -r _a || _a=""; stty echo 2>/dev/null; printf '\n'; eval "$_v=\"\$_a\""; }
getenv() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1; true; }
split() {  # HOST:PORT/DATABASE:USER:PASSWORD into $1_HOST, $1_PORT, $1_NAME, $1_USER, $1_PASSWORD
  _s="$2"; eval "$1_HOST=\"\${_s%%:*}\""; _r="${_s#*:}"; eval "$1_PORT=\"\${_r%%/*}\""; _r="${_r#*/}"
  eval "$1_NAME=\"\${_r%%:*}\""; _r="${_r#*:}"; eval "$1_USER=\"\${_r%%:*}\""; eval "$1_PASSWORD=\"\${_r#*:}\""; }

# ---- system packages (Python 3.11+ with venv, and git for the iothing-auth package)
if [ "$SYSDEPS" != 0 ] && { ! python3 -c 'import sys, venv, ensurepip; assert sys.version_info >= (3, 11)' 2>/dev/null || ! command -v git >/dev/null; }; then
  say "Installing Python and git"
  if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq python3 python3-venv python3-pip git curl >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q python3 python3-pip git curl
  elif command -v brew >/dev/null; then brew install python git
  else die "install Python 3.11 or newer with venv, and git, then run this again"; fi
fi
PY="${PY:-python3}"

# ---- the answers (what .env holds is the default)
touch .env; chmod 600 .env
setenv() { grep -v "^$1=" .env > .env.tmp || true; printf '%s=%s\n' "$1" "$2" >> .env.tmp; mv .env.tmp .env; chmod 600 .env; }
if [ -n "$DBS" ]; then
  split D "$DBS"
  setenv DB_HOST "$D_HOST"; setenv DB_PORT "$D_PORT"; setenv DB_NAME "$D_NAME"; setenv DB_USER "$D_USER"; setenv DB_PASSWORD "$D_PASSWORD"
elif [ -z "$(getenv DB_HOST)" ] || [ "$YES" = 0 ]; then
  H="$(getenv DB_HOST)"; P="$(getenv DB_PORT)"; D="$(getenv DB_NAME)"; U="$(getenv DB_USER)"
  ask H "MariaDB host (the health data)" "${H:-127.0.0.1}"; ask P "Port" "${P:-3306}"; ask D "Database" "${D:-health}"; ask U "User" "${U:-health}"
  asksecret W "Password (empty: keep the current one)"; [ -n "$W" ] || W="$(getenv DB_PASSWORD)"
  setenv DB_HOST "$H"; setenv DB_PORT "$P"; setenv DB_NAME "$D"; setenv DB_USER "$U"; setenv DB_PASSWORD "$W"
fi
if [ -n "$AUTHS" ]; then
  split A "$AUTHS"
  setenv IOTHING_AUTH_DB_HOST "$A_HOST"; setenv IOTHING_AUTH_DB_PORT "$A_PORT"; setenv IOTHING_AUTH_DB_NAME "$A_NAME"
  setenv IOTHING_AUTH_DB_USER "$A_USER"; setenv IOTHING_AUTH_DB_PASSWORD "$A_PASSWORD"
elif [ "$YES" = 0 ] && [ -t 0 ]; then
  N="$(getenv IOTHING_AUTH_DB_NAME)"; U="$(getenv IOTHING_AUTH_DB_USER)"
  ask N "Shared account database (ioThing suite, on the same server)" "${N:-auth}"; ask U "Its user" "${U:-auth}"
  asksecret W "Its password (empty: keep the current one)"; [ -n "$W" ] || W="$(getenv IOTHING_AUTH_DB_PASSWORD)"
  setenv IOTHING_AUTH_DB_NAME "$N"; setenv IOTHING_AUTH_DB_USER "$U"; setenv IOTHING_AUTH_DB_PASSWORD "$W"
fi
[ -n "$COOKIE" ] || { C="$(getenv IOTHING_COOKIE_DOMAIN)"; ask COOKIE "Domain the sign-in is shared on, e.g. example.com (empty: none)" "$C"; }
[ -n "$COOKIE" ] && setenv IOTHING_COOKIE_DOMAIN "$COOKIE"
[ -n "$OWNER_ACC" ] || { O="$(getenv DATA_OWNER)"; ask OWNER_ACC "Moving from ioHealth 1.x: the account whose health data is already in the database, e.g. alex (a new install: empty)" "$O"; }
[ -n "$OWNER_ACC" ] && setenv DATA_OWNER "$OWNER_ACC"
[ -n "${IOHEALTH_SYNC_TOKEN:-}" ] && setenv SYNC_TOKEN "$IOHEALTH_SYNC_TOKEN"
[ -n "$TZV" ] || { T="$(getenv TZ)"; ask TZV "Time zone" "${T:-$(cat /etc/timezone 2>/dev/null || echo UTC)}"; }
setenv TZ "$TZV"
if [ -z "$PORT" ]; then L="$(getenv LISTEN_ADDR)"; ask PORT "Port" "${L##*:}"; [ -n "$PORT" ] || PORT=47800; fi
setenv LISTEN_ADDR ":$PORT"
if [ -z "$ADMIN" ] && [ "$YES" = 0 ] && [ -t 0 ]; then
  ask AN "First admin, only for an empty account database (empty: none, or make it in the browser)" ""
  if [ -n "$AN" ]; then asksecret AW "Its password (8 or more)"; [ -n "$AW" ] && ADMIN="$AN:$AW"; fi
fi
if [ -n "$ADMIN" ]; then setenv ADMIN_USER "${ADMIN%%:*}"; setenv ADMIN_PASSWORD "${ADMIN#*:}"; fi

# ---- Python environment
say "Installing the Python packages"
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/python -m pip install -q --disable-pip-version-check --upgrade pip
.venv/bin/python -m pip install -q --disable-pip-version-check -e .
chmod 755 run.sh update.sh setup.sh 2>/dev/null || true

# ---- the service
if [ -z "$SERVICE" ]; then
  if command -v systemctl >/dev/null && [ "$(id -u)" = 0 ]; then SERVICE=1; else SERVICE=0; fi
fi
if [ "$SERVICE" = 1 ]; then
  say "Installing the iohealth service"
  RUNAS="$(stat -c %U "$APP" 2>/dev/null || echo root)"
  cat > /etc/systemd/system/iohealth.service <<UNIT
[Unit]
Description=ioHealth
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=$RUNAS
WorkingDirectory=$APP
ExecStart=$APP/run.sh
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable -q iohealth
  systemctl restart iohealth
  # the database is migrated before the server answers: wait for it, as long as the service keeps running
  say "Starting (a 1.x database is migrated first; this can take several minutes)"
  i=0
  until "$APP/.venv/bin/python" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/v1/health', timeout=4)" 2>/dev/null; do
    i=$((i + 5)); sleep 5
    if ! systemctl is-active -q iohealth || [ "$(systemctl show -p NRestarts --value iohealth 2>/dev/null || echo 0)" != 0 ]; then
      journalctl -u iohealth -n 30 --no-pager 2>/dev/null || true
      die "the service stopped while starting (the lines above say why): journalctl -u iohealth -n 100"
    fi
    [ $((i % 60)) = 0 ] && echo "  still starting after ${i}s: $(journalctl -u iohealth -n 1 --no-pager -o cat 2>/dev/null | cut -c1-120)"
    [ "$i" -ge 3600 ] && die "no answer after an hour: journalctl -u iohealth -n 100"
  done
  say "ioHealth runs on port $PORT ($(journalctl -u iohealth --no-pager -o cat 2>/dev/null | grep -c 'applied schema migration') migrations applied in ${i}s or less)"
else
  say "Done. Start it with ./run.sh (port $PORT)"
fi
