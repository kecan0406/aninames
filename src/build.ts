import { Database } from 'bun:sqlite'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type Entry,
  type Kind,
  LAYERS,
  type Layer,
  type Name,
  type NameKind,
  type Namespace,
  type Source,
} from './model.ts'
import { load, NAMES } from './sources/index.ts'
import { readStage, stagePath } from './stage.ts'
import {
  flat,
  hangulForms,
  hasKanji,
  initials,
  isKana,
  kanaToRomaji,
  latinKey,
  partKey,
  qualifiers,
  soundKeys,
} from './text.ts'

export const DIST = join(import.meta.dirname, '..', 'dist')

const STRENGTH: Namespace[] = [
  'wikidata',
  'mal',
  'anilist',
  'anidb',
  'vndb',
  'kitsu',
  'ann',
  'bangumi',
  'danbooru',
  'animeplanet',
  'anisearch',
  'livechart',
  'simkl',
  'animecountdown',
  'kowiki',
  'anissia',
]

const LAYER_ORDER: Record<Layer, number> = { core: 0, kowiki: 1, unlicensed: 2 }

export interface Staged {
  source: string
  layer: Layer
  entry: Entry
  popularity: number
}

export class Union {
  private parent = new Map<string, string>()
  private items = new Map<string, string>()
  refused = 0

  has(key: string): boolean {
    return this.parent.has(key)
  }

  add(key: string): void {
    if (this.parent.has(key)) return
    this.parent.set(key, key)
    if (key.includes('|wikidata:')) this.items.set(key, key)
  }

  anchored(key: string): boolean {
    return this.items.has(this.find(key))
  }

  find(key: string): string {
    let root = key
    for (let next = this.parent.get(root); next !== undefined && next !== root; next = this.parent.get(root)) {
      root = next
    }
    let walk = key
    while (walk !== root) {
      const next = this.parent.get(walk) ?? root
      this.parent.set(walk, root)
      walk = next
    }
    return root
  }

  union(a: string, b: string): boolean {
    this.add(a)
    this.add(b)
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return true
    const ia = this.items.get(ra)
    const ib = this.items.get(rb)
    if (ia && ib && ia !== ib) {
      this.refused++
      return false
    }
    this.parent.set(rb, ra)
    const item = ia ?? ib
    if (item) this.items.set(ra, item)
    return true
  }
}

export function node(kind: Kind, ref: string): string {
  return `${kind}|${ref}`
}

function strength(ref: string): number {
  const index = STRENGTH.indexOf(ref.slice(0, ref.indexOf(':')) as Namespace)
  return index < 0 ? STRENGTH.length : index
}

function strongest(refs: Iterable<string>): string {
  let best = ''
  for (const ref of refs) {
    if (!best || strength(ref) < strength(best) || (strength(ref) === strength(best) && ref < best)) best = ref
  }
  return best
}

function japanese(text: string): boolean {
  return hasKanji(text) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
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
        .filter((e) => e.kind === kind && e.rank !== undefined)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      const top = Math.log1p(ranked[Math.floor(0.99 * (ranked.length - 1))]?.rank ?? 0) || 1
      for (const e of ranked) {
        all.push({
          source: name,
          layer: source.layer,
          entry: e,
          popularity: Math.min(1, Math.log1p(Math.max(0, e.rank ?? 0)) / top),
        })
      }
    }
    for (const e of entries) {
      if (e.kind === undefined || e.rank === undefined)
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

function mergeKey(text: string, kind: Kind, medium: string): string | undefined {
  const base = qualifiers(text).base
  if (japanese(base)) {
    const key = flat(base)
    return [...key].length >= (kind === 'work' ? 4 : 3) ? `${medium}|${key}` : undefined
  }
  if (kind !== 'character' || !/^[\p{Script=Latin}\s.'’-]+$/u.test(base.normalize('NFKD').replace(/\p{M}/gu, '')))
    return undefined
  const tokens = latinKey(base)
    .split(' ')
    .filter((token) => token.length >= 2)
  return tokens.length >= 2 ? `latin|${tokens.join(' ')}` : undefined
}

function nameIndex(staged: Staged[], kind: Kind): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== kind) continue
    const self = node(kind, s.entry.id)
    const medium = kind === 'work' ? mediaOf(s)[0] : ''
    if (medium === undefined) continue
    for (const name of s.entry.names) {
      if (name.kind === 'reading' || name.kind === 'short') continue
      const key = mergeKey(name.text, kind, medium)
      if (!key) continue
      let bySource = index.get(key)
      if (!bySource) {
        bySource = new Map()
        index.set(key, bySource)
      }
      let nodes = bySource.get(s.source)
      if (!nodes) {
        nodes = new Set()
        bySource.set(s.source, nodes)
      }
      nodes.add(self)
    }
  }
  return index
}

