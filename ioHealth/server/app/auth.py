"""The shared ioThing accounts (iothing-auth), as ioHealth uses them.

Accounts, passwords, sessions and roles live in the suite's auth database (IOTHING_AUTH_DB_*), shared with ioPix,
ioNotes and ioContacts: one sign-in serves every app on the domain (IOTHING_COOKIE_DOMAIN). What is ioHealth's own
stays here: the role an account holds in ioHealth, and its health data, which nobody else sees.

Roles: a viewer sees their own data; an editor can also upload it (the iPhone app signs in as an editor, with an
app password); an admin can also manage the accounts and the sign-in settings.
"""
import logging

from fastapi import HTTPException, Request
from iothing_auth.fastapi import Auth

APP = "iohealth"
log = logging.getLogger("app.auth")

auth = Auth(APP, app_label="ioHealth")


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
