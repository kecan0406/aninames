"""Write data/copyrights.json.gz: each Danbooru character tag's posts, the copyright tags on a fifth of them, and those tags' posts.

Danbooru's own related-tag endpoint answers scripts with a Cloudflare challenge, so this counts a public copy of its
post table once and the build reads the result. Run it again by hand when a newer copy is worth the difference:

    uv run --no-project --with duckdb python scripts/copyrights.py
"""

import gzip
import json
import tempfile
from pathlib import Path

import duckdb

POSTS = "https://huggingface.co/datasets/nyanko-devs/danbooru2026/resolve/main/metadata/posts-snapshot.parquet"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".cache" / "raw" / "danbooru"
OUT = ROOT / "data" / "copyrights.json.gz"
SHARE = 0.2


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        db = duckdb.connect()
        db.execute("INSTALL httpfs; LOAD httpfs;")
        db.execute(f"SET temp_directory='{temp}'")
        db.execute(f"CREATE TABLE characters AS SELECT name FROM read_json_auto('{RAW / 'tags.json'}')")
        db.execute(
            f"CREATE TABLE copyrights AS SELECT name FROM read_json_auto('{RAW / 'works.json'}') WHERE name <> 'original'"
        )
        db.execute(
            f"""CREATE TABLE tags AS SELECT id, unnest(string_split(tag_string, ' ')) AS tag
            FROM read_parquet('{POSTS}') WHERE NOT is_deleted"""
        )
        db.execute("CREATE TABLE drawn AS SELECT id, tag FROM tags JOIN characters ON tag = name")
        db.execute("CREATE TABLE owned AS SELECT id, tag FROM tags JOIN copyrights ON tag = name")
        posts = dict(db.execute("SELECT tag, count(*) FROM drawn GROUP BY tag").fetchall())
        sizes = dict(db.execute("SELECT tag, count(*) FROM owned GROUP BY tag").fetchall())
        pairs = db.execute(
            """SELECT a.tag, b.tag, count(*) AS n FROM drawn a JOIN owned b USING (id)
            GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2"""
        ).fetchall()
    characters: dict[str, list] = {}
    for character, work, count in pairs:
        if count >= SHARE * posts[character]:
            characters.setdefault(character, [posts[character], []])[1].append([work, count])
    used = {work for _, works in characters.values() for work, _ in works}
    out = {"copyrights": {work: sizes[work] for work in used}, "characters": characters}
    OUT.parent.mkdir(exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    with gzip.GzipFile(OUT, "wb", mtime=0) as file:
        file.write(text.encode())
    print(f"{len(characters)} characters, {len(used)} copyrights, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
