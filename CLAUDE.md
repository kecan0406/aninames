# CLAUDE.md

aninames builds a multilingual alias index for anime (and visual novel) titles and characters: any title or character name typed in Japanese (kanji, kana), romaji with any spelling, English, Korean or Chinese should find the right work or character. It ships data files, not a server.

## Commands

All dev commands are mise tasks; package.json has no scripts. The toolchain is bun 1.3.

- `mise run fetch [source…]` — download raw data into `.cache/raw/<source>/`
- `mise run stage [source…]` — parse raw data into `.cache/stage/<source>.jsonl`
- `mise run build` — merge the staged sources into one SQLite file per layer in `dist/`
- `mise run search <query>` / `mise run eval` — query the built layers / run the golden queries in `tests/golden.ts`
- `mise run ci` — lint + typecheck + tests

## Pipeline

- A source (`src/sources/<name>.ts`, default export of type `Source` from `src/model.ts`) has a `fetch` that downloads into its raw dir and a `stage` that yields `Entry` records. `src/sources/index.ts` lists the names and loads them lazily.
- An `Entry` is one work or character as one source sees it: `id` (a `Ref`, `<namespace>:<id>`), `kind`, `refs` (ids in other namespaces the source says are the same thing), `names` (text, BCP 47 `lang` when known — `ja`, `ja-Latn` for romaji, `en`, `ko`, `zh-Hans`, `zh-Hant`, `zh` — and a `NameKind`), `works` (a character's works, as refs), `link` (name texts to attach by when there are no refs), `rank` (the source's own popularity number, higher is more popular), `type`, `year`. `attach: true` means the entry only adds names to an entity found through its refs or link and never creates one; such an entry may omit `kind`.
- A redirect to a section of an article (`kind: 'section'`, Korean Wikipedia's 페른 → 장송의 프리렌#페른) usually names a character or a part of the work, not the work itself, and ranks well below a real alias.
- Readings (`kind: 'reading'`, kana) are what Korean names are generated from at build time (`hangulVariants` in `src/text.ts`); a source never generates names itself.
- The build unions entries of one kind whose refs meet, keyed by the strongest ref.

## Layers and licenses

Every source belongs to one layer, and a built file never mixes layers: share-alike licenses cannot be merged into one database. The search library joins the layers on the user's machine.

- `core` — CC0 and ODbL: Wikidata, anime-offline-database (cedya77's continuation), VNDB. The built `core.sqlite` is ODbL.
- `kowiki` — CC BY-SA 4.0: Korean Wikipedia article titles and redirects.
- `unlicensed` — sources that state no license or whose data comes from sites that state none: AniDB titles, Bangumi, Anissia, Danbooru. Kept in its own file so a user can leave it out.
- Namuwiki is not used (CC BY-NC-SA, robots.txt forbids it). AniList and TMDB terms forbid storing their data; pixiv forbids crawlers. None of them is a source.

## Conventions

- First-party code carries no comments.
- Single quotes, no semicolons, 2-space indent, 120 columns (biome). ES modules, `.ts` import extensions.
- Network: every request sends `USER_AGENT` from `src/net.ts`; be polite (Danbooru about 1 request/s sustained, Zerochan 60/min, Wikidata SPARQL one query at a time, AniDB never directly — use the Anime-Lists mirror). Downloads go through `download` (writes `.part`, then renames).
- Errors thrown for the user start with `aninames:`.
- No backwards-compat shims or legacy fallbacks.
