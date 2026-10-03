# aninames

A multilingual alias index for anime titles and characters. Type a title or a character name the way you know it — 後藤ひとり, gotou hitori, Hitori Gotoh, 고토 히토리, ぼざろ, 봇치 더 록, 孤独摇滚 — and get the work or the character.

aninames ships data files, not a service: a scheduled build merges open data sources into one SQLite file per license layer, and a small search library joins the layers on your machine.

## Layers

Sources under different share-alike licenses cannot be merged into one database, so every built file holds one layer. Load the layers whose terms suit you; `core` is always required.

| Layer | File | License | Sources |
|---|---|---|---|
| `core` | `core.sqlite` | ODbL 1.0 (contents DbCL) | Wikidata (CC0), anime-offline-database (ODbL), VNDB (ODbL) |
| `kowiki` | `kowiki.sqlite` | CC BY-SA 4.0 | Korean Wikipedia article titles and redirects |
| `unlicensed` | `unlicensed.sqlite` | none stated by the sources | AniDB titles (Anime-Lists mirror), Bangumi Archive, Anissia, Danbooru |

The `unlicensed` layer carries data whose sources state no license. It is published as a separate file so you can leave it out; redistributing it is at your own risk.

Korean names generated from kana readings (national-standard and fan spellings) are marked `generated` and rank below sourced names.

## Status

v0, built and searched locally.

Golden queries (`tests/golden.ts`) and the 139 character tags of ttheme's palettes (`tests/ttheme.tsv`), `mise run eval`:

| Layers | Titles | Characters | Typos (not counted) | ttheme tags resolved |
|---|---|---|---|---|
| core, kowiki, unlicensed | 15/15 | 13/13 | 9/9 | 139/139 |
| core, kowiki | 15/15 | 13/13 | 9/9 | 46/139 |
| core | 15/15 | 13/13 | 9/9 | 46/139 |

Without `unlicensed`, Danbooru tags resolve only where Wikidata records one (P13236).

`mise run probe` searches a frozen sample of works and characters (`tests/probe.json`, 150 per popularity band) by forms of their own names and reports the share found first and the mean reciprocal rank, keeping names several entities share apart. With all layers, names no other entity carries are found first 99–100% of the time in Japanese, kana, romaji and Korean; romaji with one letter dropped 77–95%; Korean initials (ㄱㅌ ㅎㅌㄹ) 64–100%; Korean typed on an English keyboard (rhxh glxhfl) 72–100%. A given name alone, or a name several characters share, is genuinely ambiguous and ranks by popularity. It also searches Korean Wikipedia titles and redirects without the `kowiki` layer: spellings only Korean Wikipedia has are found first 20% (works) and 42% (characters) of the time, which is what that layer adds.

`mise run silver` hides the external ids that link characters across sources and measures how well name matching alone rejoins them: 89.0% recall, 98.8% precision on 5,040 such pairs.

Works and characters flagged adult (VNDB titles with no release under 18, Bangumi `nsfw`, anime-offline-database `hentai`; a character when all its works are) are returned with `adult: true`; `search(query, { adult: false })` leaves them out.

Korean names: 19,065 characters carry a Korean name from a source (Wikidata, Korean Wikipedia cast lists, Danbooru, Bangumi), 7,057 of them from Korean Wikipedia alone. The rest get generated spellings (fan style preferred, national standard and loanword forms ranked lower).

Built sizes: `core.sqlite` 610 MB, `kowiki.sqlite` 25 MB, `unlicensed.sqlite` 830 MB, plus `ttheme-<layer>.json` slices mapping Danbooru-tagged characters to their names for consumers without SQLite: each character's Danbooru tags (its main tag, the one with the most posts, first), that post count, its popularity and its names by language, with `other` for names no source labels. `mise run pack` compresses everything with zstd into `dist/release`.

## Development

```sh
mise run fetch    # download raw data into .cache/raw
mise run stage    # parse it into .cache/stage/*.jsonl
mise run build    # write dist/core.sqlite, dist/kowiki.sqlite, dist/unlicensed.sqlite
mise run search 고토 히토리
mise run eval     # golden queries and the ttheme cast
mise run probe    # search popular to long-tail entities by forms of their names
mise run silver   # measure character merging against hidden cross-source ids
```

Code is MIT-licensed (see `LICENSE`); the data files carry the licenses above.
