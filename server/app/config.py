"""Settings: config.env in the app folder (setup.sh writes it; config.env.example lists them all), or the environment,
which wins (a container's). The names every app of the suite shares come from iosuite_shared.config.standard.

The health data lives in MariaDB/MySQL (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD); the accounts and
suite-wide settings live in the Shared ioSuite database (IOSUITE_DB_*), which iosuite-shared puts on the same server
as the health data unless told otherwise, with database and user `iosuite`.
"""
from pathlib import Path

from iosuite_shared import config as shared

APP = "iohealth"
APP_DIR = Path(__file__).resolve().parent.parent
shared.load_file(APP_DIR)  # first: iosuite_shared reads its settings (the Shared ioSuite database, COOKIE_DOMAIN) from it too
env, env_flag, env_int = shared.env, shared.env_flag, shared.env_int

# DATA_DIR, STATIC_DIR, LOG_FILE (DATA_DIR/iohealth.log; LOG_FILE= with nothing after it: none), HOST, PORT (47800),
# PUBLIC_URL, BASE_URL, FORWARDED_ALLOW_IPS, TLS_CERT_FILE, TLS_KEY_FILE, MCP_FORCED, ADMIN_USER, ADMIN_PASSWORD
globals().update(shared.standard(APP, APP_DIR))

# the health data: {host, port, database, user, password} (the DB_* settings)
_db = shared.own_db("health")
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD = _db["host"], _db["port"], _db["database"], _db["user"], _db["password"]

MAP_TILE_URL = env("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
MAP_TILE_ATTRIBUTION = env("MAP_TILE_ATTRIBUTION", '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')

# Fallback time zone for days and weeks when a request carries no tz parameter.
TZ = env("TZ", "UTC")

# the most a JSON request may carry; the phone's uploads (/v1/) have their own cap, app.upload.MAX_BODY
MAX_JSON_BYTES = 4 << 20