function yearsApart(a: Set<number> | undefined, b: Set<number> | undefined): boolean {
  if (!a?.size || !b?.size) return false
  return ![...a].some((x) => [...b].some((y) => Math.abs(x - y) <= 1))
}

function mergeByName(union: Union, staged: Staged[], kind: Kind): number {
  const sources = new Map<string, Set<string>>()
  const years = new Map<string, Set<number>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== kind) continue
    const root = union.find(node(kind, s.entry.id))
    let set = sources.get(root)
    if (!set) {
      set = new Set()
      sources.set(root, set)
    }
    set.add(s.source)
    if (s.entry.year) {
      let found = years.get(root)
      if (!found) {
        found = new Set()
        years.set(root, found)
      }
      found.add(s.entry.year)
    }
  }
  let merged = 0
  for (const bySource of nameIndex(staged, kind).values()) {
    if (bySource.size < 2) continue
    const groups = [...bySource.values()].map((nodes) => new Set([...nodes].map((n) => union.find(n))))
    const all = [...new Set(groups.flatMap((roots) => [...roots]))]
    let anchor = all[0]
    if (groups.some((roots) => roots.size !== 1)) {
      const anchored = all.filter((root) => union.anchored(root))
      if (anchored.length !== 1) continue
      anchor = anchored[0]
    }
    if (anchor === undefined) continue
    for (const roots of groups) {
      if (roots.size !== 1) continue
      const a = union.find(anchor)
      const b = union.find([...roots][0] ?? '')
      if (a === b) continue
      const sa = sources.get(a) ?? new Set<string>()
      const sb = sources.get(b) ?? new Set<string>()
      if ([...sa].some((source) => sb.has(source))) continue
      if (kind === 'work' && yearsApart(years.get(a), years.get(b))) continue
      if (!union.union(a, b)) continue
      const root = union.find(a)
      sources.set(root, new Set([...sa, ...sb]))
      years.set(root, new Set([...(years.get(a) ?? []), ...(years.get(b) ?? [])]))
      merged++
    }
  }
  return merged
}

interface Holder {
  node: string
  source: string
  strong: boolean
}

interface CharacterKey {
  key: string
  loose: boolean
}

function characterKey(text: string): CharacterKey | undefined {
  const base = qualifiers(text).base
  if (japanese(base)) {
    const key = flat(base)
    const length = [...key].length
    return length >= 2 ? { key: `ja|${key}`, loose: length < 3 } : undefined
  }
  if (!/^[\p{Script=Latin}\s.'’-]+$/u.test(base.normalize('NFKD').replace(/\p{M}/gu, ''))) return undefined
  const tokens = latinKey(base)
    .split(' ')
    .filter((token) => token.length >= 2)
  if (tokens.length === 0 || tokens.join('').length < 3) return undefined
  return { key: `latin|${tokens.join(' ')}`, loose: tokens.length < 2 }
}

function workTitles(union: Union, staged: Staged[]): Map<string, Set<string>> {
  const titles = new Map<string, Set<string>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== 'work') continue
    const root = union.find(node('work', s.entry.id))
    for (const name of s.entry.names) {
      if (japanese(name.text)) continue
      const key = latinKey(name.text)
      if (key.length < 3) continue
      const roots = titles.get(key) ?? new Set<string>()
      roots.add(root)
      titles.set(key, roots)
    }
  }
  return titles
}

