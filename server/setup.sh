#!/bin/sh
# ioHealth setup without Docker: asks a few questions (or takes flags), then installs the Python packages, writes
# config.env, creates the admin and, on Linux with systemd as root, installs and starts the `iohealth` service and
# waits until it answers.
#
#   ./setup.sh                 ask the questions
#   ./setup.sh --yes ...       no questions: what config.env already holds, the flags below, and the defaults
#
# Flags (the same in every app of the suite):
#   --db HOST:PORT/DB:USER:PASSWORD        the health data (IOHEALTH_DB in the environment does the same, off the command line)
#   --suite-db HOST:PORT/DB:USER:PASSWORD  the Shared ioSuite database (IOHEALTH_SUITE_DB does the same; default: the
#                                          same server, database and user iosuite)
#   --admin NAME:PASS (or IOHEALTH_ADMIN) | --no-admin   --port 47800   --public-url URL   --cookie-domain DOMAIN
#   --service | --no-service   --python PATH   --system-deps | --no-system-deps   --yes
# ioHealth's own: --tz ZONE
# Run it again at any time: it keeps config.env and only changes what you answer.
set -e
cd "$(dirname "$0")"
APP="$(pwd)"
say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
YES=0; DBS=""; SUITES=""; COOKIE=""; PUBURL=""; TZV=""; PORT=""; ADMIN=""; NO_ADMIN=0; SERVICE=""; SYSDEPS=""; PY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift;; --db) DBS="$2"; shift 2;; --suite-db) SUITES="$2"; shift 2;; --cookie-domain) COOKIE="$2"; shift 2;;
    --tz) TZV="$2"; shift 2;; --port) PORT="$2"; shift 2;; --admin) ADMIN="$2"; shift 2;; --no-admin) NO_ADMIN=1; shift;;
    --public-url) PUBURL="$2"; shift 2;;
    --service) SERVICE=1; shift;; --no-service) SERVICE=0; shift;; --system-deps) SYSDEPS=1; shift;; --no-system-deps) SYSDEPS=0; shift;;
    --python) PY="$2"; shift 2;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) die "unknown option $1 (try --help)";;
  esac
done
[ -n "$DBS" ] || DBS="${IOHEALTH_DB:-}"
[ -n "$SUITES" ] || SUITES="${IOHEALTH_SUITE_DB:-}"
[ -n "$ADMIN" ] || ADMIN="${IOHEALTH_ADMIN:-}"
ask() { _v="$1"; _q="$2"; _d="$3"
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then eval "$_v=\"\$_d\""; return; fi
  printf '%s [%s]: ' "$_q" "$_d"; read -r _a || _a=""; [ -n "$_a" ] && eval "$_v=\"\$_a\"" || eval "$_v=\"\$_d\""; }
asksecret() { _v="$1"; _q="$2"
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then eval "$_v=''"; return; fi
  printf '%s: ' "$_q"; stty -echo 2>/dev/null; read -r _a || _a=""; stty echo 2>/dev/null; printf '\n'; eval "$_v=\"\$_a\""; }
ENVF="$APP/config.env"
getenv() { [ -f "$ENVF" ] && sed -n "s/^$1=//p" "$ENVF" | tail -n 1; true; }
split() {  # HOST:PORT/DATABASE:USER:PASSWORD into $1_HOST, $1_PORT, $1_NAME, $1_USER, $1_PASSWORD
  _s="$2"; eval "$1_HOST=\"\${_s%%:*}\""; _r="${_s#*:}"; eval "$1_PORT=\"\${_r%%/*}\""; _r="${_r#*/}"
  eval "$1_NAME=\"\${_r%%:*}\""; _r="${_r#*:}"; eval "$1_USER=\"\${_r%%:*}\""; eval "$1_PASSWORD=\"\${_r#*:}\""; }

# ---- system packages (Python 3.11+ with venv, and git for the iosuite-shared package from the iosuite-shared repository)
if [ "$SYSDEPS" != 0 ] && { ! python3 -c 'import sys, venv, ensurepip; assert sys.version_info >= (3, 11)' 2>/dev/null || ! command -v git >/dev/null; }; then
  say "Installing Python and git"
  if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq python3 python3-venv python3-pip git curl >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q python3 python3-pip git curl
  elif command -v brew >/dev/null; then brew install python git
  else die "install Python 3.11 or newer with venv, and git, then run this again"; fi
fi
PY="${PY:-python3}"

# ---- the answers (what config.env holds is the default)
(umask 077; touch "$ENVF"); chmod 600 "$ENVF"
setenv() { grep -v "^$1=" "$ENVF" > "$ENVF.tmp" || true; printf '%s=%s\n' "$1" "$2" >> "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"; chmod 600 "$ENVF"; }
if [ -n "$DBS" ]; then
  split D "$DBS"
  setenv DB_HOST "$D_HOST"; setenv DB_PORT "$D_PORT"; setenv DB_NAME "$D_NAME"; setenv DB_USER "$D_USER"; setenv DB_PASSWORD "$D_PASSWORD"
