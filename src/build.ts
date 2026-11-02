import { Database } from 'bun:sqlite'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type Copyrights, closestWork, type Drawn, drawnOf, ownersOf, readCopyrights } from './copyrights.ts'
import { workNames as namesOfWorks, titleName, type WorkGraph } from './families.ts'
import { alike, levelsOf, tiesOf, upward, wordsOf } from './graph.ts'
import { type Appearance, type Choice, chosenOf, FLOOR, homeOf, learnedOf, tierOf, weightOf } from './homes.ts'
import {
  type Entry,
  type Kind,
  LAYERS,
  type Layer,
  type Name,
  type NameKind,
  ROLES,
  type Source,
  SPINE,
} from './model.ts'
import { load, NAMES } from './sources/index.ts'
import { BANGUMI, link, MEDIUM_ORDER, type Medium, mediaOf } from './spine.ts'
import { readStage, stagePath } from './stage.ts'
import {
  flat,
  hangulForms,
  initials,
  isKana,
  japanese,
  kanaToRomaji,
  latinKey,
  partKey,
  qualifiers,
  soundKeys,
  titleKey,
} from './text.ts'
import { node, refOf, type Union } from './union.ts'

export const DIST = join(import.meta.dirname, '..', 'dist')

export interface Staged {
  source: string
  layer: Layer
  entry: Entry
  popularity: number
  below?: boolean
}

export async function readAll(): Promise<{ all: Staged[]; sources: Source[] }> {
  const all: Staged[] = []
  const sources: Source[] = []
  for (const name of NAMES) {
    if (!(await Bun.file(stagePath(name)).exists())) {
      console.log(`build: no stage for ${name}, skipped`)
      continue
    }
    const source = await load(name)
    sources.push(source)
    const entries: Entry[] = []
    for await (const entry of readStage(name)) entries.push(entry)
    for (const kind of ['work', 'character'] as const) {
      const ranked = entries
        .filter((e) => e.kind === kind && (e.rank ?? 0) > 0)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      const top = Math.log1p(ranked[Math.floor(0.99 * (ranked.length - 1))]?.rank ?? 0) || 1
      for (const e of ranked) {
        all.push({
          source: name,
          layer: source.layer,
          entry: e,
          popularity: Math.log1p(Math.max(0, e.rank ?? 0)) / top,
        })
      }
    }
    for (const e of entries) {
      if (e.kind === undefined || !((e.rank ?? 0) > 0))
        all.push({ source: name, layer: source.layer, entry: e, popularity: 0 })
    }
    console.log(`build: read ${name} (${source.layer}): ${entries.length} entries`)
  }
  return { all, sources }
}

interface Entity {
  id: string
  kind: Kind
  layer: Layer
  members: Staged[]
}

function resolveEntities(
  staged: Staged[],
  copyrights: Copyrights,
): { union: Union; graph: WorkGraph; entities: Map<string, Entity>; dropped: number } {
  const { union, graph } = link(staged, false, copyrights)
  const entities = new Map<string, Entity>()
  let dropped = 0
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || !entry.kind) continue
    const key = node(entry.kind, entry.id)
    const anchor = union.anchorOf(key)
    if (!anchor) {
      dropped++
      continue
    }
    const root = union.find(key)
    let entity = entities.get(root)
    if (!entity) {
      entity = {
        id: `${entry.kind === 'work' ? 'w' : 'c'}/${refOf(anchor)}`,
        kind: entry.kind,
        layer: SPINE,
        members: [],
      }
      entities.set(root, entity)
    }
    entity.members.push(s)
  }
  return { union, graph, entities, dropped }
}

const own = (s: Staged) => s.source === BANGUMI

function parentsOf(union: Union, entities: Map<string, Entity>): Map<string, Set<string>> {
  const parents = new Map<string, Set<string>>()
  for (const [root, entity] of entities) {
    if (entity.kind !== 'work') continue
    for (const m of entity.members) {
      if (!own(m)) continue
      for (const ref of upward(m.entry)) {
        const key = node('work', ref)
        const there = union.has(key) ? union.find(key) : undefined
        if (!there || there === root || !entities.has(there)) continue
        const set = parents.get(root) ?? new Set<string>()
        set.add(there)
        parents.set(root, set)
      }
    }
  }
  return parents
}

