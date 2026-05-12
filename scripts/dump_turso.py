#!/usr/bin/env python3
"""ebidigi Turso DB を読み取り専用で全件ダンプし、ローカル SQLite ファイル data/snapshot.sqlite に保存する。

使い方:
    python3 scripts/dump_turso.py
"""
import json
import os
import sqlite3
import sys
import urllib.request

TURSO_URL = os.environ.get(
    "TURSO_URL",
    "https://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io/v2/pipeline",
)
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
if not TURSO_TOKEN:
    print("ERROR: TURSO_AUTH_TOKEN environment variable is required.", file=sys.stderr)
    print("Set it via: export TURSO_AUTH_TOKEN='...'", file=sys.stderr)
    sys.exit(1)

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "snapshot.sqlite")
OUT_PATH = os.path.abspath(OUT_PATH)


def turso(sql, args=None):
    payload = {
        "requests": [
            {"type": "execute", "stmt": {"sql": sql, "args": args or []}},
            {"type": "close"},
        ]
    }
    req = urllib.request.Request(
        TURSO_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {TURSO_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read())
    res = body["results"][0]
    if res.get("type") == "error":
        raise RuntimeError(res["error"]["message"])
    return res["response"]["result"]


def cell_to_py(cell):
    if cell is None:
        return None
    t = cell.get("type")
    v = cell.get("value")
    if t == "null":
        return None
    if t == "integer":
        return int(v)
    if t == "float":
        return float(v)
    if t == "blob":
        import base64
        return base64.b64decode(v)
    return v  # text


def main():
    print(f"Output: {OUT_PATH}")
    if os.path.exists(OUT_PATH):
        os.remove(OUT_PATH)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    print("Fetching schema...")
    schema = turso(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ORDER BY name"
    )
    tables = [(row[0]["value"], row[1]["value"]) for row in schema["rows"]]
    print(f"Tables: {len(tables)}")
    for name, _ in tables:
        print(f"  - {name}")

    # indexes
    idx = turso(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
    )
    indexes = [(row[0]["value"], row[1]["value"]) for row in idx["rows"]]
    print(f"Indexes: {len(indexes)}")

    conn = sqlite3.connect(OUT_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    for name, ddl in tables:
        print(f"\n[{name}]")
        conn.execute(ddl)
        # column list
        cols_res = turso(f'PRAGMA table_info("{name}")')
        col_names = [r[1]["value"] for r in cols_res["rows"]]
        # paginate
        offset = 0
        page = 5000
        total = 0
        while True:
            res = turso(f'SELECT * FROM "{name}" LIMIT {page} OFFSET {offset}')
            rows = res["rows"]
            if not rows:
                break
            placeholders = ",".join(["?"] * len(col_names))
            col_list = ",".join([f'"{c}"' for c in col_names])
            sql = f'INSERT INTO "{name}" ({col_list}) VALUES ({placeholders})'
            conn.executemany(sql, [[cell_to_py(c) for c in row] for row in rows])
            total += len(rows)
            offset += page
            print(f"  +{len(rows)} (total {total})")
            if len(rows) < page:
                break
        conn.commit()

    for name, ddl in indexes:
        try:
            conn.execute(ddl)
        except sqlite3.OperationalError as e:
            print(f"  index {name} skipped: {e}")
    conn.commit()
    conn.close()

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nDone. {OUT_PATH} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    sys.exit(main())
