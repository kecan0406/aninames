# aninames

A multilingual alias index for anime titles and characters. Type a title or a character name the way you know it — 後藤ひとり, gotou hitori, Hitori Gotoh, 고토 히토리, ぼざろ, 봇치 더 록, 孤独摇滚 — and get the work or the character.

aninames ships data files, not a service: a scheduled build merges open data sources into one SQLite file per license layer, and a small search library joins the layers on your machine. The same build also cuts the search keys into small static files, so a client can search without downloading the databases (see [Static index](#static-index)).

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
| core, kowiki, unlicensed | 15/15 | 14/14 | 9/9 | 139/139 |
| core, kowiki | 15/15 | 13/14 | 9/9 | 46/139 |
| core | 15/15 | 13/14 | 9/9 | 46/139 |

Without `unlicensed`, Danbooru tags resolve only where Wikidata records one (P13236), and Ahri, whom no `core` source counts, loses to names that contain "ari".

The same run checks pairs that must be one character (D.Va's Danbooru tag and her Bangumi entry, Kitagawa Yusuke's tag, Lucy's, Sailor Mercury's) and pairs that must stay two (a genderbent parody's Zenitsu and Giyu against the originals, Persona 5's Goemon against Kitagawa): with all layers, all hold. It also reports the homes of the 200 characters of ttheme's commons (`tests/homes.tsv`), not counted: of the 165 that are Danbooru character tags with five or more posts, 143 get the home ttheme gives them, 7 another (Hatsune Miku, Kagamine Rin and Len and Megurine Luka land on `project_diva`, which only Danbooru's own posts could tell from `vocaloid`) and 15 none (mostly tags no catalog knows).

`mise run probe` searches a frozen sample of works and characters (`tests/probe.json`, 150 per popularity band) by forms of their own names and reports the share found first and the mean reciprocal rank, keeping names several entities share apart. With all layers, names no other entity carries are found first 99–100% of the time in Japanese, kana and Korean, and 92–100% in romaji; romaji with one letter dropped 76–93%; Korean initials (ㄱㅌ ㅎㅌㄹ) 55–100%; Korean typed on an English keyboard (rhxh glxhfl) 75–100%. A given name alone, or a name several characters share, is genuinely ambiguous and ranks by popularity. It also searches Korean Wikipedia titles and redirects without the `kowiki` layer: spellings only Korean Wikipedia has are found first 21% (works) and 40% (characters) of the time, which is what that layer adds.

`mise run silver` hides the external ids that link characters across sources and measures how well name matching alone rejoins them: 91.0% recall, 98.0% precision on 5,483 such pairs. About 45 of the 101 pairs it counts as wrong join a character's other form to it, a Precure's cure name or a sailor senshi, which the ids keep apart; without joining other forms it is 90.6% and 98.9%.

Works and characters flagged adult (VNDB titles with no release under 18, Bangumi `nsfw`, anime-offline-database `hentai`; a character when all its works are) are returned with `adult: true`; `search(query, { adult: false })` leaves them out.

Korean names: 19,065 characters carry a Korean name from a source (Wikidata, Korean Wikipedia cast lists, Danbooru, Bangumi), 7,057 of them from Korean Wikipedia alone. The rest get generated spellings (fan style preferred, national standard and loanword forms ranked lower).

Built sizes: `core.sqlite` 615 MB, `kowiki.sqlite` 25 MB, `unlicensed.sqlite` 840 MB. `mise run pack` writes `dist/release`: the databases zstd-compressed and `NOTICE.md` (each layer's sources and terms).

## Releases

`.github/workflows/release.yml` fetches every source, builds, runs `eval`, packs and chunks every Sunday (and on demand), then publishes the files as a `data-<date>` release, keeping the four latest, and deploys `dist/site` to GitHub Pages as the static index. The latest release is always at `https://github.com/kecan0406/aninames/releases/latest/download/<file>`; ttheme searches the static index through the client.

## Static index

`https://names.ttheme.dev/` serves each layer's search keys as sorted, gzip'd JSON files, so a search fetches only the few files its query needs instead of the databases (615, 25 and 840 MB). `mise run chunk` writes it to `dist/site`:

| Path | Holds |
|---|---|
| `manifest.json` | the format number, the build time and, for every layer and table, each file's lower bound (prefix-compressed against the one before) and name |
| `<layer>/<table>/<hash>.json.gz` | about 32 KB of JSON rows sorted by key (16 KB for `entity`), named by the first 48 bits of the SHA-256 of the file |
| `NOTICE.md`, `index.html` | each layer's sources and terms |

The key tables are `flat` (folded names), `latin` (romaji keys), `sound` (sound keys across kana, Hangul and romaji), `part` (name tokens) and `initial` (Korean initials); their rows are `[key, entity number, name weight, flags, popularity, standing, bonus]`. `tag` holds the same rows for Danbooru tags, keyed by the tag folded like a name without its qualifier and weighted by the tag's posts. `home` holds them for the copyright tag each character comes from, weighted by the character's own posts, with an eighth value for the character's place in that cast: 0 for a lead and 1 for a supporting role in a work the tag reaches, on the work itself or on a series, franchise or original above it (Bangumi's and VNDB's roles), 2 for any other character a catalog knows, 3 for one only Danbooru names; a `core` row whose character the `unlicensed` layer gives another home carries flag 64, which a client that reads `unlicensed` skips. `entity` rows, keyed by entity number (which follows the entity ids' order), carry the id, names (a layer's best name in each language also carries its rank among every layer's best, 0 the best of all), Danbooru tags, works, family, the ids other databases give one entity in that layer (TMDB's `tmdb:tv/…` and `tmdb:movie/…`, IGDB's `igdb:…` and Steam's `steam:…` among them, read from Wikidata), a character's home tag, and a work's countries of origin (Wikidata P495, as ISO 3166-1 alpha-2 codes such as `JP`), first year and medium (`anime`, `vn`, `game`, `manga` or `novel`). Layers stay in separate files; the only values a file carries from other layers are derived numbers and flags (popularity, family standing, adult, which layers know the entity).

On the 11-01 build: 21,913 files, 158 MB gzip'd, a manifest of 264 KB gzip'd. `mise run compare` searches the probe sample (4,352 queries) both ways: the files find the entity first 87% of the time (3,803), SQLite 87% (3,793; FTS substring search is not in the files; typo search reads the rows around the query's position instead). A cold query needs a median of 2 rounds (p90 3), 32 files (p90 80) and 284 KB (p90 556 KB).

The client is `@kecan0406/aninames` (`src/client/`), plain TypeScript for Node 22 and Bun that depends only on `es-hangul`:

```ts
import { cachedSource, httpSource, Names } from '@kecan0406/aninames'

const source = cachedSource(httpSource('https://names.ttheme.dev'), `${cacheDir}/aninames`)
const names = new Names(source, { layers: ['core', 'kowiki'] })
const [first] = await names.search('봇치', { limit: 10, signal })
const works = await names.lookup(first?.works ?? [])
```

`search` returns `Found` cards (`id`, `kind`, `label`, the preferred name in Japanese, else English, romaji or Korean, `names` with their `lang` and `kind`, one per language marked `preferred`, `danbooru` tags with the most posts first, `works`, `refs`, `home`, the copyright tag a character comes from, `origin`, the countries a work comes from, `year` and `medium`, `score`, `match`, how the query met the name: `name` for a whole name, `part` for one word of it, `prefix`, `sound`, `typo` or `family`, and `adult`); `search(query, { kind, limit, adult: false })` narrows it, `lookup(ids)` returns the cards of given ids in one round, and `tagged(tag, { kind, adult })` the cards of the entities that carry a Danbooru tag, most posts first, whatever its case, punctuation or qualifier (`soul-eater`, `soul_eater` and `soul_eater_(series)` find the same works); `prefix: true` also finds the tags that start with it. `cast(tag, { adult, prefix, limit })` returns the characters whose home is that tag: its leads, then its supporting cast, then the rest, each most posts first. `cachedSource` keeps the files it fetched forever (their names are hashes of their contents), revalidates the manifest with its ETag or Last-Modified once a day (`maxAge`), answers from the cache when offline, refetches the manifest when the site has moved on to a new build, and deletes files a new manifest no longer names. `fileSource(dir)` reads a local `dist/site`.

## Development

```sh
mise run fetch    # download raw data into .cache/raw
mise run stage    # parse it into .cache/stage/*.jsonl
mise run build    # write dist/core.sqlite, dist/kowiki.sqlite, dist/unlicensed.sqlite
mise run search 고토 히토리
mise run eval     # golden queries and the ttheme cast
mise run probe    # search popular to long-tail entities by forms of their names
mise run silver   # measure character merging against hidden cross-source ids
mise run han      # rebuild src/han.txt, the Han variants a merge folds
mise run chunk    # write the static index to dist/site
mise run compare  # search the probe sample with SQLite and with the client over dist/site
mise run lib      # compile the client into lib/ for the npm package
```

What to improve next, with what was measured, is in [ROADMAP.md](ROADMAP.md).

Code is MIT-licensed (see `LICENSE`); the data files carry the licenses above. `src/han.txt` derives from Unicode's Unihan database (Unicode License v3) and OpenCC's `JPShinjitaiCharacters.txt` (Apache 2.0), whose terms are in `LICENSES/`.