function attachEntries(
  union: Union,
  staged: Staged[],
  entities: Map<string, Entity>,
  graph: WorkGraph,
): { attached: number; missed: number; spread: Map<string, Set<string>> } {
  const workNames = namesOfWorks(union, staged)
  const characterNames = new Map<string, Set<string>>()
  const characterWorks = new Map<string, Set<string>>()
  const neighbours = graph.links
  const remember = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>()
    set.add(value)
    map.set(key, set)
  }
  const workRoot = (ref: string) => {
    const key = node('work', ref)
    return union.has(key) ? union.find(key) : undefined
  }
  for (const [root, entity] of entities) {
    for (const m of entity.members) {
      if (entity.kind === 'work') continue
      if (own(m)) {
        for (const work of m.entry.works ?? []) {
          const there = workRoot(work)
          if (there) remember(characterWorks, root, there)
        }
      }
      for (const name of m.entry.names) {
        if (name.kind === 'reading' || !japanese(name.text)) continue
        const key = flat(qualifiers(name.text).base)
        if ([...key].length >= 2) remember(characterNames, key, root)
      }
    }
  }
  const family = (root: string) => {
    const out = new Set([root])
    let frontier = [root]
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = []
      for (const at of frontier)
        for (const other of neighbours.get(at) ?? [])
          if (!out.has(other)) {
            out.add(other)
            next.push(other)
          }
      frontier = next
    }
    return out
  }
  const castOf = (entry: Entry): Entity | undefined => {
    const context = new Set<string>()
    for (const work of entry.works ?? []) {
      const root = workRoot(work)
      if (root) for (const member of family(root)) context.add(member)
    }
    if (context.size === 0) return undefined
    const roots = new Set<string>()
    for (const text of entry.link ?? []) for (const root of characterNames.get(flat(text)) ?? []) roots.add(root)
    const inCast = [...roots].filter((root) => [...(characterWorks.get(root) ?? [])].some((work) => context.has(work)))
    return inCast.length === 1 ? entities.get(inCast[0] ?? '') : undefined
  }
  const spread = new Map<string, Set<string>>()
  let attached = 0
  let missed = 0
  for (const s of staged) {
    const { entry } = s
    if (!entry.attach) continue
    if (entry.kind === 'character' && entry.link?.length) {
      const found = castOf(entry)
      if (found) {
        found.members.push(s)
        attached++
      } else missed++
      continue
    }
    if (entry.family) {
      const { works, head, reached } = graph.families.get(entry.id) ?? { works: [], reached: new Set<string>() }
      const rank = entry.rank === undefined ? {} : { rank: entry.rank }
      const tag: Staged = {
        ...s,
        entry: { id: entry.id, kind: 'work', attach: true, names: [], ...rank },
        popularity: 0,
        below: true,
      }
      for (const root of works) entities.get(root)?.members.push(root === head ? s : tag)
      for (const root of reached) remember(spread, root, entry.id.slice(TAG.length))
      if (works.length > 0) attached++
      else missed++
      continue
    }
    const kinds: Kind[] = entry.kind ? [entry.kind] : ['work', 'character']
    let target: Entity | undefined
    for (const kind of kinds) {
      for (const ref of entry.refs ?? []) {
        const key = node(kind, ref)
        if (!union.has(key)) continue
        target = entities.get(union.find(key))
        if (target) break
      }
      if (target) break
    }
    const targets: Entity[] = target ? [target] : []
    if (!target && entry.link?.length && kinds.includes('work')) {
      const roots = new Set<string>()
      for (const text of entry.link) for (const root of workNames.get(titleName(text)) ?? []) roots.add(root)
      const media = new Set<Medium | null>(mediaOf(s))
      const fitting = [...roots].flatMap((root) => {
        const found = entities.get(root)
        return found && (media.size === 0 || media.has(mediumOf(found))) ? [found] : []
      })
      if (fitting.length === 1) targets.push(fitting[0] as Entity)
    }
    for (const found of targets) found.members.push(s)
    if (targets.length > 0) attached++
    else missed++
  }
  return { attached, missed, spread }
}

interface Home {
  tag: string
  posts: number | null
  tier: number
  also: { tag: string; tier: number }[]
}

const TAG = 'danbooru:'

