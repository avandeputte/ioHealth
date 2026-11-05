"""Settings: config.env in the app folder (setup.sh writes it; config.env.example lists them all), or the environment,
which wins (a container's).

The health data lives in MariaDB/MySQL (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD); the accounts and
suite-wide settings live in the Shared ioSuite database (IOSUITE_DB_*), which iosuite-shared puts on the same server
as the health data unless told otherwise, with database and user `iosuite`.
"""
import os
from pathlib import Path

from iosuite_shared import config as shared

APP_DIR = Path(__file__).resolve().parent.parent
shared.load_file(APP_DIR)  # first: iosuite_shared reads its settings (the Shared ioSuite database, COOKIE_DOMAIN) from it too
env, env_flag, env_int = shared.env, shared.env_flag, shared.env_int
STATIC_DIR = APP_DIR / "static"

DB_HOST = env("DB_HOST", "127.0.0.1")
DB_PORT = env_int("DB_PORT", 3306)
DB_USER = env("DB_USER", "health")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
DB_NAME = env("DB_NAME", "health")

# where the server listens (python -m app); every app of the suite has its own default port (iosuite_shared.suite.PORTS)
HOST = env("HOST", "0.0.0.0")
PORT = env_int("PORT", 47800)
# the addresses that may tell the server the visitor's address and scheme (X-Forwarded-For / -Proto): * (any), or a
# comma-separated list such as the reverse proxy's
FORWARDED_ALLOW_IPS = env("FORWARDED_ALLOW_IPS", "*")
# HTTPS served directly instead of behind a reverse proxy: both files
TLS_CERT_FILE = env("TLS_CERT_FILE")
TLS_KEY_FILE = env("TLS_KEY_FILE")

MAP_TILE_URL = env("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
MAP_TILE_ATTRIBUTION = env("MAP_TILE_ATTRIBUTION", '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')

# Fallback time zone for days and weeks when a request carries no tz parameter.
TZ = env("TZ", "UTC")

# PUBLIC_URL: the address the suite's start page and other apps link to (https://health.example.com). Empty: the best
# address ioHealth is reached at, noted by iosuite-shared (a host under COOKIE_DOMAIN over HTTPS first).
PUBLIC_URL = env("PUBLIC_URL").rstrip("/")

# the server log, for Maintenance › Updates and logs (empty: none). Updates: IOHEALTH_REPO, IOHEALTH_BRANCH and
# UPDATE_CHECK are read by iosuite_shared.updates (app.auth.updater)
LOG_FILE = Path(env("LOG_FILE", str(APP_DIR / "iohealth.log"))).expanduser() if os.environ.get("LOG_FILE", "x") else None
