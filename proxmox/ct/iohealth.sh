#!/usr/bin/env bash
# ioHealth LXC for Proxmox VE, in the community-scripts (ProxmoxVE) framework layout, as ioContacts and ioNotes:
# this is the ct/ script; proxmox/install/iohealth-install.sh runs inside the container.
#
# After the framework's own questions (resources, network) it asks about the app, as the other apps' scripts do: the
# MariaDB server, database, user and password for the health data, the same for the Shared ioSuite database
# (accounts and suite-wide settings, the one ioPix, ioNotes and ioContacts use), the cookie domain, the first account, the time zone and the port. It
# creates the container, puts the
# server in /opt/iohealth/app and runs its setup.sh inside, which installs the
# packages, writes config.env, installs the iohealth service and waits until it answers.
#
# Run on the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/avandeputte/iohealth/main/proxmox/ct/iohealth.sh)"
# Unattended: IOHEALTH_DB=host:port/db:user:password IOHEALTH_SUITE_DB=host:port/db:user:password
#   IOHEALTH_TZ=Europe/Brussels IOHEALTH_PORT=8650 IOHEALTH_PUBLIC_URL=https://health.example.com IOHEALTH_COOKIE_DOMAIN=example.com IOHEALTH_ADMIN=name:password
#   in the environment answer the questions in advance. IOHEALTH_REF=<branch|sha> installs that instead of main.
IOHEALTH_REF="${IOHEALTH_REF:-main}"
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/avandeputte/iohealth/${IOHEALTH_REF}/proxmox}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2026 Alex Van de Putte
# License: GPL-3.0-or-later
# Source: https://github.com/avandeputte/iohealth

APP="iohealth"
var_tags="${var_tags:-health;fitness}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-1024}"
var_disk="${var_disk:-4}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

