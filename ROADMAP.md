# Roadmap

What to improve next, each with what was seen or measured when it came up (2026-11-01, UTC). Since 2026-11-01 Bangumi is the spine: only its works and characters are entities and only its data gives structure; every other source attaches names, ids and tags. The first group keeps the weekly build and the releases running; the second fixes what a consumer shows; the last guards against regressions. Effort is a rough guess: small, medium or large.

## Keep the build and the releases running

### 1. Ship the spine to ttheme

Every entity id changes once (to `w/bangumi:<id>` and `c/bangumi:<id>`), so anything ttheme stored by id has to be looked up again by its Danbooru tag or refs. The static index stays format 1, so ttheme's current client reads the new files; the client in this repository also always reads `unlicensed` (the spine) and no longer requires `core`, which needs an npm release.

- Effort: small (aninames), medium (ttheme's stored ids).

### 2. Publish to npm from the release workflow

Every client change is published by hand behind npm's two-factor prompt: 0.3.0, 0.3.1 and 0.3.2 went out the same day, and one attempt was lost to an approval that timed out (`E404` on `/-/v1/done`, nothing published). Trusted publishing from GitHub Actions would publish when `package.json`'s version changes, and add provenance.

- Needs: the package owner registers the workflow as a trusted publisher on npmjs.com, once.
- Effort: small.

### 3. A fallback that survives schema changes

When a source fails, the weekly run unpacks the latest data release's SQLite and cuts the site from it with the current code. That breaks whenever the build adds a table or a column, and the releases before the spine hold the old entity ids, so a fallback to one of them would put union-era ids back on the site. Keeping the last good `dist/site` and redeploying it as it stands avoids cutting old data with new code.

- Effort: small.

### 4. Danbooru is frozen at 2026-10-03

Danbooru has refused scripted requests (Cloudflare 403) since 2026-10-30, so builds stage the 10-03 raw data. Since the spine it only supplies tags, aliases and post counts, never entities, so a frozen Danbooru no longer changes what the index holds; tags created since then are missing, and `tagged` and `cast` order by older post counts.

- Options: an API key (an account owner's) or Danbooru's BigQuery export (tags, aliases, implications).
- Effort: medium.

## What a consumer shows

### 5. Given-name tails

A given name alone still lists every Bangumi namesake: `エミリア` returns Re:Zero's Emilia first and nine other Emilias after her, most of them eroge heroines. Keeping only characters with at least 20 Bangumi collects (11,259 of 213,713) and leaving adult ones out cut that list from 10 to 5 with the same first hit on all 15 such queries tried; with adult characters kept, as decided, the collects floor alone has to do it. A floor would be a tier in the key rows (format 1 allows appending a value), with the tail still found by its full name.

- Effort: small to medium.

### 6. Homes

Of ttheme's commons, 120 get the home ttheme gives them, 17 another, 1 none and 62 are tags no Bangumi character takes (35 of those are beatmania IIDX version tags). The wrong ones:
- Franchises Bangumi has no work for: `touhou`, `vocaloid`, `sound_voltex`. Their copyright tags match no Bangumi title, so their characters go home to one of the games (`embodiment_of_scarlet_devil`, `project_sekai`).
- Collaboration or spin-off appearances that outnumber a character's own: VA-11 Hall-A's cast in Girls' Frontline, Toriel in Deltarune, Momoe Nagisa in Magia Record.
- Options: let Wikidata's series and franchise items (P179, P8345, dropped from the fetch with the spine) place copyright tags on the Bangumi works they list, as evidence for tags only; or weigh Bangumi's cameo cast type below a minor role.
- Effort: medium.

### 7. Attachments still missed

Bangumi has Jill Stingray (`Jill`, `Julianne Natalie Stingray`), KAITO and MEIKO, but no name of theirs matches the Danbooru tag's names uniquely. Costume and alternate-form tags now attach to their base character (`gotoh_hitori_(octopus)`, `togawa_sakiko_(exitus)`), which `silver` counts as wrong (2,724 of its 2,874).

- Effort: small each.

### 8. One preferred name per language

Each layer marks its best name per entity and language with its rank among every layer's best (`names.pref`); the client marks it `preferred` and labels by it. "Case Closed" is the official English title of 名探偵コナン in both Wikidata and AniDB, and "Detective Conan" a synonym in both, so no rule that follows the sources picks it; names keep their source's word order (`en` "Shinji Ikari", `ja-Latn` "Ikari Shinji").

- Effort: small to medium.

### 9. Search ranking

Popularity is Bangumi's alone since the spine, so namesakes reorder: `sakura` puts 間桐桜 before 木之本桜 and `hina` 天野陽菜 before 空崎ヒナ, whom Danbooru draws far more. Bangumi's anniversary PVs and shorts (Blue Archive's) are works of their own and still show for the franchise's name.

- Effort: small to medium.

## Guards

### 10. A cast and home check in eval

`mise run eval` checks pairs that must be one character and reports the homes of ttheme's commons (`tests/homes.tsv`, not counted). Left: a fixed set of works with their expected leads, and counting homes once the misses in 6 are settled. `tests/probe.json` was redrawn for the Bangumi ids, so probe figures before 2026-11-01 are on another sample.

- Effort: small.

## Order

1 first, with ttheme; then 5, which is what the spine leaves of "too many characters", then 3 and 6.
