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
import { flat, hangulVariants, hasKanji, isKana, kanaToRomaji, latinKey, qualifiers, soundKeys } from './text.ts'

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

interface Staged {
  source: string
  layer: Layer
  entry: Entry
  percentile: number
}

class Union {
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

function node(kind: Kind, ref: string): string {
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

async function readAll(): Promise<{ all: Staged[]; sources: Source[] }> {
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
      ranked.forEach((e, i) => {
        all.push({
          source: name,
          layer: source.layer,
          entry: e,
          percentile: ranked.length > 1 ? i / (ranked.length - 1) : 1,
        })
      })
    }
    for (const e of entries) {
      if (e.kind === undefined || e.rank === undefined)
        all.push({ source: name, layer: source.layer, entry: e, percentile: 0 })
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

function nameIndex(staged: Staged[], kind: Kind): Map<string, Map<string, Set<string>>> {
  const index = new Map<string, Map<string, Set<string>>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== kind) continue
    const self = node(kind, s.entry.id)
    const medium = kind === 'work' ? mediaOf(s)[0] : ''
    if (medium === undefined) continue
    for (const name of s.entry.names) {
      if (name.kind === 'reading' || name.kind === 'short' || !japanese(name.text)) continue
      const base = flat(qualifiers(name.text).base)
      if ([...base].length < (kind === 'work' ? 4 : 3)) continue
      const key = `${medium}|${base}`
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
    const picks: string[] = []
    for (const nodes of bySource.values()) {
      const roots = new Set([...nodes].map((n) => union.find(n)))
      if (roots.size !== 1) break
      picks.push([...roots][0] ?? '')
    }
    if (picks.length !== bySource.size) continue
    for (const pick of picks.slice(1)) {
      const a = union.find(picks[0] ?? '')
      const b = union.find(pick)
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

function resolveEntities(staged: Staged[]): { union: Union; entities: Map<string, Entity> } {
  const union = new Union()
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || !entry.kind) continue
    const self = node(entry.kind, entry.id)
    union.add(self)
    for (const ref of entry.refs ?? []) union.union(self, node(entry.kind, ref))
  }
  console.log(`build: refused ${union.refused} unions that would join two Wikidata items`)
  const works = mergeByName(union, staged, 'work')
  console.log(`build: merged ${works} work pairs by a Japanese title unique in each source and medium`)
  const merged = mergeByName(union, staged, 'character')
  console.log(`build: merged ${merged} character pairs by a Japanese name unique in each source`)
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
  let attached = 0
  let missed = 0
  for (const s of staged) {
    const { entry } = s
    if (!entry.attach) continue
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
    if (!target && entry.link?.length && kinds.includes('work')) {
      const roots = new Set<string>()
      for (const text of entry.link) for (const root of workNames.get(flat(text)) ?? []) roots.add(root)
      if (roots.size === 1) target = entities.get([...roots][0] ?? '')
    }
    if (target) {
      target.members.push(s)
      attached++
    } else {
      missed++
    }
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
}

function namesOf(entity: Entity, layer: Layer): Row[] {
  const rows: Row[] = []
  const seen = new Set<string>()
  const push = (name: Name, source: string, qual: string | null) => {
    const text = name.text.normalize('NFC').trim()
    if (!text) return
    const key = `${text}\u0000${name.lang ?? ''}\u0000${name.kind}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ entity: entity.id, text, lang: name.lang ?? null, kind: name.kind, source, qual })
  }
  for (const m of entity.members) {
    if (m.layer !== layer) continue
    for (const name of m.entry.names) {
      push(name, m.source, null)
      const { base, quals } = qualifiers(name.text)
      if (quals.length > 0 && base) push({ ...name, text: base }, m.source, quals.join(' '))
      if ((name.kind === 'reading' || name.lang === 'ja' || name.lang === undefined) && isKana(name.text)) {
        for (const ko of hangulVariants(name.text)) push({ text: ko, lang: 'ko', kind: 'generated' }, m.source, null)
        const romaji = kanaToRomaji(name.text)
        if (romaji) push({ text: romaji, lang: 'ja-Latn', kind: 'generated' }, m.source, null)
      }
    }
  }
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
    .map(flat)
    .filter((token) => [...token].length >= 2)
  return tokens.length >= 2 ? [...new Set(tokens)] : []
}

function schema(db: Database): void {
  db.run('PRAGMA journal_mode = OFF')
  db.run('PRAGMA synchronous = OFF')
  db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.run('CREATE TABLE entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, medium TEXT, type TEXT, year INTEGER)')
  db.run('CREATE TABLE refs (entity TEXT NOT NULL, ref TEXT NOT NULL)')
  db.run(
    'CREATE TABLE names (rowid INTEGER PRIMARY KEY, entity TEXT NOT NULL, ekind TEXT NOT NULL, text TEXT NOT NULL, lang TEXT, kind TEXT NOT NULL, source TEXT NOT NULL, flat TEXT NOT NULL, latin TEXT NOT NULL, qual TEXT)',
  )
  db.run('CREATE TABLE sounds (name INTEGER NOT NULL, entity TEXT NOT NULL, key TEXT NOT NULL)')
  db.run('CREATE TABLE parts (name INTEGER NOT NULL, entity TEXT NOT NULL, part TEXT NOT NULL)')
  db.run('CREATE TABLE works (character TEXT NOT NULL, work TEXT NOT NULL)')
  db.run('CREATE TABLE related (work TEXT NOT NULL, other TEXT NOT NULL)')
  db.run('CREATE TABLE ranks (entity TEXT PRIMARY KEY, rank REAL NOT NULL)')
}

function indexes(db: Database): void {
  db.run("CREATE VIRTUAL TABLE names_fts USING fts5(flat, content='names', content_rowid='rowid', tokenize='trigram')")
  db.run("INSERT INTO names_fts(names_fts) VALUES ('rebuild')")
  db.run('CREATE INDEX names_flat ON names (flat)')
  db.run('CREATE INDEX names_latin ON names (latin)')
  db.run('CREATE INDEX names_entity ON names (entity)')
  db.run('CREATE INDEX sounds_key ON sounds (key)')
  db.run('CREATE INDEX parts_part ON parts (part)')
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
  for (const layer of LAYERS) {
    const path = join(DIST, `${layer}.sqlite`)
    await rm(path, { force: true })
    const db = new Database(path, { create: true })
    schema(db)
    const insertEntity = db.prepare('INSERT INTO entities (id, kind, medium, type, year) VALUES (?, ?, ?, ?, ?)')
    const insertRef = db.prepare('INSERT INTO refs (entity, ref) VALUES (?, ?)')
    const insertName = db.prepare(
      'INSERT INTO names (entity, ekind, text, lang, kind, source, flat, latin, qual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid',
    )
    const insertSound = db.prepare('INSERT INTO sounds (name, entity, key) VALUES (?, ?, ?)')
    const insertPart = db.prepare('INSERT INTO parts (name, entity, part) VALUES (?, ?, ?)')
    const insertWork = db.prepare('INSERT INTO works (character, work) VALUES (?, ?)')
    const insertRelated = db.prepare('INSERT INTO related (work, other) VALUES (?, ?)')
    const insertRank = db.prepare('INSERT INTO ranks (entity, rank) VALUES (?, ?)')
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
        const refs = new Set<string>()
        let rank = -1
        const works = new Set<string>()
        const related = new Set<string>()
        for (const m of entity.members) {
          if (m.layer !== layer) continue
          refs.add(m.entry.id)
          for (const ref of m.entry.refs ?? []) if (union.find(node(entity.kind, ref)) === root) refs.add(ref)
          if (m.entry.rank !== undefined) rank = Math.max(rank, m.percentile)
          for (const work of m.entry.works ?? []) {
            const id = resolve('work', work)
            if (id) works.add(id)
          }
          for (const other of m.entry.related ?? []) {
            const id = resolve('work', other)
            if (id && id !== entity.id) related.add(id)
          }
        }
        for (const ref of refs) insertRef.run(entity.id, ref)
        if (rank >= 0) insertRank.run(entity.id, rank)
        for (const work of works) insertWork.run(entity.id, work)
        for (const other of related) {
          insertRelated.run(entity.id, other)
          insertRelated.run(other, entity.id)
        }
        for (const row of namesOf(entity, layer)) {
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
          ) as { rowid: number }
          nameCount++
          for (const key of soundKeys(qualifiers(row.text).base)) insertSound.run(inserted.rowid, row.entity, key)
          for (const part of partsOf(row.text)) insertPart.run(inserted.rowid, row.entity, part)
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
