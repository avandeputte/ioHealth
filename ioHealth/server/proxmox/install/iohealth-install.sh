#!/usr/bin/env bash

# Copyright (c) 2026 Alex Van de Putte
# License: MIT
# Source: https://github.com/avandeputte/ioHealth
# ioHealth: runs inside the LXC, driven by proxmox/ct/iohealth.sh (community-scripts framework).
# This only installs the system packages; the ct script then puts the code in /opt/iohealth/app and runs the app's
# own setup.sh inside the container with the answers given on the host (databases, accounts, service).

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt-get install -y \
  git \
  python3 \
  python3-venv \
  python3-pip \
  mariadb-client \
  curl
msg_ok "Installed Dependencies"
mkdir -p /opt/iohealth/app

motd_ssh
customize

msg_info "Cleaning up"
$STD apt-get -y autoremove
$STD apt-get -y autoclean
msg_ok "Cleaned"
