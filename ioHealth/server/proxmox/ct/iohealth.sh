#!/usr/bin/env bash
# ioHealth LXC for Proxmox VE, in the community-scripts (ProxmoxVE) framework layout, as ioContacts and ioNotes:
# this is the ct/ script; proxmox/install/iohealth-install.sh runs inside the container.
#
# After the framework's own questions (resources, network) it asks about the app, as the other apps' scripts do: the
# MariaDB server, database, user and password for the health data, the same for the suite's shared account database
# (the one ioPix, ioNotes and ioContacts use), the cookie domain, the first account, and, when moving from 1.x, whose
# data is already there and its upload token; then the time zone and the port. It creates the container, puts the
# server (ioHealth/server of the repository) in /opt/iohealth/app and runs its setup.sh inside, which installs the
# packages, writes .env, installs the iohealth service and waits until it answers.
#
# Run on the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/avandeputte/ioHealth/main/ioHealth/server/proxmox/ct/iohealth.sh)"
# Unattended: IOHEALTH_DB=host:port/db:user:password IOHEALTH_AUTH_DB=host:port/db:user:password
#   IOHEALTH_SYNC_TOKEN=... IOHEALTH_DATA_OWNER=alex IOHEALTH_TZ=Europe/Brussels IOHEALTH_PORT=47800
#   IOHEALTH_COOKIE_DOMAIN=example.com IOHEALTH_ADMIN=name:password IOHEALTH_UNATTENDED=1 (no "old one stopped?" question)
#   in the environment answer the questions in advance. IOHEALTH_REF=<branch|sha> installs that instead of main.
IOHEALTH_REF="${IOHEALTH_REF:-main}"
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/avandeputte/ioHealth/${IOHEALTH_REF}/ioHealth/server/proxmox}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2026 Alex Van de Putte
# License: MIT
# Source: https://github.com/avandeputte/ioHealth

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
    h=$(whiptail --backtitle "$bt" --inputbox "MariaDB / MySQL host or IP (the health data is kept there)" 9 70 "192.168.1.89" 3>&1 1>&2 2>&3) || exit 1
    p=$(whiptail --backtitle "$bt" --inputbox "Port" 9 60 "3306" 3>&1 1>&2 2>&3) || exit 1
    d=$(whiptail --backtitle "$bt" --inputbox "Database for the health data (created if the user may)" 9 70 "health" 3>&1 1>&2 2>&3) || exit 1
    u=$(whiptail --backtitle "$bt" --inputbox "User" 9 60 "health" 3>&1 1>&2 2>&3) || exit 1
    w=$(whiptail --backtitle "$bt" --passwordbox "Password" 9 60 3>&1 1>&2 2>&3) || exit 1
    IOHEALTH_DB="$h:$p/$d:$u:$w"
  fi
  local dbhost="${IOHEALTH_DB%%:*}" r="${IOHEALTH_DB#*:}"; local dbport="${r%%/*}"
  if [[ -z "${IOHEALTH_AUTH_DB:-}" ]]; then
    h=$(whiptail --backtitle "$bt" --inputbox "Host of the suite's shared account database, the one ioPix, ioNotes and ioContacts sign in against (accounts, passwords and sessions are shared)" 11 76 "$dbhost" 3>&1 1>&2 2>&3) || exit 1
    p=$(whiptail --backtitle "$bt" --inputbox "Port" 9 60 "$dbport" 3>&1 1>&2 2>&3) || exit 1
    d=$(whiptail --backtitle "$bt" --inputbox "Account database (created if the user may)" 9 70 "auth" 3>&1 1>&2 2>&3) || exit 1
    u=$(whiptail --backtitle "$bt" --inputbox "Its user" 9 60 "auth" 3>&1 1>&2 2>&3) || exit 1
    w=$(whiptail --backtitle "$bt" --passwordbox "Its password" 9 60 3>&1 1>&2 2>&3) || exit 1
    IOHEALTH_AUTH_DB="$h:$p/$d:$u:$w"
  fi
  if [[ -z "${IOHEALTH_COOKIE_DOMAIN+x}" ]]; then
    IOHEALTH_COOKIE_DOMAIN=$(whiptail --backtitle "$bt" --inputbox "Domain the sign-in is shared on, as for the other apps (e.g. example.com; empty: none)" 9 76 "" 3>&1 1>&2 2>&3) || exit 1
  fi
  if [[ -z "${IOHEALTH_ADMIN+x}" ]]; then
    local an aw
    an=$(whiptail --backtitle "$bt" --inputbox "First account's user name, used only when the shared account database is still empty (the suite's existing accounts work as they are)" 11 76 "admin" 3>&1 1>&2 2>&3) || exit 1
    aw=$(whiptail --backtitle "$bt" --passwordbox "Its password (8 characters or more; empty: make the first account from the sign-in screen instead)" 10 72 3>&1 1>&2 2>&3) || exit 1
    [[ -n "$aw" ]] && IOHEALTH_ADMIN="$an:$aw" || IOHEALTH_ADMIN=""
  fi
  if [[ -z "${IOHEALTH_DATA_OWNER+x}" ]]; then
    IOHEALTH_DATA_OWNER=$(whiptail --backtitle "$bt" --inputbox "Moving from ioHealth 1.x: the name of the account whose health data is already in the database, e.g. alex (required then: the server refuses to start without it; a new install leaves it empty)" 11 76 "" 3>&1 1>&2 2>&3) || exit 1
  fi
  if [[ -z "${IOHEALTH_SYNC_TOKEN+x}" ]]; then
    IOHEALTH_SYNC_TOKEN=$(whiptail --backtitle "$bt" --passwordbox "Moving from ioHealth 1.x: its upload token (SYNC_TOKEN), so the phone keeps syncing as that account until it gets an app password (empty: none)" 11 76 3>&1 1>&2 2>&3) || exit 1
  fi
  local hosttz; hosttz="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo UTC)"
  IOHEALTH_TZ="${IOHEALTH_TZ:-$(whiptail --backtitle "$bt" --inputbox "Time zone for days and weeks" 9 60 "$hosttz" 3>&1 1>&2 2>&3)}" || exit 1
  IOHEALTH_PORT="${IOHEALTH_PORT:-$(whiptail --backtitle "$bt" --inputbox "Port (the phone's uploads and the web app)" 9 60 "47800" 3>&1 1>&2 2>&3)}" || exit 1
  if [[ -z "${IOHEALTH_UNATTENDED:-}" ]]; then
    whiptail --backtitle "$bt" --yesno "Is the old ioHealth (Docker or 1.x) stopped, or is this a new install?\n\nThe first start of 2.0 migrates a 1.x database to accounts; the old receiver must not write to it meanwhile. The phone keeps its samples and sends them once the new server answers." 13 72 || { msg_error "Stop the old ioHealth first, then run this again"; exit 1; }
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
# the server is ioHealth/server of the repository; COMMIT records what was installed (update.sh compares against it)
FETCH='set -e; cd /tmp; rm -rf iohealth-src; mkdir iohealth-src; cd iohealth-src
sha=$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/avandeputte/ioHealth/commits/'"$IOHEALTH_REF"'" | python3 -c "import sys, json; print(json.load(sys.stdin)[\"sha\"])")
curl -fsSL "https://github.com/avandeputte/ioHealth/archive/$sha.tar.gz" | tar xz
src=$(ls -d */ | head -1)ioHealth/server
mkdir -p /opt/iohealth/app
for i in app static pyproject.toml run.sh update.sh setup.sh .env.example; do cp -R "$src/$i" /opt/iohealth/app/; done
echo "$sha" > /opt/iohealth/app/COMMIT
cd /tmp; rm -rf iohealth-src'
if ! pct exec "$CTID" -- bash -c "$FETCH"; then msg_error "Could not fetch ioHealth from GitHub inside the container"; exit 1; fi
msg_ok "Fetched ioHealth $(pct exec "$CTID" -- cut -c1-7 /opt/iohealth/app/COMMIT)"

msg_info "Running the app's setup inside the container (packages, settings, service; a 1.x database is migrated now, which can take several minutes)"
# the answers with passwords go in as a root-only file (pushed, read into setup.sh's environment, removed), never as arguments
SECRETS="IOHEALTH_DB=$(printf '%q' "$IOHEALTH_DB")"$'\n'"IOHEALTH_AUTH_DB=$(printf '%q' "$IOHEALTH_AUTH_DB")"$'\n'
[[ -n "${IOHEALTH_SYNC_TOKEN:-}" ]] && SECRETS+="IOHEALTH_SYNC_TOKEN=$(printf '%q' "$IOHEALTH_SYNC_TOKEN")"$'\n'
[[ -n "${IOHEALTH_ADMIN:-}" ]] && SECRETS+="IOHEALTH_ADMIN=$(printf '%q' "$IOHEALTH_ADMIN")"$'\n'
SECF="$(mktemp)"; chmod 600 "$SECF"; printf '%s' "$SECRETS" > "$SECF"
pct push "$CTID" "$SECF" /opt/iohealth/setup.env --perms 0600 --user 0 --group 0
rm -f "$SECF"
SETUP_CMD="cd /opt/iohealth/app && sh ./setup.sh --yes --no-system-deps --service --port '${IOHEALTH_PORT:-47800}' --tz '${IOHEALTH_TZ:-UTC}'"
[[ -n "${IOHEALTH_DATA_OWNER:-}" ]] && SETUP_CMD+=" --data-owner '${IOHEALTH_DATA_OWNER}'"
[[ -n "${IOHEALTH_COOKIE_DOMAIN:-}" ]] && SETUP_CMD+=" --cookie-domain '${IOHEALTH_COOKIE_DOMAIN}'"
WRAPPED="set -a; . /opt/iohealth/setup.env; set +a; rm -f /opt/iohealth/setup.env; $SETUP_CMD > /opt/iohealth/setup.log 2>&1"
if ! pct exec "$CTID" -- bash -c "$WRAPPED"; then
  msg_error "setup.sh failed inside the container; last lines of /opt/iohealth/setup.log:"
  pct exec "$CTID" -- tail -n 40 /opt/iohealth/setup.log || true
  msg_error "Fix the cause (often: the MariaDB users may not connect from the container's address ${IP}), then run it again inside the container: pct exec $CTID -- bash -c \"$SETUP_CMD\" (the settings are kept in /opt/iohealth/app/.env)"
  exit 1
fi
msg_ok "Setup finished"
pct exec "$CTID" -- tail -n 1 /opt/iohealth/setup.log || true

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL (the phone's server address too):${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:${IOHEALTH_PORT:-47800}${CL}"
