# CLAUDE.md

aninames builds a multilingual alias index for anime (and visual novel) titles and characters: any title or character name typed in Japanese (kanji, kana), romaji with any spelling, English, Korean or Chinese should find the right work or character. It ships data files, not a server.

## Commands

All dev commands are mise tasks; package.json has no scripts. The toolchain is bun 1.3.

- `mise run fetch [source…]` — download raw data into `.cache/raw/<source>/`
- `mise run stage [source…]` — parse raw data into `.cache/stage/<source>.jsonl`
- `mise run build` — merge the staged sources into one SQLite file per layer in `dist/`
- `mise run search <query>` / `mise run eval` — query the built layers / run the golden queries in `tests/golden.ts` and the ttheme cast in `tests/ttheme.tsv` (`ANINAMES_LAYERS=core` limits the layers, `ANINAMES_MISSES=1` lists misses)
- `mise run pack` — zstd-compress the built files into `dist/release`; `bun src/cli.ts unpack` turns the `.sqlite.zst` files there back into `dist/*.sqlite`, which the weekly workflow does with the latest data release when a source does not load, so the static site still deploys and the run still fails
- `mise run chunk [bytes]` — cut each layer's search keys and entity rows into sorted gzip'd JSON files of about 32 KB in `dist/site` (the static index served at `names.ttheme.dev`): `<layer>/<table>/<hash>.json.gz`, `manifest.json`, `CNAME`, `NOTICE.md`, `index.html`
- `mise run compare [per band]` — search the probe sample with SQLite and with the client (`src/client/`) over `dist/site`; prints first % per form and rounds, files and KB per cold query, and fails when the files find fewer entities first than SQLite
- `mise run lib` — compile the client into `lib/` (JavaScript and `.d.ts`) for the npm package
- `mise run probe [size]` — search a frozen sample (`tests/probe.json`, made on first run; delete it to draw a new one) of works and characters in three popularity bands by forms of their own names (Japanese, kana, romaji, swapped, short vowels, one-letter typo, Korean, Korean initials, Korean typed on an English keyboard) and Korean Wikipedia spellings with the `kowiki` layer held out; reports first %, MRR and query counts, names several entities share apart
- `mise run silver` — hide the external ids that join characters across sources, run the merge, and report pairwise recall and precision against them
- `mise run ci` — lint + typecheck (the client also alone, against Node's types) + tests

## Pipeline

- A source (`src/sources/<name>.ts`, default export of type `Source` from `src/model.ts`) has a `fetch` that downloads into its raw dir and a `stage` that yields `Entry` records. `src/sources/index.ts` lists the names and loads them lazily.
- An `Entry` is one work or character as one source sees it: `id` (a `Ref`, `<namespace>:<id>`), `kind`, `refs` (ids in other namespaces the source says are the same thing), `names` (text, BCP 47 `lang` when known — `ja`, `ja-Latn` for romaji, `en`, `ko`, `zh-Hans`, `zh-Hant`, `zh` — and a `NameKind`), `works` (a character's works, as refs), `link` (name texts to attach by when there are no refs), `rank` (the source's own popularity number, higher is more popular), `type`, `year`, `series` (a character's media franchise, Wikidata P8345) and `near` (anime-offline-database's untyped relations, evidence for grouping only, never `related`). `attach: true` means the entry only adds names to an entity found through its refs or link and never creates one; such an entry may omit `kind`. `family: true` (Danbooru's copyright tags) means it names a whole family of works.
- A redirect to a section of an article (`kind: 'section'`, Korean Wikipedia's 페른 → 장송의 프리렌#페른) usually names a character or a part of the work, not the work itself, and ranks well below a real alias.
- Korean Wikipedia articles also yield cast lists (`src/sources/cast.ts`: the 일본어 표기 template, definition lists and bold names with a Japanese name in parentheses); a pair attaches to the one character of that name in the article's work family.
- Readings (`kind: 'reading'`, kana) are what Korean names are generated from at build time (`hangulVariants` in `src/text.ts`); a source never generates names itself.
- The build unions entries of one kind whose refs meet, keyed by the strongest ref (entity ids are `w/<ref>` and `c/<ref>`). It never joins two different Wikidata items, however their refs overlap. Works without a shared ref merge by a Japanese title each source gives one work of the same medium (a Wikidata item with an IGDB or Steam id is a game), within a year. Characters merge by name with evidence: a name both sides share and a work both appear in (a Danbooru qualifier counts as a work when it names one) merges even short names, as long as no other entity of either source could claim it; without a shared work the name must be official on at least one side, not short, and the only one of its kind in both sources. Danbooru variant tags with two qualifiers never merge across sources.
- A family entry goes to every work its evidence ties together: the works carrying its id (Wikidata P13236) and the works sharing one of its Japanese titles, grouped by Wikidata relations, `near` and a shared character (one in more than 200 works does not count). It takes the groups with an anchor, else the one group, else a group of two or more holding two thirds of the works, else none. Only the family's head (the anchor, else the earliest work) takes its names and popularity; the rest take the tag alone.
- A character's home is the copyright tag its own tag's qualifier names (a copyright with no qualifier or `(series)`), else the tag most of its works carry (a work without one counts its linked works' tags; a tie goes to more posts), else its franchise's, else what most characters sharing its qualifier chose. `core` gets the home its own data gives and `unlicensed` the one every layer gives.
- Popularity is each source's count on a log scale against its own 99th percentile, averaged over the sources that know the entity: Wikidata sitelinks, anime-offline-database tag count × score, VNDB votes weighted by role (heroines over protagonist over side and cameo), Bangumi collections, Danbooru posts (characters) and copyright posts (a family's head).
- `related` (Wikidata's based on, derivative, series, part, franchise, follows) ties works into families: a query matching a franchise also lifts the anime in its family whose own names contain the query, and family members share popularity.
- `adult` marks a work; a character is adult when all its works are. Search returns them flagged and filters them only on request.

## Layers and licenses

Every source belongs to one layer, and a built file never mixes layers: share-alike licenses cannot be merged into one database. The search library joins the layers on the user's machine.

Derived scores (popularity, standing, flags) are the only cross-layer values a file carries, never names.

- `core` — CC0 and ODbL: Wikidata, anime-offline-database (cedya77's continuation), VNDB. The built `core.sqlite` is ODbL.
- `kowiki` — CC BY-SA 4.0: Korean Wikipedia article titles and redirects.
- `unlicensed` — sources that state no license or whose data comes from sites that state none: AniDB titles, Bangumi, Anissia, Danbooru. Kept in its own file so a user can leave it out.
- Namuwiki is not used (CC BY-NC-SA, robots.txt forbids it). AniList and TMDB terms forbid storing their data; pixiv forbids crawlers. None of them is a source: their ids on a work come from Wikidata and anime-offline-database.

## Conventions

- First-party code carries no comments.
- Single quotes, no semicolons, 2-space indent, 120 columns (biome). ES modules, `.ts` import extensions.
- Network: every request sends `USER_AGENT` from `src/net.ts`; be polite (Danbooru about 1 request/s sustained, Zerochan 60/min, Wikidata SPARQL one query at a time, AniDB never directly — use the Anime-Lists mirror). Downloads go through `download` (writes `.part`, then renames).
- Errors thrown for the user start with `aninames:`.
- The client (`src/client/`, the npm package) runs unchanged on Node 22 and Bun: no `bun:*` and no Bun globals, and it imports only `es-hangul` and the pure `src/text.ts`, `src/model.ts` and `src/match.ts`. What it reads from the files is `unknown` until checked.
- No backwards-compat shims or legacy fallbacks.
