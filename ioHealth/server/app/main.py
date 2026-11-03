"""ioHealth: the iPhone app's upload API and the fitness web app, on one port (47800), over the ioThing suite's
shared accounts (iothing-auth, as in ioPix, ioNotes and ioContacts).

Who may call a route is declared on the route (app/access.py); iothing-auth's middleware works out who is asking
(the shared session cookie, the identity a reverse proxy such as Cloudflare Access vouches for, or a bearer app
password), whether sign-in is required at all (it always is here: health data is private), and refuses cross-site
writes. The phone's old SYNC_TOKEN is still taken, for the data owner's account.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from iothing_auth import users as shared
from iothing_auth.proxyauth import remember_peer

from app import config, db, upload, webapi
from app.auth import APP, auth, data_owner_id, sync_token_user

remember_peer()  # before uvicorn's forwarded-header rewrite runs: proxy sign-in trusts the real peer

log = logging.getLogger("app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# what a visitor may still fetch: the app shell (which shows the sign-in), the icons and the phone's endpoints
OPEN_PATHS = ("/", "/index.html", "/app.js", "/app.css", "/favicon.svg", "/manifest.webmanifest", "/apple-touch-icon.png", "/v1/health")
OPEN_PREFIXES = ("/vendor/", "/icon-", "/api/auth/", "/v1/")


@asynccontextmanager
async def lifespan(_app):
    db.wait_for_server()
    shared.init()
    db.migrate(data_owner_id)
    webapi.start_backfill()
    log.info("ioHealth started, writing to %s:%s/%s (%s)", db.params()["host"], db.params()["port"], db.params()["database"],
             "accounts exist" if shared.any_users() else "no accounts yet: create the first one from the sign-in screen, inside your network")
    yield


app = FastAPI(title="ioHealth", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def _open(path: str) -> bool:
    return path in OPEN_PATHS or path.startswith(OPEN_PREFIXES)


def _before(request: Request):
    """Once the user is known: the old SYNC_TOKEN signs the phone in as the data owner."""
    if request.state.user is None and request.url.path.startswith("/v1/"):
        u = sync_token_user(request)
        if u:
            request.state.user = u
    return None


app.middleware("http")(auth.middleware(is_open=_open, before=_before))
upload.on_sync.append(webapi.sync_finished)


@app.middleware("http")
async def _headers(request: Request, call_next):
    response = await call_next(request)
    p = request.url.path
    if p.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    elif p in ("/", "/index.html", "/app.js", "/app.css"):
        response.headers.setdefault("Cache-Control", "no-cache")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.exception_handler(HTTPException)
async def _http_error(request: Request, e: HTTPException):
    """Both spellings: the phone reads `error` (ioHealth 1.x), the shared sign-in pages read `detail`."""
    return JSONResponse({"error": e.detail, "detail": e.detail}, status_code=e.status_code, headers=getattr(e, "headers", None))


@app.exception_handler(ValueError)
async def _bad_input(request: Request, e: Exception):
    log.warning("bad input on %s %s: %s", request.method, request.url.path, str(e)[:200])
    msg = f"Bad request: {str(e)[:200]}"
    return JSONResponse({"error": msg, "detail": msg}, status_code=400)


app.include_router(auth.router())        # /api/auth/*: login, accounts, logout, me, settings, password, setup, sessions, app-passwords, proxy
app.include_router(auth.users_router())  # /api/users: this app's admins
app.include_router(upload.router)
app.include_router(webapi.router)
app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")

__all__ = ["app", "APP"]