function tagsOf(root: string, entity: Entity, union: Union): Map<string, number | null> {
  const tags = new Map<string, number | null>()
  const add = (tag: string, posts: number | null) => {
    const known = tags.get(tag)
    if (!tags.has(tag) || (posts ?? -1) > (known ?? -1)) tags.set(tag, posts)
  }
  for (const m of entity.members) {
    const { entry } = m
    if (entry.id.startsWith(TAG) && (entry.attach || union.find(node(entity.kind, entry.id)) === root)) {
      add(entry.id.slice(TAG.length), entry.rank ?? null)
    }
    for (const ref of entry.refs ?? []) {
      if (ref.startsWith(TAG) && union.find(node(entity.kind, ref)) === root) add(ref.slice(TAG.length), null)
    }
  }
  return tags
}

function homesOf(
  union: Union,
  entities: Map<string, Entity>,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
  links: ReadonlyMap<string, ReadonlySet<string>>,
  families: ReadonlyMap<string, number | null>,
  spread: ReadonlyMap<string, ReadonlySet<string>>,
  copyrights: Copyrights,
): Map<string, Home> {
  const workRoot = (ref: string) => {
    const key = node('work', ref)
    return union.has(key) ? union.find(key) : undefined
  }
  const workTags = new Map<string, Map<string, number | null>>()
  const posts = new Map<string, number | null>(families)
  const more = (tag: string, count: number | null) => {
    if (!posts.has(tag) || (count ?? -1) > (posts.get(tag) ?? -1)) posts.set(tag, count)
  }
  for (const [root, entity] of entities) {
    if (entity.kind !== 'work') continue
    const tags = tagsOf(root, entity, union)
    if (tags.size === 0) continue
    workTags.set(root, tags)
    for (const [tag, count] of tags) more(tag, count)
  }
  const postsOf = (tag: string) => posts.get(tag) ?? 0
  const direct = new Map<string, string>()
  for (const tag of [...posts.keys()].sort((a, b) => postsOf(b) - postsOf(a) || (a < b ? -1 : 1))) {
    const { base, quals } = qualifiers(tag)
    const key = flat(base)
    if (!key || quals.some((qual) => qual !== 'series')) continue
    const known = direct.get(key)
    if (!known || (qualifiers(known).quals.length > 0 && quals.length === 0)) direct.set(key, tag)
  }
  const above = new Map<string, Map<string, number>>()
  const ownUp = (root: string): Map<string, number> => {
    const found = new Map<string, number>()
    for (const [at, level] of levelsOf(parents, root)) {
      for (const tag of workTags.get(at)?.keys() ?? []) {
        if (level < (found.get(tag) ?? Number.POSITIVE_INFINITY)) found.set(tag, level)
      }
      for (const tag of spread.get(at) ?? []) {
        if (level + 1 < (found.get(tag) ?? Number.POSITIVE_INFINITY)) found.set(tag, level + 1)
      }
    }
    return found
  }
  const titles = new Map<string, Set<string>[]>()
  const titlesOf = (root: string) => {
    let found = titles.get(root)
    if (!found) {
      found = (entities.get(root)?.members ?? []).flatMap((m) =>
        m.entry.attach
          ? []
          : m.entry.names
              .filter(
                (name) =>
                  name.kind === 'main' ||
                  name.kind === 'official' ||
                  (name.kind === 'synonym' && (name.lang === 'en' || name.lang === 'ja-Latn')),
              )
              .map((name) => wordsOf(name.text))
              .filter((words) => words.size > 0),
      )
      titles.set(root, found)
    }
    return found
  }
  const alikeTitles = (a: string, b: string) => titlesOf(a).some((x) => titlesOf(b).some((y) => alike(x, y)))
  const tagsUp = (root: string): Map<string, number> => {
    const known = above.get(root)
    if (known) return known
    const found = ownUp(root)
    if (found.size === 0) {
      for (const other of links.get(root) ?? []) {
        if (!alikeTitles(root, other)) continue
        for (const [tag, level] of ownUp(other)) {
          if (level + 1 < (found.get(tag) ?? Number.POSITIVE_INFINITY)) found.set(tag, level + 1)
        }
      }
    }
    above.set(root, found)
    return found
  }
  const chosen: {
    id: string
    quals: string[]
    voted: Set<string>
    choice: Choice | undefined
    posts: number | null
    roles: Map<string, number>
    drawn: Drawn | undefined
  }[] = []
  const learning = new Map<string, Map<string, number>>()
  for (const [root, entity] of entities) {
    if (entity.kind !== 'character') continue
    const tagged = [...tagsOf(root, entity, union)].sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1))
    const quals = tagged.flatMap(([tag]) => {
      const found = qualifiers(tag).quals
      const key = found.length === 1 ? flat(found[0] ?? '') : ''
      return key ? [key] : []
    })
    const works = new Set<string>()
    const roles = new Map<string, number>()
    for (const m of entity.members) {
      if (!own(m)) continue
      for (const ref of m.entry.works ?? []) {
        const there = workRoot(ref)
        if (there) works.add(there)
      }
      for (const [ref, role] of m.entry.roles ?? []) {
        const there = workRoot(ref)
        if (!there) continue
        works.add(there)
        roles.set(there, Math.min(roles.get(there) ?? ROLES.length, ROLES.indexOf(role)))
      }
    }
    const best = tagged.find(([, count]) => count !== null)?.[1] ?? null
    const appearances: Appearance[] = [...works].map((work) => ({
      weight: weightOf(roles.get(work)),
      tags: tagsUp(work),
    }))
    const fits = (tag: string) => {
      const count = posts.get(tag)
      return best === null || count === null || count === undefined || count >= FLOOR * best
    }
    const choice = chosenOf(appearances, fits, postsOf)
    const drawn = drawnOf(
      tagged.map(([tag]) => tag),
      copyrights,
    )
    if (quals.length === 0 && !choice && !drawn) continue
    const voted = new Set(appearances.flatMap((appearance) => [...appearance.tags.keys()]))
    chosen.push({ id: entity.id, quals, voted, choice, posts: best, roles, drawn })
    const qual = quals[0]
    const found = choice?.tag
    if (qual && found) {
      const tags = learning.get(qual) ?? new Map<string, number>()
      tags.set(found, (tags.get(found) ?? 0) + 1)
      learning.set(qual, tags)
    }
  }
  const learned = learnedOf(learning)
  const collected = new Map<string, number>()
  const heads = new Map<string, number>()
  for (const [root, entity] of entities) {
    if (entity.kind !== 'work') continue
    const count = Math.max(0, ...entity.members.filter(own).map((m) => m.entry.rank ?? 0))
    collected.set(root, count)
    for (const tag of tagsUp(root).keys()) heads.set(tag, Math.max(heads.get(tag) ?? 0, count))
  }
  const homes = new Map<string, Home>()
  for (const { id, quals, voted, choice, posts: count, roles, drawn } of chosen) {
    const named = quals.map((qual) => direct.get(qual)).find(Boolean)
    const taught = quals
      .map((qual) => learned.get(qual))
      .find((tag) => tag !== undefined && (voted.size === 0 || voted.has(tag)))
    const closest = drawn && closestWork(drawn, copyrights.sizes)
    const tag = closest ?? homeOf(choice, named, taught)
    if (!tag) continue
    const tierIn = (at: string) =>
      tierOf(roles, (work) => (tagsUp(work).has(at) ? (collected.get(work) ?? 0) : undefined), heads.get(at) ?? 0)
    const also = (drawn ? ownersOf(drawn, tag) : []).map((at) => ({ tag: at, tier: tierIn(at) }))
    homes.set(id, { tag, posts: count, tier: tierIn(tag), also })
  }
  return homes
}

