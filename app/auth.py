"""The shared ioThing accounts (iosuite-shared), as ioHealth uses them.

Accounts, passwords, sessions and roles live in the Shared ioSuite database (IOSUITE_DB_*), shared with ioPix,
ioNotes and ioContacts: one sign-in serves every app on the domain (COOKIE_DOMAIN). What is ioHealth's own
stays here: the role an account holds in ioHealth, and its health data, which nobody else sees.

Roles: a viewer sees their own data; an editor can also upload it (the iPhone app signs in as an editor, with an
app password); an admin can also see Server and Maintenance; accounts, roles and the sign-in
settings are for suite admins (Settings › Suite, the Shared ioSuite database).
"""
import logging

from fastapi import HTTPException, Request
from iosuite_shared.fastapi import Auth
from iosuite_shared.updates import Updater

from app import __version__, config

APP = "iohealth"
log = logging.getLogger("app.auth")

# version, public_url, description and color: ioHealth's row in the suite's list of apps (iosuite_shared.suite),
# written on the first request, so the start page (ioSuite) and the other apps find it
auth = Auth(APP, app_label="ioHealth", version=__version__, public_url=config.PUBLIC_URL or None,
            description="Health and fitness", color="#e8445a")


# updates (the daily check, update.sh, restart) and the server log, as in every app of the suite (iosuite_shared.updates)
updater = Updater(APP, __version__, config.APP_DIR, repo=config.env("IOHEALTH_REPO", "avandeputte/iohealth"), user_agent="iohealth")


def me(request: Request) -> dict:
    """The signed-in account, or 401: every health figure belongs to someone."""
    u = getattr(request.state, "user", None)
    if not u:
        raise HTTPException(401, "Sign in to use ioHealth")
    return u


def uid(request: Request) -> int:
    return int(me(request)["id"])

