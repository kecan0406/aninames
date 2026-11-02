# Roadmap

What to improve next, each with what was seen or measured when it came up (2026-11-02, UTC). Since 2026-11-01 Bangumi is the spine: only its works and characters are entities and only its data gives structure; every other source attaches names, ids and tags. The first group keeps the releases running; the second fixes what a consumer shows; the last guards against regressions. Effort is a rough guess: small, medium or large.

## Keep the build and the releases running

### 1. Register the npm trusted publisher

`.github/workflows/publish.yml` publishes when `package.json`'s version is one npm does not have, with provenance and without a token. It fails with `ENEEDAUTH` until the package owner registers it on npmjs.com (owner `kecan0406`, repository `aninames`, workflow `publish.yml`), once; until then a version bump needs `npm publish` by hand behind two-factor.

- Effort: small, the owner's.

### 2. Danbooru is frozen at 2026-10-03

Danbooru has refused scripted requests (Cloudflare 403) since 2026-10-30, so builds stage the 10-03 raw data and read the post counts in `data/copyrights.json.gz`, counted once from a public copy. Since the spine it only supplies tags, aliases and post counts, never entities, so a frozen Danbooru no longer changes what the index holds; tags created since then are missing, and 2,339 tags with 50+ posts that no Bangumi character took on 2026-11-01 have no counts, and `tagged` and `cast` order by older post counts.

- Options: an API key (an account owner's), Danbooru's BigQuery export (tags, aliases, implications), or running `scripts/copyrights.py` against a newer copy.
- Effort: medium.

## What a consumer shows

### 3. Given-name tails

A given name alone still lists every Bangumi namesake: `エミリア` returns Re:Zero's Emilia first and nine other Emilias after her, most of them eroge heroines. Keeping only characters with at least 20 Bangumi collects (11,259 of 213,713) cut that list from 10 to 5 with the same first hit on 15 such queries. ttheme shows no such list today: its work-scoped search asks for 50 characters and filters them by the work, so a floor would risk more than it saves. Left until a consumer shows the tail.

- Effort: small to medium.

### 4. Plain tags that take a namesake

A tag with no qualifier still takes a one-word namesake anywhere in Bangumi when the works its copyright reaches hold no such character, because that keeps `wario`, `wooloo` and `poring`; it also keeps `dark_sakura` on キングダム's 黒桜. Qualified tags lost this on 2026-11-02 (about 450, most of them wrong, a few right like `vergilius_(project_moon)`).

- Effort: small to medium.

### 5. Tags that join two people

`son_gohan` and `grandpa_gohan` both attach to Bangumi's one 孫悟飯: the second tag's Japanese name is 孫悟飯 with a qualifier, and no count sets them apart since both are `dragon_ball`. Wikidata's two items join the same way, so `Grandpa Gohan` can read as a name of the wrong person. Two items of one source on one Bangumi entry are a signal nothing uses yet.

- Effort: small to medium.

### 6. One preferred name per language

Each layer marks its best name per entity and language with its rank among every layer's best (`names.pref`); the client marks it `preferred` and labels by it. Of a hand-corrected table of ttheme's 41 names, 19 match. A two-word tag's words now beat other sources, which fixes most of them and gives `Yor Briar` over `Yor Forger`. "Case Closed" is the official English title of 名探偵コナン in both Wikidata and AniDB, and "Detective Conan" a synonym in both, so no rule that follows the sources picks it; a family head's `en` is that one work's (`The Hyrule Fantasy`), so ttheme titles a franchise from its tag.

- Effort: small to medium.

### 7. Search ranking

Popularity is Bangumi's alone since the spine, so namesakes reorder: `sakura` puts 間桐桜 before 木之本桜 and `hina` 天野陽菜 before 空崎ヒナ, whom Danbooru draws far more. Averaging Bangumi's and Danbooru's log scales where both exist was tried on 2026-11-02: first hits rose by 17 of 4,617 probe queries (paired randomization test p = 0.12, MRR p = 0.20) and ttheme's Japanese queries from 154 to 158 of 162, and `사쿠라` fell to 佐倉杏子, so it was left out. `attack on titan` finds the entry Wikidata and AniDB gave that name (Season 3's), not the first season.

- Effort: small to medium.

## Guards

### 8. A probe floor in the audit

`mise run eval` reports, without counting them, which of ttheme's tags resolve (`tests/ttheme.tsv`, 139 of 139) and the homes of ttheme's commons (`tests/homes.tsv`, 140 right and none wrong); `mise run audit` holds floors for both (95% of the tags, at most 5 wrong homes) and for the leads of 17 casts (`tests/leads.tsv`), so a release that loses them does not publish. Left: a probe floor there too, since a ranking change only shows in `mise run probe`. `tests/probe.json` was redrawn for the Bangumi ids, so probe figures before 2026-11-01 are on another sample.

- Effort: small.

## Order

1 first, by the owner; the rest as a consumer needs them.
