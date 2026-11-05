"""Updating ioHealth itself, as ioPix and ioNotes do: which commit is installed, whether GitHub's main branch carries
a newer version, and running update.sh (next to run.sh) from Maintenance. Docker installs are updated by pulling the
image, so there the check only reports and says so. Only the public commit list is fetched; nothing about this
install is sent."""
import logging
import os
import re
import subprocess
import threading
import time
import urllib.request

import orjson
from iothing_auth import db as authdb

from app import __version__, config

log = logging.getLogger("app.updates")

REPO = os.environ.get("IOHEALTH_REPO", "avandeputte/ioHealth")  # the repository and branch followed
BRANCH = os.environ.get("IOHEALTH_BRANCH", "main")
SUBDIR = "server"  # where the server lives in the repository
DAILY = 24 * 3600
RESULT_FILE = "update-result.txt"  # next to the app; update.sh writes the outcome there before restarting
_run_lock = threading.Lock()


class Progress(dict):
    """What the update run reports (running, error, log)."""

    def start(self, **fields):
        self.update(running=True, error=None, **fields)

    def fail(self, e):
        self["error"] = (e if isinstance(e, str) else str(e))[:300]

    def finish(self):
        self.update(running=False, finished=int(time.time()))


progress = Progress(running=False, error=None, log="", finished=None)
_checked = {}
_commit = None  # local_commit() once known: it only changes with update.sh, which restarts the process


def in_docker() -> bool:
    return os.path.exists("/.dockerenv")


def local_commit() -> str:
    """The installed commit (cached: every status poll asks, and it cannot change while this process runs)."""
    global _commit
    if _commit is None:
        found = _read_commit()
        if found == "unknown":
            return found  # not cached: a transient git failure gets another try
        _commit = found
    return _commit


def _read_commit() -> str:
    # a checkout: the repository root is one level up from the server folder; an image or an installed copy: COMMIT
    for base in (config.APP_DIR, config.APP_DIR.parent):
        if (base / ".git").exists():
            try:
                return subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(base), capture_output=True, text=True, timeout=10).stdout.strip() or "unknown"
            except (OSError, subprocess.SubprocessError):
                return "unknown"
    try:
        return (config.APP_DIR / "COMMIT").read_text().strip() or "unknown"
    except OSError:
        return "unknown"


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "iohealth"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()


def auto_check_enabled() -> bool:
    """Maintenance › Check for updates daily (on unless switched off; UPDATE_CHECK=0 locks it off)."""
    if not config.UPDATE_CHECK:
        return False
    return authdb.get_setting("update_check", "1", app="iohealth") == "1"


def set_auto_check(on: bool):
    authdb.set_setting("update_check", "1" if on else "0", app="iohealth")


def remote_version(message: str):
    """The version a commit announces in its first line ("v2.1.0: ..."), if it does."""
    m = re.match(r"\s*v(\d+\.\d+\.\d+)\b", message or "")
    return m.group(1) if m else None


def available():
    """What the banner needs, from the last check: {version, remote, message, date}, or None."""
    c = dict(_checked)
    if c.get("status") != "update":
        return None
    return {"remote": c.get("remote"), "version": c.get("remoteVersion") or remote_version(c.get("remoteMessage")),
            "message": c.get("remoteMessage"), "date": c.get("remoteDate")}


def start_daily():
    """Ask GitHub once a day (the first time a minute after start) whether main has moved on, while the setting is on."""
    def loop():
        time.sleep(60)
        while True:
            try:
                if auto_check_enabled():
                    check()
            except Exception:
                pass
            time.sleep(DAILY)
    threading.Thread(target=loop, name="update-check", daemon=True).start()


def _remote_app_version(sha: str):
    """The app version at that commit, so a commit that only touches the docs or the iPhone app is not announced
    as a new build of the server."""
    text = _fetch(f"https://raw.githubusercontent.com/{REPO}/{sha}/{SUBDIR}/app/__init__.py").decode("utf-8", "replace")
    m = re.search(r'^__version__ = "([^"]+)"', text, re.M)
    return m.group(1) if m else None