function mergeCharacters(union: Union, staged: Staged[]): number {
  const titles = workTitles(union, staged)
  const works = new Map<string, Set<string>>()
  const sources = new Map<string, Set<string>>()
  const index = new Map<string, { loose: boolean; holders: Holder[] }>()
  const add = <T>(map: Map<string, Set<T>>, key: string, value: T) => {
    const set = map.get(key) ?? new Set<T>()
    set.add(value)
    map.set(key, set)
  }
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || entry.kind !== 'character') continue
    const self = node('character', entry.id)
    const root = union.find(self)
    add(sources, root, s.source)
    for (const work of entry.works ?? []) {
      const key = node('work', work)
      if (union.has(key)) add(works, root, union.find(key))
    }
    let quals: string[] = []
    if (s.source === 'danbooru') {
      quals = qualifiers(entry.id.slice('danbooru:'.length).replace(/_/g, ' ')).quals
      if (quals.length > 1) continue
      for (const qual of quals) {
        const roots = titles.get(latinKey(qual))
        if (roots && roots.size <= 3) for (const work of roots) add(works, root, work)
      }
    }
    const strongest = new Map<string, CharacterKey & { strong: boolean }>()
    for (const name of entry.names) {
      if (name.kind === 'reading' || name.kind === 'short') continue
      const found = characterKey(name.text)
      if (!found) continue
      const chinese = name.lang?.startsWith('zh') ?? false
      const strong =
        !chinese &&
        (name.kind === 'main' || name.kind === 'official' || (s.source === 'danbooru' && japanese(name.text)))
      const known = strongest.get(found.key)
      if (!known || (strong && !known.strong)) strongest.set(found.key, { ...found, strong })
    }
    for (const found of strongest.values()) {
      const group = index.get(found.key) ?? { loose: found.loose, holders: [] }
      group.holders.push({ node: self, source: s.source, strong: found.strong })
      index.set(found.key, group)
    }
  }
  const worksOf = (root: string) => works.get(root) ?? new Set<string>()
  const shares = (a: string, b: string) => {
    const wa = worksOf(a)
    const wb = worksOf(b)
    if (wa.size === 0 || wb.size === 0) return 'unknown'
    for (const work of wa) if (wb.has(work)) return 'yes'
    return 'disjoint'
  }
  const edges: { a: string; b: string; weight: number }[] = []
  for (const { loose, holders } of index.values()) {
    if (holders.length > 60 || new Set(holders.map((h) => h.source)).size < 2) continue
    const rootsBySource = new Map<string, Set<string>>()
    for (const holder of holders) add(rootsBySource, holder.source, union.find(holder.node))
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const x = holders[i] as Holder
        const y = holders[j] as Holder
        if (x.source === y.source) continue
        const a = union.find(x.node)
        const b = union.find(y.node)
        if (a === b) continue
        const verdict = shares(a, b)
        if (verdict === 'yes') {
          const rivalsOfB = [...(rootsBySource.get(x.source) ?? [])].filter(
            (r) => r !== a && shares(r, b) !== 'disjoint',
          )
          const rivalsOfA = [...(rootsBySource.get(y.source) ?? [])].filter(
            (r) => r !== b && shares(r, a) !== 'disjoint',
          )
          if (rivalsOfA.length === 0 && rivalsOfB.length === 0) edges.push({ a, b, weight: 2 })
          continue
        }
        if (loose || (!x.strong && !y.strong)) continue
        if ((rootsBySource.get(x.source)?.size ?? 0) !== 1 || (rootsBySource.get(y.source)?.size ?? 0) !== 1) continue
        edges.push({ a, b, weight: 1 })
      }
    }
  }
  edges.sort((p, q) => q.weight - p.weight)
  let merged = 0
  for (const edge of edges) {
    const a = union.find(edge.a)
    const b = union.find(edge.b)
    if (a === b) continue
    const sa = sources.get(a) ?? new Set<string>()
    const sb = sources.get(b) ?? new Set<string>()
    if ([...sa].some((source) => sb.has(source))) continue
    if (!union.union(a, b)) continue
    const root = union.find(a)
    sources.set(root, new Set([...sa, ...sb]))
    works.set(root, new Set([...worksOf(a), ...worksOf(b)]))
    merged++
  }
  return merged
}

