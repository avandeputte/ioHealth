"""The conventions every app of the suite follows (iosuite_shared.testing): the port, one version, config.env, and an
access marker on every API route (and on the phone's /v1/ routes)."""
from pathlib import Path

from iosuite_shared import testing

from app import __version__, access, config

ROOT = Path(__file__).resolve().parent.parent


def test_suite_conventions():
    testing.check_conventions(ROOT, "iohealth", __version__, config)


def test_every_api_route_declares_who_may_call_it(app):
    testing.check_access_declared(app, access.declared)
    testing.check_access_declared(app, access.declared, prefix="/v1/")


def test_standard_paths():
    assert config.APP_DIR == ROOT and config.STATIC_DIR == ROOT / "static" and config.DATA_DIR == ROOT / "data"
    assert config.LOG_FILE is None  # LOG_FILE= in the tests' environment