elif [ -z "$(getenv DB_HOST)" ] || [ "$YES" = 0 ]; then
  H="$(getenv DB_HOST)"; P="$(getenv DB_PORT)"; D="$(getenv DB_NAME)"; U="$(getenv DB_USER)"
  ask H "MariaDB host (the health data)" "${H:-127.0.0.1}"; ask P "Port" "${P:-3306}"; ask D "Database" "${D:-health}"; ask U "User" "${U:-health}"
  asksecret W "Password (empty: keep the current one)"; [ -n "$W" ] || W="$(getenv DB_PASSWORD)"
  setenv DB_HOST "$H"; setenv DB_PORT "$P"; setenv DB_NAME "$D"; setenv DB_USER "$U"; setenv DB_PASSWORD "$W"
fi
# the Shared ioSuite database (IOSUITE_DB_*)
if [ -n "$SUITES" ]; then
  split A "$SUITES"
  setenv IOSUITE_DB_HOST "$A_HOST"; setenv IOSUITE_DB_PORT "$A_PORT"; setenv IOSUITE_DB_NAME "$A_NAME"
  setenv IOSUITE_DB_USER "$A_USER"; setenv IOSUITE_DB_PASSWORD "$A_PASSWORD"
elif [ "$YES" = 0 ] && [ -t 0 ]; then
  N="$(getenv IOSUITE_DB_NAME)"; U="$(getenv IOSUITE_DB_USER)"
  ask N "Shared ioSuite database (accounts and suite-wide settings, on the same server)" "${N:-iosuite}"; ask U "Its user" "${U:-iosuite}"
  asksecret W "Its password (empty: keep the current one)"; [ -n "$W" ] || W="$(getenv IOSUITE_DB_PASSWORD)"
  setenv IOSUITE_DB_NAME "$N"; setenv IOSUITE_DB_USER "$U"; setenv IOSUITE_DB_PASSWORD "$W"
fi
[ -n "$PUBURL" ] || ask PUBURL "Public address, e.g. https://health.example.com (empty: as reached)" "$(getenv PUBLIC_URL)"
setenv PUBLIC_URL "$PUBURL"
[ -n "$COOKIE" ] || ask COOKIE "Domain the sign-in is shared on, e.g. example.com (empty: this host only)" "$(getenv COOKIE_DOMAIN)"
setenv COOKIE_DOMAIN "$COOKIE"
[ -n "$TZV" ] || { T="$(getenv TZ)"; ask TZV "Time zone" "${T:-$(cat /etc/timezone 2>/dev/null || echo UTC)}"; }
setenv TZ "$TZV"
if [ -z "$PORT" ]; then ask PORT "Port" "$(getenv PORT | grep . || echo 47800)"; [ -n "$PORT" ] || PORT=47800; fi
setenv PORT "$PORT"
if [ -z "$ADMIN" ] && [ "$NO_ADMIN" = 0 ] && [ "$YES" = 0 ] && [ -t 0 ]; then
  ask AN "First admin, only for an empty Shared ioSuite database (empty: none, or make it in the browser)" ""
  if [ -n "$AN" ]; then asksecret AW "Its password (8 or more)"; [ -n "$AW" ] && ADMIN="$AN:$AW"; fi
fi

# ---- Python environment
say "Installing the Python packages"
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/python -m pip install -q --disable-pip-version-check --upgrade pip
.venv/bin/python -m pip install -q --disable-pip-version-check -e .
chmod 755 run.sh update.sh setup.sh 2>/dev/null || true

# ---- the Shared ioSuite database and the first admin (the password through the environment, never on a command line)
say "Shared ioSuite database"
.venv/bin/iosuite-shared --config "$APP" check || die "the Shared ioSuite database does not answer with those settings (IOSUITE_DB_* in config.env)"
if [ -n "$ADMIN" ]; then
  ADMIN_PASSWORD="${ADMIN#*:}" .venv/bin/iosuite-shared --config "$APP" admin "${ADMIN%%:*}" --app iohealth || die "could not create the admin account"
fi

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
EnvironmentFile=$ENVF
ExecStart=$APP/.venv/bin/python -m app
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable -q iohealth
  systemctl restart iohealth
  # the tables are created or migrated before the server answers: wait for it, as long as the service keeps running
  say "Starting"
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
  say "ioHealth runs on port $PORT"
else
  say "Done. Start it with ./run.sh (port $PORT; settings: $ENVF)"
fi
