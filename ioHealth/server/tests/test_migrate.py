"""Upgrading a 1.x database (schema 8, the Go receiver's) with data in it: the rows become the data owner's."""
import os

import pymysql
import pytest

from app import db


@pytest.fixture
def old_db():
    """A database at schema 8 holding a few rows, as the Go receiver left it; db points at it for the test."""
    name = "health_mig_test"
    con = pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], autocommit=True)
    with con.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {name}")
        cur.execute(f"CREATE DATABASE {name}")
    con.close()
    db.configure(database=name)
    try:
        # schema 1..8 as the Go receiver applied them, then some rows
        steps = db.migrations(lambda: 0)[:8]
        with db.conn() as con, con.cursor() as cur:
            cur.execute("CREATE TABLE schema_version (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL)" + db.TABLE_OPTIONS)
            for i, step in enumerate(steps):
                for stmt in step:
                    if callable(stmt):
                        stmt(con)
                    else:
                        cur.execute(stmt + (db.TABLE_OPTIONS if stmt.startswith("CREATE TABLE") else ""))
                cur.execute("INSERT INTO schema_version VALUES (%s, UTC_TIMESTAMP(3))", (i + 1,))
            cur.execute("INSERT INTO samples (uuid, type, kind, start_date, end_date, value, unit) VALUES ('s1', 'step_count', 'quantity', '2026-10-01 08:00', '2026-10-01 08:01', 12, 'count')")
            cur.execute("INSERT INTO characteristics (`key`, value) VALUES ('dateOfBirth', '1980-01-01')")
            cur.execute("INSERT INTO activity_summaries (date, active_energy_kcal) VALUES ('2026-10-01', 100)")
            cur.execute("INSERT INTO web_settings (`key`, value) VALUES ('units', '\"metric\"')")
            cur.execute("INSERT INTO sample_hourly (type, hour, source_name, sum, n) VALUES ('step_count', '2026-10-01 08:00', 'Watch', 12, 1)")
        yield name
    finally:
        db.configure(database=os.environ["DB_NAME"])
        con = pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], autocommit=True)
        with con.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {name}")
        con.close()


def test_data_needs_an_owner(old_db):
    assert db.schema_version() == 8
    with pytest.raises(RuntimeError, match="needs an owner"):
        db.migrate(lambda: 0)
    assert db.schema_version() == 8  # nothing recorded; the next start tries again


def test_existing_rows_become_the_owners(old_db):
    db.migrate(lambda: 7)
    assert db.schema_version() == 9
    assert db.one("SELECT user_id FROM samples WHERE uuid = 's1'")[0] == 7
    assert db.one("SELECT user_id, value FROM characteristics") == (7, "1980-01-01")
    assert db.one("SELECT user_id FROM activity_summaries")[0] == 7
    assert db.one("SELECT user_id FROM web_settings")[0] == 7
    assert db.one("SELECT user_id FROM sample_hourly")[0] == 7
    # another account's rows with the same key sit beside them
    db.ex("INSERT INTO characteristics (user_id, `key`, value) VALUES (8, 'dateOfBirth', '1990-01-01')")
    db.ex("INSERT INTO activity_summaries (user_id, date, active_energy_kcal) VALUES (8, '2026-10-01', 5)")
    assert db.one("SELECT COUNT(*) FROM characteristics")[0] == 2
    db.migrate(lambda: 7)  # a second run is a no-op
    assert db.schema_version() == 9


def test_empty_database_needs_no_owner(old_db):
    with db.conn() as con, con.cursor() as cur:
        for t in db.DATA_TABLES:
            cur.execute(f"DELETE FROM {t}")
    db.migrate(lambda: 0)
    assert db.schema_version() == 9


def test_reassign_moves_every_row_to_another_account(old_db):
    from app import reassign
    db.migrate(lambda: 7)
    # a few more sample rows, so the batches have something to walk; another account's row stays put
    with db.conn() as con, con.cursor() as cur:
        for i in range(2, 9):
            cur.execute("INSERT INTO samples (uuid, type, kind, start_date, end_date, value, unit) VALUES (%s, 'step_count', 'quantity', '2026-10-01 08:00', '2026-10-01 08:01', 1, 'count')", (f"s{i}",))
        cur.execute("INSERT INTO samples (user_id, uuid, type, kind, start_date, end_date, value, unit) VALUES (8, 'other', 'step_count', 'quantity', '2026-10-01 08:00', '2026-10-01 08:01', 1, 'count')")
    assert reassign.counts(7)["samples"] == 8
    moved = reassign.reassign(7, 3, batch=3, pause=0, log=lambda *_: None)
    assert moved["samples"] == 8 and moved["characteristics"] == 1 and moved["sample_hourly"] == 1
    assert reassign.counts(7) == {t: 0 for t in reassign.TABLES}
    assert db.one("SELECT COUNT(*) FROM samples WHERE user_id = 3")[0] == 8
    assert db.one("SELECT user_id FROM samples WHERE uuid = 'other'")[0] == 8
    assert str(db.one("SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'samples' AND COLUMN_NAME = 'user_id'")[0]) == "3"
    assert reassign.reassign(7, 3, pause=0, log=lambda *_: None) == {t: 0 for t in reassign.TABLES}  # nothing left: a no-op