export function link(staged: Staged[], hide = false): Union {
  const union = new Union()
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || !entry.kind) continue
    const self = node(entry.kind, entry.id)
    union.add(self)
    const own = `${entry.id.slice(0, entry.id.indexOf(':'))}:`
    for (const ref of entry.refs ?? []) {
      if (hide && entry.kind === 'character' && !ref.startsWith(own)) continue
      union.union(self, node(entry.kind, ref))
    }
  }
  console.log(`build: refused ${union.refused} unions that would join two Wikidata items`)
  const works = mergeByName(union, staged, 'work')
  console.log(`build: merged ${works} work pairs by a Japanese title unique in each source and medium`)
  const merged = mergeCharacters(union, staged)
  console.log(`build: merged ${merged} character pairs by name`)
  return union
}

function resolveEntities(staged: Staged[]): { union: Union; entities: Map<string, Entity> } {
  const union = link(staged)
  const entities = new Map<string, Entity>()
  const refsByRoot = new Map<string, Set<string>>()
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || !entry.kind) continue
    const root = union.find(node(entry.kind, entry.id))
    let entity = entities.get(root)
    if (!entity) {
      entity = { id: '', kind: entry.kind, layer: s.layer, members: [] }
      entities.set(root, entity)
      refsByRoot.set(root, new Set())
    }
    entity.members.push(s)
    if (LAYER_ORDER[s.layer] < LAYER_ORDER[entity.layer]) entity.layer = s.layer
    const refs = refsByRoot.get(root)
    refs?.add(entry.id)
    for (const ref of entry.refs ?? []) if (union.find(node(entry.kind, ref)) === root) refs?.add(ref)
  }
  for (const [root, entity] of entities) {
    const coreRefs = new Set<string>()
    for (const m of entity.members) {
      if (m.layer !== entity.layer) continue
      coreRefs.add(m.entry.id)
      for (const ref of m.entry.refs ?? []) if (union.find(node(entity.kind, ref)) === root) coreRefs.add(ref)
    }
    entity.id = `${entity.kind === 'work' ? 'w' : 'c'}/${strongest(coreRefs.size > 0 ? coreRefs : (refsByRoot.get(root) ?? []))}`
  }
  return { union, entities }
}

function attachEntries(
  union: Union,
  staged: Staged[],
  entities: Map<string, Entity>,
): { attached: number; missed: number } {
  const workNames = new Map<string, Set<string>>()
  for (const [root, entity] of entities) {
    if (entity.kind !== 'work') continue
    for (const m of entity.members) {
      for (const name of m.entry.names) {
        if (!japanese(name.text)) continue
        const key = flat(name.text)
        if (!key) continue
        let roots = workNames.get(key)
        if (!roots) {
          roots = new Set()
          workNames.set(key, roots)
        }
        roots.add(root)
      }
    }
  }
  const characterNames = new Map<string, Set<string>>()
  const characterWorks = new Map<string, Set<string>>()
  const neighbours = new Map<string, Set<string>>()
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
      if (entity.kind === 'work') {
        for (const other of m.entry.related ?? []) {
          const there = workRoot(other)
          if (there && there !== root) {
            remember(neighbours, root, there)
            remember(neighbours, there, root)
          }
        }
        continue
      }
      for (const work of m.entry.works ?? []) {
        const there = workRoot(work)
        if (there) remember(characterWorks, root, there)
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
      for (const text of entry.link) for (const root of workNames.get(flat(text)) ?? []) roots.add(root)
      if (roots.size <= 3)
        for (const root of roots) {
          const found = entities.get(root)
          if (found) targets.push(found)
        }
    }
    for (const found of targets) found.members.push(s)
    if (targets.length > 0) attached++
    else missed++
  }
  return { attached, missed }
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