interface Row {
  entity: string
  text: string
  lang: string | null
  kind: NameKind
  source: string
  qual: string | null
  variant: boolean
  support: number
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

function langIn(lang: string | null, text: string): string | null {
  if (lang === null || lang === 'ja' || lang === 'ko' || lang === 'zh' || lang.startsWith('zh-')) return lang
  if (!CJK.test(text)) return lang
  if (/\p{Script=Hangul}/u.test(text)) return 'ko'
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? 'ja' : null
}

function namesOf(entity: Entity, layer: Layer, titles: Map<string, Set<string>>): Row[] {
  const rows: Row[] = []
  const seen = new Set<string>()
  const push = (name: Name, source: string, qual: string | null, unlikely = false) => {
    const text = name.text.normalize('NFC').trim()
    if (!text) return
    const lang = langIn(name.lang ?? null, text)
    const key = `${text}\u0000${lang ?? ''}\u0000${name.kind}`
    if (seen.has(key)) return
    seen.add(key)
    const variant = unlikely || (qual !== null && !titles.has(titleKey(qual)))
    rows.push({ entity: entity.id, text, lang, kind: name.kind, source, qual, variant, support: 0 })
  }
  for (const m of entity.members) {
    if (m.layer !== layer) continue
    for (const name of m.entry.names) {
      push(name, m.source, null)
      const { base, quals } = qualifiers(name.text)
      if (quals.length > 0 && base) push({ ...name, text: base }, m.source, quals.join(' '))
      if ((name.kind === 'reading' || name.lang === 'ja' || name.lang === undefined) && isKana(name.text)) {
        for (const form of hangulForms(name.text)) {
          push({ text: form.text, lang: 'ko', kind: 'generated' }, m.source, null, !form.preferred)
        }
        const romaji = kanaToRomaji(name.text)
        if (romaji) push({ text: romaji, lang: 'ja-Latn', kind: 'generated' }, m.source, null)
      }
    }
  }
  const backers = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = flat(row.text)
    const set = backers.get(key) ?? new Set<string>()
    set.add(row.source)
    backers.set(key, set)
  }
  for (const row of rows) row.support = backers.get(flat(row.text))?.size ?? 1
  return rows
}