# ---- the app's own questions (whiptail on the host, as the other apps' scripts ask them; IOHEALTH_* in the
# environment answer them in advance for unattended runs)
ask_app_settings() {
  local bt="ioHealth" h p d u w
  if [[ -z "${IOHEALTH_DB:-}" ]]; then
    h=$(whiptail --backtitle "$bt" --inputbox "MariaDB / MySQL host or IP (the health data is kept there)" 9 70 "127.0.0.1" 3>&1 1>&2 2>&3) || exit 1
    p=$(whiptail --backtitle "$bt" --inputbox "Port" 9 60 "3306" 3>&1 1>&2 2>&3) || exit 1
    d=$(whiptail --backtitle "$bt" --inputbox "Database for the health data (created if the user may)" 9 70 "health" 3>&1 1>&2 2>&3) || exit 1
    u=$(whiptail --backtitle "$bt" --inputbox "User" 9 60 "health" 3>&1 1>&2 2>&3) || exit 1
    w=$(whiptail --backtitle "$bt" --passwordbox "Password" 9 60 3>&1 1>&2 2>&3) || exit 1
    IOHEALTH_DB="$h:$p/$d:$u:$w"
  fi
  local dbhost="${IOHEALTH_DB%%:*}" r="${IOHEALTH_DB#*:}"; local dbport="${r%%/*}"
  if [[ -z "${IOHEALTH_SUITE_DB:-}" ]]; then
    h=$(whiptail --backtitle "$bt" --inputbox "Host of the Shared ioSuite database, the one ioPix, ioNotes and ioContacts use (accounts, passwords, sessions and suite-wide settings are shared)" 11 76 "$dbhost" 3>&1 1>&2 2>&3) || exit 1
    p=$(whiptail --backtitle "$bt" --inputbox "Port" 9 60 "$dbport" 3>&1 1>&2 2>&3) || exit 1
    d=$(whiptail --backtitle "$bt" --inputbox "Shared ioSuite database (created if the user may)" 9 70 "iosuite" 3>&1 1>&2 2>&3) || exit 1
    u=$(whiptail --backtitle "$bt" --inputbox "Its user" 9 60 "iosuite" 3>&1 1>&2 2>&3) || exit 1
    w=$(whiptail --backtitle "$bt" --passwordbox "Its password" 9 60 3>&1 1>&2 2>&3) || exit 1
    IOHEALTH_SUITE_DB="$h:$p/$d:$u:$w"
  fi
  if [[ -z "${IOHEALTH_PUBLIC_URL+x}" ]]; then
    IOHEALTH_PUBLIC_URL=$(whiptail --backtitle "$bt" --inputbox "Public address behind your reverse proxy, e.g. https://health.example.com (empty: the address it is reached at)" 10 76 "" 3>&1 1>&2 2>&3) || exit 1
  fi
  if [[ -z "${IOHEALTH_COOKIE_DOMAIN+x}" ]]; then
    IOHEALTH_COOKIE_DOMAIN=$(whiptail --backtitle "$bt" --inputbox "Domain the sign-in is shared on, as for the other apps (e.g. example.com; empty: none)" 9 76 "" 3>&1 1>&2 2>&3) || exit 1
  fi
  if [[ -z "${IOHEALTH_ADMIN+x}" ]]; then
    local an aw
    an=$(whiptail --backtitle "$bt" --inputbox "First account's user name, used only when the Shared ioSuite database is still empty (the suite's existing accounts work as they are)" 11 76 "admin" 3>&1 1>&2 2>&3) || exit 1
    aw=$(whiptail --backtitle "$bt" --passwordbox "Its password (8 characters or more; empty: make the first account from the sign-in screen instead)" 10 72 3>&1 1>&2 2>&3) || exit 1
    [[ -n "$aw" ]] && IOHEALTH_ADMIN="$an:$aw" || IOHEALTH_ADMIN=""
  fi
  local hosttz; hosttz="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo UTC)"
  IOHEALTH_TZ="${IOHEALTH_TZ:-$(whiptail --backtitle "$bt" --inputbox "Time zone for days and weeks" 9 60 "$hosttz" 3>&1 1>&2 2>&3)}" || exit 1
  IOHEALTH_PORT="${IOHEALTH_PORT:-$(whiptail --backtitle "$bt" --inputbox "Port (the phone's uploads and the web app)" 9 60 "8650" 3>&1 1>&2 2>&3)}" || exit 1
  if [[ -z "${IOHEALTH_DB_ADMIN+x}" ]]; then  # a MariaDB administrator: the databases and users above are created for you (empty: they exist)
    local dau daw
    dau=$(whiptail --backtitle "$bt" --inputbox "MariaDB administrator who may create the databases and users above, e.g. root (empty: they exist already)" 10 76 "" 3>&1 1>&2 2>&3) || exit 1
    if [[ -n "$dau" ]]; then
      daw=$(whiptail --backtitle "$bt" --passwordbox "Password of $dau" 9 60 3>&1 1>&2 2>&3) || exit 1
      IOHEALTH_DB_ADMIN="$dau:$daw"
    else
      IOHEALTH_DB_ADMIN=""
    fi
  fi
  if [[ -z "${IOHEALTH_ALSO+x}" ]]; then  # the other apps of the suite in the same container (ioPix has its own script: photo mounts)
    IOHEALTH_ALSO=$(whiptail --backtitle "$bt" --checklist "Also install in this container (same database server, each app its own database; same accounts and admin; each on its usual port):" 14 78 4 \
      iosuite "ioSuite (the start page)  (8630)" OFF \
      iocalendar "ioCalendar  (8620)" OFF \
      iocontacts "ioContacts  (8640, LDAP 3890)" OFF \
      ionotes "ionotes  (8610)" OFF 3>&1 1>&2 2>&3) || exit 1
    IOHEALTH_ALSO=$(echo "$IOHEALTH_ALSO" | tr -d '"' | tr ' ' ',')
  fi
  if [[ -n "$IOHEALTH_ALSO" ]]; then  # room for more than one app
    (( var_ram < 2048 )) && var_ram=2048; (( var_disk < 8 )) && var_disk=8
  fi
}

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/iohealth/app/app ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi
  msg_info "Updating ${APP}"
  # the app's own updater: latest code, same settings and data, service restarted
  if sh /opt/iohealth/app/update.sh; then msg_ok "Updated successfully!"; else msg_error "update.sh failed; see the lines above"; exit 1; fi
  exit
}

if command -v pveversion >/dev/null 2>&1; then ask_app_settings; fi  # on the Proxmox host; inside the container `update` needs no answers
start
build_container
description