function namesOf(entity: Entity, layer: Layer, titles: Map<string, Set<string>>): Row[] {
  const rows: Row[] = []
  const seen = new Set<string>()
  const push = (name: Name, source: string, qual: string | null, unlikely = false) => {
    const text = name.text.normalize('NFC').trim()
    if (!text) return
    const key = `${text}\u0000${name.lang ?? ''}\u0000${name.kind}`
    if (seen.has(key)) return
    seen.add(key)
    const variant = unlikely || (qual !== null && !titles.has(latinKey(qual)))
    rows.push({ entity: entity.id, text, lang: name.lang ?? null, kind: name.kind, source, qual, variant, support: 0 })
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

const ANIME_TYPES = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'UNKNOWN'])

const MEDIUM_ORDER = ['anime', 'vn', 'game', 'manga', 'novel'] as const

type Medium = (typeof MEDIUM_ORDER)[number]

function mediaOf(staged: Staged): Medium[] {
  const { entry, source } = staged
  const out: Medium[] = []
  if (source === 'aod' || source === 'anidb' || source === 'anissia') out.push('anime')
  if (source === 'vndb' && entry.id.startsWith('vndb:v')) out.push('vn')
  if (source === 'bangumi') {
    if (entry.type === 'GAME') out.push('game')
    else if (entry.type === 'MANGA') out.push('manga')
    else if (entry.type === 'LIGHT_NOVEL') out.push('novel')
    else if (entry.type && ANIME_TYPES.has(entry.type)) out.push('anime')
  }
  for (const ref of [entry.id, ...(entry.refs ?? [])]) {
    const [ns = '', id = ''] = ref.split(/:(.*)/s)
    if (id.startsWith('manga/')) out.push('manga')
    else if (['mal', 'anilist', 'anidb', 'kitsu', 'ann'].includes(ns)) out.push('anime')
    else if (ns === 'vndb' && id.startsWith('v')) out.push('vn')
  }
  return out
}

