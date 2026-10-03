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

v0, built and searched locally. The golden queries in `tests/golden.ts` and the 139 character tags in `tests/ttheme.txt` (`mise run eval`):

| Layers | Titles | Characters | Typos (not counted) | ttheme tags resolved |
|---|---|---|---|---|
| core, kowiki, unlicensed | 15/15 | 13/13 | 9/9 | 139/139 |
| core, kowiki | 15/15 | 13/13 | 8/9 | 46/139 |
| core | 15/15 | 13/13 | 8/9 | 46/139 |

Without `unlicensed`, Danbooru tags resolve only where Wikidata records one (P13236).

Built sizes: `core.sqlite` about 580 MB, `kowiki.sqlite` 13 MB, `unlicensed.sqlite` 850 MB, plus `ttheme-<layer>.json` slices (1.5 MB, 0.1 MB, 16.6 MB) mapping Danbooru-tagged characters to their names for consumers without SQLite.

## Development

```sh
mise run fetch    # download raw data into .cache/raw
mise run stage    # parse it into .cache/stage/*.jsonl
mise run build    # write dist/core.sqlite, dist/kowiki.sqlite, dist/unlicensed.sqlite
mise run search 고토 히토리
mise run eval
```

Code is MIT-licensed (see `LICENSE`); the data files carry the licenses above.