msg_info "Fetching ioHealth ($IOHEALTH_REF)"
# COMMIT records what was installed (update.sh compares against it)
FETCH='set -e; cd /tmp; rm -rf iohealth-src; mkdir iohealth-src; cd iohealth-src
sha=$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/avandeputte/iohealth/commits/'"$IOHEALTH_REF"'" | python3 -c "import sys, json; print(json.load(sys.stdin)[\"sha\"])")
curl -fsSL "https://github.com/avandeputte/iohealth/archive/$sha.tar.gz" | tar xz
src=$(ls -d */ | head -1)
mkdir -p /opt/iohealth/app
for i in app static proxmox pyproject.toml README.md LICENSE run.sh update.sh setup.sh Dockerfile docker-compose.yml config.env.example; do cp -R "$src/$i" /opt/iohealth/app/; done
echo "$sha" > /opt/iohealth/app/COMMIT
cd /tmp; rm -rf iohealth-src'
if ! pct exec "$CTID" -- bash -c "$FETCH"; then msg_error "Could not fetch ioHealth from GitHub inside the container"; exit 1; fi
msg_ok "Fetched ioHealth $(pct exec "$CTID" -- cut -c1-7 /opt/iohealth/app/COMMIT)"

msg_info "Running the app's setup inside the container (packages, settings, tables, first account, service)"
# the answers with passwords go in as a root-only file (pushed, read into setup.sh's environment, removed), never as arguments
SECRETS="IOHEALTH_DB=$(printf '%q' "$IOHEALTH_DB")"$'\n'"IOHEALTH_SUITE_DB=$(printf '%q' "$IOHEALTH_SUITE_DB")"$'\n'
[[ -n "${IOHEALTH_ADMIN:-}" ]] && SECRETS+="IOHEALTH_ADMIN=$(printf '%q' "$IOHEALTH_ADMIN")"$'\n'
[[ -n "${IOHEALTH_DB_ADMIN:-}" ]] && SECRETS+="IOHEALTH_DB_ADMIN=$(printf '%q' "$IOHEALTH_DB_ADMIN")"$'\n'
SECF="$(mktemp)"; chmod 600 "$SECF"; printf '%s' "$SECRETS" > "$SECF"
pct push "$CTID" "$SECF" /opt/iohealth/setup.env --perms 0600 --user 0 --group 0
rm -f "$SECF"
SETUP_CMD="cd /opt/iohealth/app && sh ./setup.sh --yes --no-system-deps --service --port '${IOHEALTH_PORT:-8650}' --tz '${IOHEALTH_TZ:-UTC}' --public-url '${IOHEALTH_PUBLIC_URL:-}' --cookie-domain '${IOHEALTH_COOKIE_DOMAIN:-}' --also '${IOHEALTH_ALSO:-none}'"
WRAPPED="set -a; . /opt/iohealth/setup.env; set +a; rm -f /opt/iohealth/setup.env; $SETUP_CMD > /opt/iohealth/setup.log 2>&1"
if ! pct exec "$CTID" -- bash -c "$WRAPPED"; then
  msg_error "setup.sh failed inside the container; last lines of /opt/iohealth/setup.log:"
  pct exec "$CTID" -- tail -n 40 /opt/iohealth/setup.log || true
  msg_error "Fix the cause (often: the MariaDB users may not connect from the container's address ${IP}), then run it again inside the container: pct exec $CTID -- bash -c \"$SETUP_CMD\" (the settings are kept in /opt/iohealth/app/config.env)"
  exit 1
fi
msg_ok "Setup finished"
pct exec "$CTID" -- tail -n 1 /opt/iohealth/setup.log || true

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL (the phone's server address too):${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:${IOHEALTH_PORT:-8650}${CL}"
for a in ${IOHEALTH_ALSO//,/ }; do
  case "$a" in iosuite) p=8630;; iocalendar) p=8620;; iocontacts) p=8640;; ionotes) p=8610;; iohealth) p=8650;; iopix) p=8600;; *) p="";; esac
  [[ -n "$p" ]] && echo -e "${INFO}${YW}$a:${CL} ${BGN}http://${IP}:$p${CL}"
done