function mediumOf(entity: Entity): Medium | null {
  if (entity.kind !== 'work') return null
  const found = new Set(entity.members.filter((m) => !m.entry.attach && m.layer === entity.layer).flatMap(mediaOf))
  return MEDIUM_ORDER.find((medium) => found.has(medium)) ?? null
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
  db.run('CREATE TABLE entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, medium TEXT, type TEXT, year INTEGER)')
  db.run('CREATE TABLE refs (entity TEXT NOT NULL, ref TEXT NOT NULL, rank REAL)')
  db.run(
    'CREATE TABLE names (rowid INTEGER PRIMARY KEY, entity TEXT NOT NULL, ekind TEXT NOT NULL, text TEXT NOT NULL, lang TEXT, kind TEXT NOT NULL, source TEXT NOT NULL, flat TEXT NOT NULL, latin TEXT NOT NULL, qual TEXT, variant INTEGER NOT NULL, support INTEGER NOT NULL)',
  )
  db.run('CREATE TABLE sounds (name INTEGER NOT NULL, entity TEXT NOT NULL, key TEXT NOT NULL)')
  db.run('CREATE TABLE parts (name INTEGER NOT NULL, entity TEXT NOT NULL, part TEXT NOT NULL)')
  db.run('CREATE TABLE initials (name INTEGER NOT NULL, entity TEXT NOT NULL, key TEXT NOT NULL)')
  db.run('CREATE TABLE works (character TEXT NOT NULL, work TEXT NOT NULL)')
  db.run('CREATE TABLE related (work TEXT NOT NULL, other TEXT NOT NULL)')
  db.run('CREATE TABLE ranks (entity TEXT PRIMARY KEY, rank REAL NOT NULL, weight INTEGER NOT NULL)')
  db.run('CREATE TABLE adults (entity TEXT PRIMARY KEY)')
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

export async function build(): Promise<void> {
  const started = performance.now()
  const { all: staged, sources } = await readAll()
  const { union, entities } = resolveEntities(staged)
  const titles = workTitles(union, staged)
  const { attached, missed } = attachEntries(union, staged, entities)
  console.log(`build: ${entities.size} entities, ${attached} attach entries placed, ${missed} found no entity`)
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
    for (const m of entity.members) if (m.entry.adult) adultWorks[m.layer].add(entity.id)
  }
  for (const layer of LAYERS) {
    const path = join(DIST, `${layer}.sqlite`)
    await rm(path, { force: true })
    const db = new Database(path, { create: true })
    schema(db)
    const insertEntity = db.prepare('INSERT INTO entities (id, kind, medium, type, year) VALUES (?, ?, ?, ?, ?)')
    const insertRef = db.prepare('INSERT INTO refs (entity, ref, rank) VALUES (?, ?, ?)')
    const insertName = db.prepare(
      'INSERT INTO names (entity, ekind, text, lang, kind, source, flat, latin, qual, variant, support) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid',
    )
    const insertSound = db.prepare('INSERT INTO sounds (name, entity, key) VALUES (?, ?, ?)')
    const insertPart = db.prepare('INSERT INTO parts (name, entity, part) VALUES (?, ?, ?)')
    const insertInitials = db.prepare('INSERT INTO initials (name, entity, key) VALUES (?, ?, ?)')
    const insertWork = db.prepare('INSERT INTO works (character, work) VALUES (?, ?)')
    const insertRelated = db.prepare('INSERT INTO related (work, other) VALUES (?, ?)')
    const insertRank = db.prepare('INSERT INTO ranks (entity, rank, weight) VALUES (?, ?, ?)')
    const insertAdult = db.prepare('INSERT INTO adults (entity) VALUES (?)')
    let nameCount = 0
    db.transaction(() => {
      for (const [root, entity] of entities) {
        if (entity.layer === layer) {
          const first = entity.members.find((m) => m.layer === layer && !m.entry.attach)?.entry
          const typed = entity.members.find((m) => m.entry.type)?.entry
          const dated = entity.members.find((m) => m.entry.year)?.entry
          insertEntity.run(
            entity.id,
            entity.kind,
            mediumOf(entity),
            typed?.type ?? first?.type ?? null,
            dated?.year ?? null,
          )
        }
        const refs = new Map<string, number | null>()
        const scores = new Map<string, number>()
        const works = new Set<string>()
        const related = new Set<string>()
        for (const m of entity.members) {
          if (m.layer !== layer) continue
          refs.set(m.entry.id, Math.max(refs.get(m.entry.id) ?? 0, m.entry.rank ?? 0) || null)
          for (const ref of m.entry.refs ?? []) {
            if (union.find(node(entity.kind, ref)) === root && !refs.has(ref)) refs.set(ref, null)
          }
          if (m.entry.rank !== undefined) {
            const best = scores.get(m.source) ?? 0
            scores.set(m.source, Math.max(best, m.popularity))
          }
          for (const work of m.entry.works ?? []) {
            const id = resolve('work', work)
            if (id) works.add(id)
          }
          for (const other of m.entry.related ?? []) {
            const id = resolve('work', other)
            if (id && id !== entity.id) related.add(id)
          }
        }
        for (const [ref, rank] of refs) insertRef.run(entity.id, ref, rank)
        if (scores.size > 0) {
          const values = [...scores.values()]
          insertRank.run(entity.id, values.reduce((sum, value) => sum + value, 0) / values.length, values.length)
        }
        for (const work of works) insertWork.run(entity.id, work)
        const flagged =
          entity.kind === 'work'
            ? adultWorks[layer].has(entity.id)
            : works.size > 0 && [...works].every((work) => adultWorks[layer].has(work))
        if (flagged) insertAdult.run(entity.id)
        for (const other of related) {
          insertRelated.run(entity.id, other)
          insertRelated.run(other, entity.id)
        }
        for (const row of namesOf(entity, layer, titles)) {
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
          ) as { rowid: number }
          nameCount++
          for (const key of soundKeys(qualifiers(row.text).base)) insertSound.run(inserted.rowid, row.entity, key)
          for (const part of partsOf(row.text)) insertPart.run(inserted.rowid, row.entity, part)
          const key = initials(qualifiers(row.text).base)
          if ([...key].length >= 2) insertInitials.run(inserted.rowid, row.entity, key)
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
