"""Move every row one account holds to another account, in small batches a Galera cluster takes in its stride.

    python -m app.reassign FROM TO [--batch N] [--yes]

FROM and TO are account names in the shared auth database, or account ids. This is for the case where the 1.x
data was handed to the wrong account when schema 9 was applied (DATA_OWNER left empty, so the first suite admin
got it): every table with a user_id column is walked in batches of N rows (5000) with a pause between them, so no
single transaction rewrites a whole table; the column defaults are moved along. Run it with the server stopped,
or at least with no sync in progress, from the server folder (the settings come from .env, as run.sh loads them).
"""
import os
import sys
import time
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _load_env():
    """The server folder's .env, as run.sh loads it (variables already set win); before app.config reads them."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.replace("_", "").isalnum():
            os.environ.setdefault(k, v)


_load_env()
from app import config, db  # noqa: E402

TABLES = db.USER_TABLES + tuple(db.USER_KEYED)


def _account(name: str) -> int:
    if name.isdigit():
        return int(name)
    from iothing_auth import users as shared
    shared.init()
    u = shared.find(name)
    if not u:
        sys.exit(f"no account named {name} in the auth database ({', '.join(x['name'] for x in shared.list_users()) or 'no accounts'})")
    return int(u["id"])


def counts(uid: int) -> dict:
    """How many rows each table holds for the account."""
    return {t: db.one(f"SELECT COUNT(*) FROM {t} WHERE user_id = %s", (uid,))[0] for t in TABLES}


def reassign(src: int, dst: int, batch: int = 5000, pause: float = 0.2, log=print) -> dict:
    """Every row of `src` becomes `dst`'s; returns the rows moved per table."""
    if src == dst:
        raise ValueError("the two accounts are the same")
    moved = {}
    for t in TABLES:
        n = 0
        while True:
            # UPDATE ... LIMIT: each batch is one short transaction; the keyed tables have user_id first in their
            # primary key, the others are scanned in primary-key order and the rows already moved are skipped
            k = db.ex(f"UPDATE {t} SET user_id = %s WHERE user_id = %s LIMIT %s", (dst, src, int(batch)))
            if not k:
                break
            n += k
            log(f"  {t}: {n} rows")
            time.sleep(pause)
        moved[t] = n
        # what the migration recorded as the column's default (the pre-account rows') follows the data; metadata only
        row = db.one("SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = 'user_id'", (t,))
        if row and str(row[0]) == str(src):
            db.ex(f"ALTER TABLE {t} ALTER COLUMN user_id SET DEFAULT {int(dst)}")
    return moved


def main(argv=None):
    args = [a for a in (argv if argv is not None else sys.argv[1:])]
    batch, yes = 5000, False
    if "--yes" in args:
        yes = True
        args.remove("--yes")
    if "--batch" in args:
        i = args.index("--batch")
        batch = int(args[i + 1])
        del args[i:i + 2]
    if len(args) != 2:
        sys.exit(__doc__.strip())
    src, dst = _account(args[0]), _account(args[1])
    before = counts(src)
    total = sum(before.values())
    print(f"{config.DB_HOST}:{config.DB_PORT}/{config.DB_NAME}: account #{src} holds {total} rows ({', '.join(f'{t} {n}' for t, n in before.items() if n)})")
    if not total:
        print("nothing to move")
        return
    if not yes:
        a = input(f"move them all to account #{dst}, in batches of {batch}? [y/N] ")
        if a.strip().lower() not in ("y", "yes"):
            sys.exit("not moved")
    moved = reassign(src, dst, batch)
    print(f"moved {sum(moved.values())} rows to account #{dst}")
    # DATA_OWNER follows: SYNC_TOKEN uploads go to that account, and the migration's choice is recorded there
    if not args[1].isdigit() and config.DATA_OWNER != args[1]:
        if ENV_FILE.exists():
            lines = [l for l in ENV_FILE.read_text().splitlines() if not l.startswith("DATA_OWNER=")] + [f"DATA_OWNER={args[1]}"]
            ENV_FILE.write_text("\n".join(lines) + "\n")
            print(f"DATA_OWNER={args[1]} written to {ENV_FILE}; restart ioHealth (systemctl restart iohealth) for it to take effect")
        else:
            print(f"note: set DATA_OWNER={args[1]} in the server's environment (SYNC_TOKEN uploads go to that account) and restart")


if __name__ == "__main__":
    main()