const KIND_ORDER: Record<NameKind, number> = {
  main: 0,
  official: 0,
  synonym: 1,
  short: 2,
  reading: 3,
  redirect: 4,
  section: 5,
  generated: 6,
}

const SOURCE_ORDER = ['wikidata', 'anidb', 'vndb', 'aod', 'bangumi', 'kowiki', 'anissia', 'danbooru']

function spokenAs(text: string): string {
  return CJK.test(text) ? flat(text) : latinKey(text)
}

function backersOf(entity: Entity): Map<string, number> {
  const sets = new Map<string, Set<string>>()
  for (const m of entity.members) {
    for (const name of m.entry.names) {
      const key = spokenAs(name.text)
      const set = sets.get(key) ?? new Set<string>()
      set.add(m.source)
      sets.set(key, set)
    }
  }
  return new Map([...sets].map(([key, set]) => [key, set.size]))
}

function written(lang: string, text: string): boolean {
  if (lang === 'ja') return true
  if (lang === 'ko') return /\p{Script=Hangul}/u.test(text)
  if (lang === 'zh' || lang.startsWith('zh-')) return /\p{Script=Han}/u.test(text)
  return !CJK.test(text)
}

function ahead(a: readonly number[], b: readonly number[]): boolean {
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return (a[at] ?? 0) < (b[at] ?? 0)
  return false
}

function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function titleWordsOf(entity: Entity): Set<string> {
  const words = new Set<string>()
  for (const m of entity.members) {
    if (!m.entry.id.startsWith(TAG)) continue
    const { base, quals } = qualifiers(m.entry.id.slice(TAG.length))
    const own = new Set(wordsIn(base))
    for (const qual of quals) for (const word of wordsIn(qual)) if (!own.has(word)) words.add(word)
  }
  return words
}

function topTagOf(entity: Entity): string | undefined {
  const tagged = entity.members.filter((m) => m.entry.id.startsWith(TAG))
  const top = tagged.sort((a, b) => (b.entry.rank ?? 0) - (a.entry.rank ?? 0))[0]
  const base = top && qualifiers(top.entry.id.slice(TAG.length).replace(/_/g, ' ')).base
  return base && /\s/.test(base) ? spokenAs(base) : undefined
}

function bestOf(
  rows: Row[],
  backers: ReadonlyMap<string, number>,
  titled: ReadonlySet<string>,
  top: string | undefined,
): Map<string, { row: Row; key: number[] }> {
  const out = new Map<string, { row: Row; key: number[] }>()
  rows.forEach((row, at) => {
    if (!row.lang || row.qual !== null || row.variant || !written(row.lang, row.text)) return
    const source = SOURCE_ORDER.indexOf(row.source)
    const key = [
      spokenAs(row.text) === top ? 0 : 1,
      KIND_ORDER[row.kind],
      Number(row.text.includes('(') || wordsIn(row.text).some((word) => titled.has(word))),
      -(backers.get(spokenAs(row.text)) ?? 1),
      row.kind === 'official' ? 0 : 1,
      source < 0 ? SOURCE_ORDER.length : source,
      at,
    ]
    const known = out.get(row.lang)
    if (!known || ahead(key, known.key)) out.set(row.lang, { row, key })
  })
  return out
}

