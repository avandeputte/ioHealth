"""A fresh database gets every table, view and index, and starting again changes nothing."""
import os

import pymysql
import pytest

from app import db


@pytest.fixture
def fresh_db():
    name = "health_schema_test"
    con = pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], autocommit=True)
    with con.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {name}")
        cur.execute(f"CREATE DATABASE {name}")
    con.close()
    db.configure(database=name)
    try:
        yield name
    finally:
        db.configure(database=os.environ["DB_NAME"])
        con = pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], autocommit=True)
        with con.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {name}")
        con.close()


def test_fresh_database(fresh_db):
    db.migrate()
    assert db.schema_version() == db.SCHEMA_VERSION
    assert {r[0] for r in db.q("SHOW TABLES")} >= {"hlt_schema_version", "hlt_sample_delay_by_type", "hlt_sample_delay_by_day",
                                                   "hlt_activity_summaries", "hlt_user_settings", "hlt_samples"}
    assert "idx_hlt_samples_created" in {r[2] for r in db.q("SHOW INDEX FROM hlt_samples")}
    db.ex("INSERT INTO hlt_samples (uuid, type, kind, start_date, end_date, value, unit) VALUES ('s1', 'step_count', 'quantity', '2026-10-01 08:00', '2026-10-01 08:01', 12, 'count')")
    assert db.one("SELECT samples FROM hlt_sample_delay_by_type WHERE type = 'step_count'")[0] == 1
    # keyed tables carry the account in their primary key: another account's row with the same key sits beside
    db.ex("INSERT INTO hlt_characteristics (user_id, name, value) VALUES (0, 'dateOfBirth', '1980-01-01')")
    db.ex("INSERT INTO hlt_characteristics (user_id, name, value) VALUES (8, 'dateOfBirth', '1990-01-01')")
    assert db.one("SELECT COUNT(*) FROM hlt_characteristics")[0] == 2
    db.migrate()  # a second run is a no-op
    assert db.schema_version() == db.SCHEMA_VERSION and db.one("SELECT COUNT(*) FROM hlt_samples")[0] == 1
