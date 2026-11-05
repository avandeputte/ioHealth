"""Settings, all from the environment (the container's environment or a .env file loaded by docker compose).

The health data lives in MariaDB/MySQL (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD); the accounts and
suite-wide settings live in the Shared ioSuite database (IOTHING_AUTH_DB_*, the names the iothing-auth library reads),
which defaults to the same server as the health data, with database and user `iosuite`.
"""
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = APP_DIR / "static"


def env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if v is not None and v.strip() != "" else default


DB_HOST = env("DB_HOST", "127.0.0.1")
DB_PORT = int(env("DB_PORT", "3306"))
DB_USER = env("DB_USER", "health")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
DB_NAME = env("DB_NAME", "health")

# The Shared ioSuite database: the same MariaDB server as the health data unless told otherwise, `iosuite` for the
# database and its user. Set before iothing_auth is imported, which reads them once.
os.environ.setdefault("IOTHING_AUTH_DB_HOST", DB_HOST)
os.environ.setdefault("IOTHING_AUTH_DB_PORT", str(DB_PORT))
SUITE_DB_NAME = env("IOTHING_AUTH_DB_NAME", "iosuite")
os.environ["IOTHING_AUTH_DB_NAME"] = SUITE_DB_NAME
os.environ["IOTHING_AUTH_DB_USER"] = env("IOTHING_AUTH_DB_USER", "iosuite")

LISTEN_ADDR = env("LISTEN_ADDR", ":47800")
TLS_CERT_FILE = env("TLS_CERT_FILE")
TLS_KEY_FILE = env("TLS_KEY_FILE")

MAP_TILE_URL = env("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
MAP_TILE_ATTRIBUTION = env("MAP_TILE_ATTRIBUTION", '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')

# Fallback time zone for days and weeks when a request carries no tz parameter.
TZ = env("TZ", "UTC")

# PUBLIC_URL: the address the suite's start page and other apps link to (https://health.example.com). Empty: the best
# address ioHealth is reached at, noted by iothing-auth (a host under IOTHING_COOKIE_DOMAIN over HTTPS first).
PUBLIC_URL = env("PUBLIC_URL").rstrip("/")

# the server log, for Maintenance › Updates and logs (empty: none). Updates: IOHEALTH_REPO, IOHEALTH_BRANCH and
# UPDATE_CHECK are read by iothing_auth.updates (app.auth.updater)
LOG_FILE = Path(env("LOG_FILE", str(APP_DIR / "iohealth.log"))) if env("LOG_FILE", "x") else None


def listen() -> tuple:
    host, _, port = LISTEN_ADDR.rpartition(":")
    return host or "0.0.0.0", int(port or 47800)
