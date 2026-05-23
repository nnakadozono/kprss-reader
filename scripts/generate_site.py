#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sqlite3
from pathlib import Path


def load_dotenv(path=".env"):
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_args():
    parser = argparse.ArgumentParser(description="Generate the static kprss-reader site.")
    parser.add_argument("--db", default=os.environ.get("KPDB"), help="Path to source SQLite database.")
    parser.add_argument(
        "--article-table",
        default=os.environ.get("KPRSS_READER_ARTICLE_TABLE") or os.environ.get("KPSHORT"),
        help="Source article table name. Defaults to KPRSS_READER_ARTICLE_TABLE or KPSHORT.",
    )
    parser.add_argument(
        "--asset-table",
        default=os.environ.get("KPRSS_READER_ASSET_TABLE"),
        help="Source image/asset table name. If omitted, the generator tries to infer it.",
    )
    parser.add_argument("--out", default="dist", help="Output directory.")
    parser.add_argument("--public", default="public", help="Static public directory.")
    parser.add_argument("--days", type=int, default=10, help="Number of latest dates to generate.")
    return parser.parse_args()


def rows_to_dicts(cursor, rows):
    names = [description[0] for description in cursor.description]
    return [dict(zip(names, row)) for row in rows]


def normalize_title(title):
    parts = [part.strip() for part in (title or "").splitlines()]
    parts = [part for part in parts if part]
    return " | ".join(parts) or "(no title)"


def quote_identifier(name):
    if not name:
        raise ValueError("Missing SQLite identifier.")
    return '"' + name.replace('"', '""') + '"'


def table_names(conn):
    cursor = conn.execute(
        """
        select name
        from sqlite_master
        where type = 'table' and name not like 'sqlite_%'
        order by name
        """
    )
    return [row[0] for row in cursor.fetchall()]


def table_columns(conn, table_name):
    cursor = conn.execute(f"pragma table_info({quote_identifier(table_name)})")
    return {row[1] for row in cursor.fetchall()}


def infer_table(conn, required_columns, preferred=None):
    if preferred:
        columns = table_columns(conn, preferred)
        missing = required_columns - columns
        if missing:
            missing_columns = ", ".join(sorted(missing))
            raise SystemExit(f"Configured table is missing required columns: {missing_columns}")
        return preferred

    matches = [
        name
        for name in table_names(conn)
        if required_columns.issubset(table_columns(conn, name))
    ]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        required = ", ".join(sorted(required_columns))
        raise SystemExit(f"Could not infer table with required columns: {required}")
    raise SystemExit("Could not infer table because multiple candidates match.")


def maybe_infer_table(conn, required_columns, preferred=None):
    if preferred:
        return infer_table(conn, required_columns, preferred=preferred)

    matches = [
        name
        for name in table_names(conn)
        if required_columns.issubset(table_columns(conn, name))
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def fetch_dates(conn, article_table):
    cursor = conn.execute(
        f"""
        select distinct date
        from {quote_identifier(article_table)}
        where date is not null and date != ''
        order by date desc
        """
    )
    return [row[0] for row in cursor.fetchall()]


def fetch_articles(conn, date, article_table, asset_table):
    article_cursor = conn.execute(
        f"""
        select key as id, url, date, dayid, title, article, photo, chart, media, category
        from {quote_identifier(article_table)}
        where date = ?
        order by dayid desc, key desc
        """,
        (date,),
    )
    articles = rows_to_dicts(article_cursor, article_cursor.fetchall())

    images_by_article = {}
    if asset_table:
        image_cursor = conn.execute(
            f"""
            select fkey, i, coalesce(url_dbx, url) as url, coalesce(text, '') as caption
            from {quote_identifier(asset_table)}
            where fkey in (
                select key from {quote_identifier(article_table)} where date = ?
            )
            order by fkey, i
            """,
            (date,),
        )
        for row in rows_to_dicts(image_cursor, image_cursor.fetchall()):
            if not row["url"]:
                continue
            images_by_article.setdefault(row["fkey"], []).append(
                {
                    "url": row["url"],
                    "caption": row["caption"],
                }
            )

    for article in articles:
        article["images"] = images_by_article.get(article["id"], [])
        article["article"] = (article["article"] or "").lstrip()
        article["title"] = normalize_title(article["title"])
        article["category"] = article["category"] or ""
        article["media"] = article["media"] or ""

    return articles


def copy_public(public_dir, out_dir):
    if out_dir.exists():
        shutil.rmtree(out_dir)
    shutil.copytree(public_dir, out_dir)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main():
    load_dotenv()
    args = parse_args()
    if not args.db:
        raise SystemExit("Database path is required. Pass --db or set KPDB.")

    db_path = Path(args.db)
    public_dir = Path(args.public)
    out_dir = Path(args.out)

    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")
    if not public_dir.exists():
        raise SystemExit(f"Public directory not found: {public_dir}")

    copy_public(public_dir, out_dir)

    conn = sqlite3.connect(db_path)
    try:
        article_table = infer_table(
            conn,
            {"key", "url", "date", "dayid", "title", "article", "photo", "chart", "media", "category"},
            preferred=args.article_table,
        )
        asset_table = maybe_infer_table(
            conn,
            {"fkey", "i", "url", "text", "url_dbx"},
            preferred=args.asset_table,
        )

        dates = fetch_dates(conn, article_table)[: args.days]
        if not dates:
            raise SystemExit("No article dates found in database.")

        data_dir = out_dir / "data"
        for date in dates:
            articles = fetch_articles(conn, date, article_table, asset_table)
            write_json(data_dir / f"{date}.json", {"date": date, "articles": articles})

        latest_date = dates[0]
        manifest = {
            "latestDate": latest_date,
            "dates": dates,
        }
        write_json(data_dir / "manifest.json", manifest)
        shutil.copyfile(data_dir / f"{latest_date}.json", data_dir / "latest.json")
    finally:
        conn.close()

    print(f"Generated {len(dates)} days into {out_dir}")


if __name__ == "__main__":
    main()
