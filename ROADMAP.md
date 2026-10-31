# Roadmap

What to improve next, each with what was seen or measured when it came up (2026-11-01, UTC). The first group keeps the weekly build and the releases running; the second fixes what a consumer shows; the last guards against regressions. Effort is a rough guess: small, medium or large.

## Keep the build and the releases running

### 1. Publish to npm from the release workflow

Every client change is published by hand behind npm's two-factor prompt: 0.3.0, 0.3.1 and 0.3.2 went out the same day, and one attempt was lost to an approval that timed out (`E404` on `/-/v1/done`, nothing published). Trusted publishing from GitHub Actions would publish when `package.json`'s version changes, and add provenance. The client has changed since 0.3.2 (`Found.match`, `names[].preferred`, the label by preferred names), so the next release carries those to ttheme.

- Needs: the package owner registers the workflow as a trusted publisher on npmjs.com, once.
- Effort: small.

### 2. A fallback that survives schema changes

When a source fails, the weekly run unpacks the latest data release's SQLite and cuts the site from it with the current code. That breaks whenever the build adds a table or a column: run 41175976214 found no `homes` table in the old files and deployed nothing. `entities.origin`, `homes.tier` and `names.pref` have been added since and `ranks.weight` dropped, so the same trap is set again. Keeping the last good `dist/site` and redeploying it as it stands avoids cutting old data with new code.

- Effort: small.

### 3. Danbooru is frozen at 2026-10-03

Danbooru has refused scripted requests (Cloudflare 403) since 2026-10-30, so builds stage the 10-03 raw data. From this machine on 2026-11-01, `danbooru.donmai.us` resets the connection and `safebooru.donmai.us` answers a Cloudflare challenge. Works and characters tagged since then have no tag, so no home and no place in a cast, and post counts grow older every week. Most of what items 4 and 8 leave open needs data only Danbooru has: which copyright a character's posts carry, and the copyright → copyright implications above a game's own tag (Danbooru refuses an implication from a character tag to a copyright tag, so implications never name a character's home directly).

- Options: an API key (an account owner's), Danbooru's BigQuery export (it exports tags, aliases and implications), or homes that lean further on Bangumi's subject–character relations and Wikidata's P1441.
- Effort: medium.

## What a consumer shows

### 4. Homes

Done: copyright tags reach more works (3,248 → 3,829 tags on works): a qualifier comes off a tag's names unless another tag needs it, Latin titles and the tag's own name count (matched by `titleKey`, which keeps Roman numerals apart), and a group the tag's own name finds wins over an even split. A character's home follows its works up through their series, franchises and originals (Wikidata's `within` and `basis`) and is the most specific tag a role-weighted majority of them reach that holds at least 0.8 of the character's own posts (on ttheme's commons the right home always holds more). Of the 165 characters of ttheme's commons that are Danbooru character tags: 121 → 143 right, 19 → 7 wrong, 25 → 15 none. Touhou's characters go to `touhou`, Monogatari's to `monogatari_(series)`, Shinkalion Z's no longer to Evangelion.

Left:
- The four Vocaloids land on `project_diva`, where most of their works are; only the copyrights on their own posts would say `vocaloid` (item 3).
- Danbooru tags no catalog knows have no works: BEMANI's characters, Undertale's Toriel and Mettaton, Jill Stingray. `maud_(bemani)` and `rebecca_(cyberpunk)` go by their qualifier.
- Series items without an id the fetch knows are missing from the graph (Monogatari's anime seasons reach `monogatari_(series)` only through their novels). Fetching the targets of `within` and `basis` once, as `linked` fetches the works of characters, would close many gaps.
- Effort: medium (the graph fetch), large (the rest needs item 3).

### 5. Parody characters merged into the originals

Done: characters merge by scored evidence (`src/resolve.ts`). Main Latin names that disagree subtract unless a Japanese name agrees, works that never meet subtract, and a pair scored well below zero never ends up together through others: the parody's Zenitsu had joined the original through Danbooru's `agatsuma_zenitsu`. "Agatsuma Zeniko" and "Tomioka Yuu" stay apart. `mise run silver`: recall 88.6% → 91.0%, precision 98.8% → 98.0%, where about 45 of the 101 pairs it counts as wrong join a character's other form (item 8); without those joins it is 90.6% and 98.9%.

### 6. One preferred name per language

Done: each layer marks its best name per entity and language with its rank among every layer's best (`names.pref`); the client marks it `preferred` and labels by it. "Case Closed" is the official English title of 名探偵コナン in both Wikidata and AniDB, and "Detective Conan" a synonym in both, so no rule that follows the sources picks it; names keep their source's word order (`en` "Shinji Ikari", `ja-Latn` "Ikari Shinji").

Left: a client that wants one name order for Japanese characters in Latin script has the `ja-Latn` name; reordering `en` names would need family and given names apart (Wikidata P734 and P735, or a kana reading split by a space).

- Effort: small to medium.

### 7. Franchises above families

A family is the works one copyright tag covers, so the Rebuild of Evangelion films, which have tags of their own, stay outside `neon_genesis_evangelion`'s: a work's family lists three works there. The build now keeps Wikidata's series, franchise and part relations apart from the rest (`src/graph.ts`) and homes walk them; clients do not see them yet. A work's franchise, the top of that graph, would let a client list a franchise's works together.

- Effort: medium.

### 8. Merges still missed

Done: D.Va's Danbooru tag joins her Bangumi entry (a one-word name with a dot gets a key), Kitagawa Yusuke's tag joins him (pairs join in order of score, so his Persona's tag no longer takes his place), Lucy's (a Danbooru alias counts as strong), and a Danbooru tag of a character's other form joins the character on strong evidence (Sailor Mercury, the cure names of Precure). A Danbooru qualifier whose title many works share still speaks against a merge: Tom and Jerry's Jerry no longer joins One Piece's.

Left:
- Costume tags without a Japanese name stay separate characters (`black_cat_d.va`, `k/da_ahri`). A rule that took `<words> <character>` for a costume joined given-name namesakes instead (`miyauchi_hina` to Blue Archive's Hina) and was dropped.
- One source's two entries for one character stay two: Bangumi's 先生 for Blue Archive's game and for its anime.
- Pairs of characters in one home whose names differ only by Han variants: 30 when measured on 10-31, not measured since.
- Effort: small to medium each.

### 9. Search ranking

Done: a count of zero is no evidence (characters' Wikidata sitelinks), and an entity takes the highest of its sources instead of their average. "Ahri" finds League of Legends' Ahri first; on the probe, names several characters share are found first more often (romaji 71/75/31% → 79/79/38%). `Found.match` tells a whole-name hit from one that matched one word of a name, so a client can leave "gangut dva" out of what "D.Va" means.

Left:
- Without `unlicensed`, no `core` source counts Ahri, and an exact "Ahri" loses to names that contain "ari".
- ttheme's characters typed by a given name alone shift between namesakes of similar popularity (アスナ, ルーシー, Beatrice).
- Effort: small to medium.

## Guards

### 10. A cast and home check in eval

Partly done: `mise run eval` now checks pairs that must be one character and pairs that must stay two (counted) and reports the homes of ttheme's commons (`tests/homes.tsv`, not counted). Left: a fixed set of works with their expected leads, and counting homes once the known misses above are settled.

- Effort: small.

## Order

1 and 2 first: each is small, and 1 also carries the new client to ttheme. Then 3, which most of what is left in 4 and 8 needs, then 7.
