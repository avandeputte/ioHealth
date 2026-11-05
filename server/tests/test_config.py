"""The settings conventions every app of the suite shares."""
from pathlib import Path

from iosuite_shared import suite

from app import __version__, config

ROOT = Path(__file__).resolve().parent.parent


def test_default_port_is_the_suites():
    assert config.PORT == suite.PORTS["iohealth"] == 47800
    for f in ("Dockerfile", "docker-compose.yml", "config.env.example", "run.sh"):
        assert "47800" in (ROOT / f).read_text(), f


def test_one_version_everywhere():
    assert f'version = "{__version__}"' in (ROOT / "pyproject.toml").read_text()


def test_settings_file_is_config_env():
    import re
    assert "config.env" in (ROOT / ".gitignore").read_text().split()
    for f in ("setup.sh", "update.sh", "run.sh", "docker-compose.yml"):
        assert not re.search(r"(?<![\w.])\.env\b", (ROOT / f).read_text()), f  # config.env, not the old .env
