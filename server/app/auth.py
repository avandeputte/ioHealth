"""The shared ioThing accounts (iosuite-shared), as ioHealth uses them.

Accounts, passwords, sessions and roles live in the Shared ioSuite database (IOSUITE_DB_*), shared with ioPix,
ioNotes and ioContacts: one sign-in serves every app on the domain (COOKIE_DOMAIN). What is ioHealth's own
stays here: the role an account holds in ioHealth, and its health data, which nobody else sees.

Roles: a viewer sees their own data; an editor can also upload it (the iPhone app signs in as an editor, with an
app password); an admin can also manage the accounts and the sign-in settings.
"""
import logging
import os
import subprocess

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


class HealthUpdater(Updater):
    """The suite's updater (the daily check, update.sh, restart, the MCP token, the server log) for a server that lives
    in the `server` folder of its repository: a checkout's .git is one level up from the app folder."""

    def _git_root(self):
        for base in (self.root, self.root.parent):
            if (base / ".git").exists():
                return base
        return None

    def _read_commit(self) -> str:
        base = self._git_root()
        if base is not None:
            try:
                return subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(base), capture_output=True, text=True, timeout=10).stdout.strip() or "unknown"
            except (OSError, subprocess.SubprocessError):
                return "unknown"
        return super()._read_commit()  # an image or an installed copy: the COMMIT file

    def _writable(self) -> bool:
        git = self._git_root()
        paths = [self.root] + [p for p in (self.root / ".venv", git / ".git" if git else None) if p is not None and p.exists()]
        return all(os.access(str(p), os.W_OK) for p in paths)


updater = HealthUpdater(APP, __version__, config.APP_DIR, repo=config.env("IOHEALTH_REPO", "avandeputte/ioHealth"),
                        version_file="server/app/__init__.py", user_agent="iohealth")


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
