"""The shared ioThing accounts (iothing-auth), as ioHealth uses them.

Accounts, passwords, sessions and roles live in the suite's auth database (IOTHING_AUTH_DB_*), shared with ioPix,
ioNotes and ioContacts: one sign-in serves every app on the domain (IOTHING_COOKIE_DOMAIN). What is ioHealth's own
stays here: the role an account holds in ioHealth, and its health data, which nobody else sees.

Roles: a viewer sees their own data; an editor can also upload it (the iPhone app signs in as an editor, with an
app password); an admin can also manage the accounts and the sign-in settings.
"""
import logging
import time

from fastapi import HTTPException, Request
from iothing_auth import users as shared
from iothing_auth.fastapi import Auth

from app import config

APP = "iohealth"
log = logging.getLogger("app.auth")

auth = Auth(APP, app_label="ioHealth")

_owner = {"id": None, "at": 0.0}


def data_owner_id() -> int:
    """The account that owns the data from before accounts and uploads with SYNC_TOKEN: DATA_OWNER by name, else
    the first suite admin (lowest id). 0 when there is none."""
    if _owner["id"] and time.time() - _owner["at"] < 60:
        return _owner["id"]
    uid = 0
    if config.DATA_OWNER:
        u = shared.find(config.DATA_OWNER)
        if not u:
            raise RuntimeError(f"DATA_OWNER={config.DATA_OWNER}: there is no such account in the auth database")
        uid = u["id"]
    else:
        admins = [u["id"] for u in shared.list_users() if u.get("suiteAdmin")]
        uid = min(admins) if admins else 0
    _owner.update(id=uid, at=time.time())
    return uid


def migration_owner() -> int:
    """The account the pre-account rows go to when schema 9 is applied: DATA_OWNER, named explicitly. No guessing
    here (the first suite admin is often not the person whose health data this is); without it the migration refuses
    and says what to set."""
    return data_owner_id() if config.DATA_OWNER else 0


def sync_token_user(request: Request):
    """The data owner, for a request carrying the old SYNC_TOKEN as its bearer token."""
    import hmac
    h = request.headers.get("authorization", "")
    if not config.SYNC_TOKEN or not h.lower().startswith("bearer "):
        return None
    if not hmac.compare_digest(h[7:].strip().encode(), config.SYNC_TOKEN.encode()):
        return None
    uid = data_owner_id()
    return shared.get(uid, APP) if uid else None


def me(request: Request) -> dict:
    """The signed-in account, or 401: every health figure belongs to someone."""
    u = getattr(request.state, "user", None)
    if not u:
        raise HTTPException(401, "Sign in to use ioHealth")
    return u


def uid(request: Request) -> int:
    return int(me(request)["id"])


def uploader(request: Request) -> int:
    """The account an upload is for: an editor or admin here."""
    u = getattr(request.state, "user", None)
    if not u:
        raise HTTPException(401, "missing or wrong token: use an app password from ioHealth's Settings › Account")
    if u.get("role") not in ("editor", "admin"):
        raise HTTPException(403, f"{u['name']} may not upload to ioHealth: an admin can make the account an editor")
    return int(u["id"])