function preferencesOf(entity: Entity, layer: Layer, rows: Row[], titles: Map<string, Set<string>>): Map<Row, number> {
  const backers = backersOf(entity)
  const titled = entity.kind === 'character' ? titleWordsOf(entity) : new Set<string>()
  const top = entity.kind === 'character' ? topTagOf(entity) : undefined
  const others = [...new Set(entity.members.map((m) => m.layer))]
    .filter((other) => other !== layer)
    .map((other) => bestOf(namesOf(entity, other, titles), backers, titled, top))
  const out = new Map<Row, number>()
  for (const [lang, { row, key }] of bestOf(rows, backers, titled, top)) {
    out.set(row, others.filter((other) => ahead(other.get(lang)?.key ?? [Infinity], key)).length)
  }
  return out
}

function mediumOf(entity: Entity): Medium | null {
  if (entity.kind !== 'work') return null
  const found = new Set(entity.members.filter(own).flatMap(mediaOf))
  const medium = MEDIUM_ORDER.find((at) => found.has(at)) ?? null
  if (medium === 'game' && entity.members.some((m) => mediaOf(m).includes('vn'))) return 'vn'
  return medium
}

function partsOf(text: string): string[] {
  const tokens = qualifiers(text)
    .base.split(/[\s・·_=＝]+/)
    .map(partKey)
    .filter((token) => [...token].length >= 2)
  return tokens.length >= 2 ? [...new Set(tokens)] : []
}

function schema(db: Database): void {
  db.run('PRAGMA journal_mode = OFF')
  db.run('PRAGMA synchronous = OFF')
  db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.run(
    'CREATE TABLE entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, medium TEXT, type TEXT, year INTEGER, origin TEXT)',
  )
  db.run(
    'CREATE TABLE refs (entity TEXT NOT NULL, ref TEXT NOT NULL, rank REAL, tier INTEGER NOT NULL, own INTEGER NOT NULL)',
  )
  db.run(
    'CREATE TABLE names (rowid INTEGER PRIMARY KEY, entity TEXT NOT NULL, ekind TEXT NOT NULL, text TEXT NOT NULL, lang TEXT, kind TEXT NOT NULL, source TEXT NOT NULL, flat TEXT NOT NULL, latin TEXT NOT NULL, qual TEXT, variant INTEGER NOT NULL, support INTEGER NOT NULL, pref INTEGER)',
  )
  db.run('CREATE TABLE sounds (name INTEGER NOT NULL, entity TEXT NOT NULL, key TEXT NOT NULL)')
  db.run('CREATE TABLE parts (name INTEGER NOT NULL, entity TEXT NOT NULL, part TEXT NOT NULL)')
  db.run('CREATE TABLE initials (name INTEGER NOT NULL, entity TEXT NOT NULL, key TEXT NOT NULL)')
  db.run('CREATE TABLE works (character TEXT NOT NULL, work TEXT NOT NULL)')
  db.run('CREATE TABLE related (work TEXT NOT NULL, other TEXT NOT NULL)')
  db.run('CREATE TABLE ranks (entity TEXT PRIMARY KEY, rank REAL NOT NULL)')
  db.run('CREATE TABLE adults (entity TEXT PRIMARY KEY)')
  db.run('CREATE TABLE homes (entity TEXT PRIMARY KEY, tag TEXT NOT NULL, posts INTEGER, tier INTEGER NOT NULL)')
  db.run('CREATE TABLE copyrights (entity TEXT NOT NULL, tag TEXT NOT NULL, tier INTEGER NOT NULL)')
}

function indexes(db: Database): void {
  db.run("CREATE VIRTUAL TABLE names_fts USING fts5(flat, content='names', content_rowid='rowid', tokenize='trigram')")
  db.run("INSERT INTO names_fts(names_fts) VALUES ('rebuild')")
  db.run('CREATE INDEX names_flat ON names (flat)')
  db.run('CREATE INDEX names_latin ON names (latin)')
  db.run('CREATE INDEX names_entity ON names (entity)')
  db.run('CREATE INDEX sounds_key ON sounds (key)')
  db.run('CREATE INDEX parts_part ON parts (part)')
  db.run('CREATE INDEX initials_key ON initials (key)')
  db.run('CREATE INDEX refs_ref ON refs (ref)')
  db.run('CREATE INDEX refs_entity ON refs (entity)')
  db.run('CREATE INDEX works_character ON works (character)')
  db.run('CREATE INDEX works_work ON works (work)')
  db.run('CREATE INDEX related_work ON related (work)')
  db.run('ANALYZE')
}