def check() -> dict:
    """{installed, remote, remoteDate, remoteMessage, remoteVersion, status: current|update|error}"""
    mine = local_commit()
    out = {"installed": mine[:7], "checked": int(time.time())}
    try:
        c = orjson.loads(_fetch(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}"))
        out.update(remote=c["sha"][:7], remoteDate=c["commit"]["committer"]["date"][:10], remoteMessage=c["commit"]["message"].splitlines()[0][:100])
        if c["sha"].startswith(mine) and mine != "unknown":
            out["status"] = "current"
        else:
            try:
                rv = _remote_app_version(c["sha"])
            except Exception:
                rv = None
            out["remoteVersion"] = rv
            # a newer build is one with another app version; the same version under a new commit (a workflow or
            # documentation change) is nothing to install
            out["status"] = "current" if rv == __version__ else "update"
    except Exception as e:
        out.update(status="error", error=str(e)[:160])
    _checked.clear()
    _checked.update(out)
    return out


def last_result():
    """The outcome of the last update.sh run, from the file it writes before the service restart: {ok, text, at}."""
    f = config.APP_DIR / RESULT_FILE
    try:
        text = f.read_text().strip()
    except OSError:
        return None
    if not text:
        return None
    return {"ok": text.startswith("ok:"), "text": text.split(":", 1)[-1].strip()[:300], "at": int(f.stat().st_mtime)}


def _app_writable() -> bool:
    """update.sh writes the app folder, the Python environment and (for a checkout) the git metadata."""
    paths = [config.APP_DIR] + [p for p in (config.APP_DIR / ".venv", config.APP_DIR.parent.parent / ".git") if p.exists()]
    return all(os.access(str(p), os.W_OK) for p in paths)


def can_run() -> bool:
    return (config.APP_DIR / "update.sh").exists() and not in_docker() and _app_writable()


def status() -> dict:
    return {"version": __version__, "installed": local_commit()[:7], "docker": in_docker(), "canRun": can_run(),
            "autoCheck": auto_check_enabled(), "autoCheckLocked": not config.UPDATE_CHECK,
            "check": dict(_checked) if _checked else None, "progress": dict(progress), "lastUpdate": last_result()}


def run(ref: str = ""):
    """update.sh in a child process; the service manager restarts ioHealth when it finishes. ref: a commit or branch
    to install instead of the tip of main. update.sh does nothing when that commit is already installed, and records
    its outcome next to the app (see last_result)."""
    if in_docker():
        raise RuntimeError("In Docker, update by pulling the image: docker compose pull && docker compose up -d")
    if not can_run():
        raise RuntimeError("update.sh is missing or the app folder is not writable by the server's user")
    ref = (ref or "").strip()[:80]
    if ref and not re.fullmatch(r"[0-9a-f]{7,40}|[A-Za-z0-9][A-Za-z0-9._-]*", ref):  # a commit id or a plain branch name, never an option or a path
        raise RuntimeError("ref must be a commit id or a branch name")
    with _run_lock:  # the check and the claim as one step: two calls at once cannot both start update.sh
        if progress["running"]:
            raise RuntimeError("An update is already running")
        progress.start(log="")
    env = dict(os.environ, IOHEALTH_RESULT=str(config.APP_DIR / RESULT_FILE), IOHEALTH_REPO=REPO, IOHEALTH_BRANCH=BRANCH)
    if ref:
        env["IOHEALTH_REF"] = ref
    try:
        (config.APP_DIR / RESULT_FILE).unlink()
    except OSError:
        pass

    def work():
        try:
            res = subprocess.run(["sh", str(config.APP_DIR / "update.sh")], cwd=str(config.APP_DIR), capture_output=True, text=True, timeout=1800, env=env)
            progress["log"] = (res.stdout + res.stderr)[-3000:]
            if res.returncode != 0:
                tail = re.sub(r"\x1b\[[0-9;]*m", "", (res.stderr or res.stdout)).strip()
                progress.fail(tail.splitlines()[-1] if tail else f"exit {res.returncode}")
        except Exception as e:
            progress.fail(e)
        finally:
            progress.finish()
            _checked.clear()

    threading.Thread(target=work, name="self-update", daemon=True).start()
