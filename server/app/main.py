"""ioHealth: the iPhone app's upload API and the fitness web app, on one port (47800), over the ioThing suite's
shared accounts (iosuite-shared, as in every app of the suite).

Who may call a route is declared on the route (app/access.py); iosuite-shared's middleware works out who is asking
(the shared session cookie, the identity a reverse proxy such as Cloudflare Access vouches for, or a bearer app
password), whether sign-in is required at all (it always is here: health data is private), and refuses cross-site
writes.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from iosuite_shared import users as shared
from iosuite_shared.updates import setup_log

from app import __version__, config, db, maintenance, upload, webapi
from app.auth import APP, auth, updater

setup_log(config.LOG_FILE)  # the server log that Maintenance › Updates and logs shows; the app runs without it
log = logging.getLogger("app")

# what a visitor may still fetch: the app shell (which shows the sign-in), its files (/static/), the API docs and the
# phone's endpoints (which check the app password themselves)
OPEN_PATHS = ("/", "/manifest.webmanifest", "/api/docs", "/api/openapi.json", "/v1/health")
OPEN_PREFIXES = ("/static/", "/v1/")


@asynccontextmanager
async def lifespan(_app):
    db.wait_for_server()
    shared.init()
    db.migrate()
    webapi.start_backfill()
    updater.start_daily()
    log.info("ioHealth started, writing to %s:%s/%s (%s)", db.params()["host"], db.params()["port"], db.params()["database"],
             "accounts exist" if shared.any_users() else "no accounts yet: create the first one from the sign-in screen, inside your network")
    yield


app = FastAPI(title="ioHealth", version=__version__, lifespan=lifespan, docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json",
              description="Apple Health data from the iPhone in your own MariaDB: the phone uploads to /v1/, the web app reads /api/. "
                          "Every figure is the signed-in account's own.")

# who is asking, whether sign-in is required at all, the cross-site check on writes: iosuite-shared's middleware
app.middleware("http")(auth.middleware(open_paths=OPEN_PATHS, open_prefixes=OPEN_PREFIXES))
upload.on_sync.append(webapi.sync_finished)


def _limit_for(path: str, ctype: str) -> int:
    if path.startswith("/v1/"):  # the phone's batches: app.upload counts them itself, after decompression
        return upload.MAX_BODY
    return config.MAX_JSON_BYTES


# 400 for bad input, the headers, no-store on the API, the body cap: the same in every app of the suite. The error
# JSON carries `error` beside `detail`: the phone reads `error` (ioHealth 1.x), the shared sign-in pages read `detail`.
auth.install(app, limit_for=_limit_for, error_key="error", forwarded_allow_ips=config.FORWARDED_ALLOW_IPS)  # also X-Forwarded-* from those proxies


def _status_extra(request) -> dict:
    """ioHealth's own fields of GET /api/status, beside the suite's: the schema and the map tiles for everyone, and for an
    account its last sync."""
    out = {"schemaVersion": db.schema_version(), "tiles": {"url": config.MAP_TILE_URL, "attribution": config.MAP_TILE_ATTRIBUTION}}
    u = request.state.user
    if u:
        out.update(webapi.last_sync(int(u["id"])))
    return out


app.include_router(auth.router())        # /api/auth/*: login, accounts, logout, me, settings, password, setup, sessions, app-passwords, proxy
app.include_router(auth.users_router())  # /api/users: this app's admins
app.include_router(auth.admin_router())  # /api/suite-admin (+ ui.js, the Settings › Suite panel): the whole suite (suite admins)
app.include_router(auth.status_router(updater, extra=_status_extra))  # /api/status: public, the same shape in every app
app.include_router(upload.router)
app.include_router(webapi.router)


def _server_info() -> dict:
    """What Maintenance › Updates and logs and Settings › Server show beside the updater's own fields."""
    p = db.params()
    return {"timezone": config.TZ, "database": f"{p['host']}:{p['port']}/{p['database']}", "schemaVersion": db.schema_version()}


app.include_router(auth.server_router(updater, log_file=config.LOG_FILE, info=_server_info))  # /api/server, /api/log: admins
app.include_router(maintenance.router)  # /api/maintenance: admins


@app.get("/", include_in_schema=False)
def index():
    """The page, with the version stamped on the script and stylesheet: after an update the browser (and Cloudflare,
    which caches .js and .css at the edge) fetches the new ones instead of serving what it kept."""
    html = (config.STATIC_DIR / "index.html").read_text(encoding="utf-8")
    for f in ("static/app.js", "static/app.css"):
        html = html.replace(f'"{f}"', f'"{f}?v={__version__}"')
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(config.STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")

__all__ = ["app", "APP"]
