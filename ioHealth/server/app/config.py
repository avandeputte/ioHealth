"""Settings, all from the environment (the container's environment or a .env file loaded by docker compose).

The health data lives in MariaDB/MySQL (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD); the accounts live in the
ioThing suite's shared auth database (IOTHING_AUTH_DB_*), which defaults to the same server as the health data.
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

# The shared accounts: the same MariaDB server as the health data unless told otherwise. Set before iothing_auth is
# imported, which reads them once.
os.environ.setdefault("IOTHING_AUTH_DB_HOST", DB_HOST)
os.environ.setdefault("IOTHING_AUTH_DB_PORT", str(DB_PORT))

LISTEN_ADDR = env("LISTEN_ADDR", ":47800")
TLS_CERT_FILE = env("TLS_CERT_FILE")
TLS_KEY_FILE = env("TLS_KEY_FILE")

MAP_TILE_URL = env("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
MAP_TILE_ATTRIBUTION = env("MAP_TILE_ATTRIBUTION", '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors')

# Fallback time zone for days and weeks when a request carries no tz parameter.
TZ = env("TZ", "UTC")

# UPDATE_CHECK=0: never ask GitHub whether a newer version exists (the daily check, Maintenance › ioHealth version)
UPDATE_CHECK = env("UPDATE_CHECK", "1") not in ("0", "false", "no", "off")


def listen() -> tuple:
    host, _, port = LISTEN_ADDR.rpartition(":")
    return host or "0.0.0.0", int(port or 47800)