function licenses(sources: Source[]): Record<Layer, string[]> {
  const out: Record<Layer, string[]> = { core: [], kowiki: [], unlicensed: [] }
  for (const source of sources) out[source.layer].push(`${source.name}: ${source.license}`)
  return out
}

const ownTitles = (m: Staged) => m.entry.names.map((name) => flat(name.text))

const tagTitle = (ref: string) => flat(qualifiers(ref.slice(TAG.length).replace(/_/g, ' ')).base)

export function adultCharactersOf(
  entities: Iterable<{ id: string; kind: Kind; members: readonly { entry: Entry }[] }>,
  resolve: (work: string) => string | undefined,
  adult: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== 'character') continue
    const works = new Set(entity.members.flatMap((m) => (m.entry.works ?? []).flatMap((work) => resolve(work) ?? [])))
    if (works.size > 0 && [...works].every((work) => adult.has(work))) out.add(entity.id)
  }
  return out
}

export async function build(): Promise<void> {
  const started = performance.now()
  const { all: staged, sources } = await readAll()
  const copyrights = await readCopyrights()
  const { union, graph, entities, dropped } = resolveEntities(staged, copyrights)
  const { links, titles } = graph
  const { attached, missed, spread } = attachEntries(union, staged, entities, graph)
  const parents = parentsOf(union, entities)
  console.log(
    `build: ${entities.size} entities from Bangumi, ${dropped} entries of other sources reached none; ${attached} attach entries placed, ${missed} found no entity`,
  )
  const families = new Map<string, number | null>()
  for (const s of staged) if (s.entry.family) families.set(s.entry.id.slice(TAG.length), s.entry.rank ?? null)
  const homes = homesOf(union, entities, parents, links, families, spread, copyrights)
  console.log(`build: ${homes.size} characters have a home tag`)
  const byRoot = new Map<string, string>()
  for (const [root, entity] of entities) byRoot.set(root, entity.id)
  const resolve = (kind: Kind, ref: string): string | undefined => {
    const key = node(kind, ref)
    return union.has(key) ? byRoot.get(union.find(key)) : undefined
  }
  await mkdir(DIST, { recursive: true })
  const notes = licenses(sources)
  const adultWorks: Record<Layer, Set<string>> = { core: new Set(), kowiki: new Set(), unlicensed: new Set() }
  for (const entity of entities.values()) {
    if (entity.kind !== 'work') continue
    for (const m of entity.members) if (own(m) && m.entry.adult) adultWorks[m.layer].add(entity.id)
  }
  const adultCharacters = adultCharactersOf(
    [...entities.values()].map((entity) => ({ ...entity, members: entity.members.filter(own) })),
    (work) => resolve('work', work),
    new Set(LAYERS.flatMap((layer) => [...adultWorks[layer]])),
  )
  for (const layer of LAYERS) {
    const path = join(DIST, `${layer}.sqlite`)
    await rm(path, { force: true })
    const db = new Database(path, { create: true })
    schema(db)
    const insertEntity = db.prepare(
      'INSERT INTO entities (id, kind, medium, type, year, origin) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertRef = db.prepare('INSERT INTO refs (entity, ref, rank, tier, own) VALUES (?, ?, ?, ?, ?)')
    const insertName = db.prepare(
      'INSERT INTO names (entity, ekind, text, lang, kind, source, flat, latin, qual, variant, support, pref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid',
    )
    const insertSound = db.prepare('INSERT INTO sounds (name, entity, key) VALUES (?, ?, ?)')
    const insertPart = db.prepare('INSERT INTO parts (name, entity, part) VALUES (?, ?, ?)')
    const insertInitials = db.prepare('INSERT INTO initials (name, entity, key) VALUES (?, ?, ?)')
    const insertWork = db.prepare('INSERT INTO works (character, work) VALUES (?, ?)')
    const insertRelated = db.prepare('INSERT INTO related (work, other) VALUES (?, ?)')
    const insertRank = db.prepare('INSERT INTO ranks (entity, rank) VALUES (?, ?)')
    const insertAdult = db.prepare('INSERT INTO adults (entity) VALUES (?)')
    const insertHome = db.prepare('INSERT INTO homes (entity, tag, posts, tier) VALUES (?, ?, ?, ?)')
    const insertCopyright = db.prepare('INSERT INTO copyrights (entity, tag, tier) VALUES (?, ?, ?)')
    let nameCount = 0
    db.transaction(() => {
      for (const [root, entity] of entities) {
        if (entity.layer === layer) {
          const spine = entity.members.find(own)?.entry
          const dated = entity.members.find((m) => m.entry.year)?.entry
          const origin = [...new Set(entity.members.flatMap((m) => m.entry.origin ?? []))]
          insertEntity.run(
            entity.id,
            entity.kind,
            mediumOf(entity),
            spine?.type ?? null,
            spine?.year ?? dated?.year ?? null,
            origin.length > 0 ? origin.join(' ') : null,
          )
        }
        const refs = new Map<string, number | null>()
        const heads = new Set<string>()
        let best = 0
        const works = new Set<string>()
        const related = new Set<string>()
        for (const m of entity.members) {
          if (m.layer !== layer) continue
          refs.set(m.entry.id, Math.max(refs.get(m.entry.id) ?? 0, m.entry.rank ?? 0) || null)
          if (!m.below) heads.add(m.entry.id)
          for (const ref of m.entry.refs ?? []) {
            if (union.find(node(entity.kind, ref)) === root && !refs.has(ref)) refs.set(ref, null)
          }
          if (!own(m)) continue
          if (m.popularity > 0) best = Math.max(best, m.popularity)
          for (const work of m.entry.works ?? []) {
            const id = resolve('work', work)
            if (id) works.add(id)
          }
          for (const other of tiesOf(m.entry)) {
            const id = resolve('work', other)
            if (id && id !== entity.id) related.add(id)
          }
        }
        const titled = entity.kind === 'work' ? new Set(entity.members.filter(own).flatMap(ownTitles)) : undefined
        for (const [ref, rank] of refs) {
          const named = !titled || !ref.startsWith(TAG) || titled.has(tagTitle(ref))
          insertRef.run(entity.id, ref, rank, heads.has(ref) ? 0 : 1, named ? 1 : 0)
        }
        if (best > 0) insertRank.run(entity.id, best)
        for (const work of works) insertWork.run(entity.id, work)
        const flagged =
          entity.kind === 'work'
            ? adultWorks[layer].has(entity.id)
            : entity.layer === layer && adultCharacters.has(entity.id)
        if (flagged) insertAdult.run(entity.id)
        for (const other of related) {
          insertRelated.run(entity.id, other)
          insertRelated.run(other, entity.id)
        }
        const rows = namesOf(entity, layer, titles)
        const prefs = preferencesOf(entity, layer, rows, titles)
        for (const row of rows) {
          const inserted = insertName.get(
            row.entity,
            entity.kind,
            row.text,
            row.lang,
            row.kind,
            row.source,
            flat(row.text),
            latinKey(row.text),
            row.qual,
            row.variant ? 1 : 0,
            row.support,
            prefs.get(row) ?? null,
          ) as { rowid: number }
          nameCount++
          for (const key of soundKeys(qualifiers(row.text).base)) insertSound.run(inserted.rowid, row.entity, key)
          for (const part of partsOf(row.text)) insertPart.run(inserted.rowid, row.entity, part)
          const key = initials(qualifiers(row.text).base)
          if ([...key].length >= 2) insertInitials.run(inserted.rowid, row.entity, key)
        }
      }
      if (layer === SPINE) {
        for (const [id, home] of homes) {
          insertHome.run(id, home.tag, home.posts, home.tier)
          for (const { tag, tier } of home.also) insertCopyright.run(id, tag, tier)
        }
      }
      const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
      meta.run('layer', layer)
      meta.run('built', new Date().toISOString())
      meta.run('sources', notes[layer].join('\n'))
    })()
    indexes(db)
    db.close()
    const size = Bun.file(path).size
    console.log(`build: ${layer}.sqlite ${nameCount} names, ${(size / 1e6).toFixed(1)} MB`)
  }
  console.log(`build: done in ${((performance.now() - started) / 1000).toFixed(1)} s`)
}
