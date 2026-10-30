import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  ADULT,
  CHARACTER,
  FORMAT,
  HASH_LENGTH,
  KEY_TABLES,
  type KeyTable,
  MAIN,
  NAME_KINDS,
  type Packed,
  pack,
  present,
  shared,
  type Table,
  TRUSTED,
} from './client/format.ts'
import { compare } from './client/order.ts'
import { weightOf } from './match.ts'
import { LAYERS, type Layer, type NameKind } from './model.ts'
import { licenses, notice, TERMS } from './pack.ts'

export const DOMAIN = 'names.ttheme.dev'

export function bound(before: string | undefined, key: string): string {
  if (before === undefined) return ''
  if (compare(before, key) >= 0) return key
  const at = shared(before, key)
  return key.slice(0, at + ((key.codePointAt(at) ?? 0) > 0xffff ? 2 : 1))
}

export class Writer {
  readonly keys: string[] = []
  readonly hashes: string[] = []
  readonly eids: number[] = []
  raw = 0
  gz = 0
  private readonly dir: string
  private readonly target: number
  private rows: string[] = []
  private size = 0
  private first: [string, number] = ['', 0]
  private last: string | undefined

  constructor(dir: string, target: number) {
    this.dir = dir
    this.target = target
    mkdirSync(dir, { recursive: true })
  }

  add(row: unknown[], key: string, eid = 0): void {
    const text = JSON.stringify(row)
    if (this.rows.length > 0 && this.size + text.length + 1 > this.target) this.flush()
    if (this.rows.length === 0) this.first = [bound(this.last, key), eid]
    this.last = key
    this.rows.push(text)
    this.size += text.length + 1
  }

  flush(): void {
    if (this.rows.length === 0) return
    const text = `[${this.rows.join(',')}]`
    const gz = gzipSync(text, { level: 9 })
    const hash = createHash('sha256').update(gz).digest('hex').slice(0, HASH_LENGTH)
    writeFileSync(join(this.dir, `${hash}.json.gz`), gz)
    this.keys.push(this.first[0])
    this.eids.push(this.first[1])
    this.hashes.push(hash)
    this.raw += Buffer.byteLength(text)
    this.gz += gz.length
    this.rows = []
    this.size = 0
  }

  packed(numbered: boolean): Packed {
    return pack(this.keys, this.hashes, numbered ? this.eids : undefined)
  }
}

type Numbering = Map<string, number>

const IDS = 'SELECT entity AS id FROM names UNION SELECT id FROM entities UNION SELECT entity FROM refs'

function numbering(dbs: Map<Layer, Database>): { eid: Numbering; masks: Uint8Array } {
  const seen = new Map<string, number>()
  for (const [layer, db] of dbs) {
    for (const { id } of db.query<{ id: string }, []>(IDS).iterate()) {
      if (!id.startsWith('w/') && !id.startsWith('c/')) throw new Error(`aninames: entity ${id} is neither w/ nor c/`)
      seen.set(id, (seen.get(id) ?? 0) | present(layer))
    }
  }
  const ids = [...seen.keys()].sort(compare)
  const masks = new Uint8Array(ids.length)
  ids.forEach((id, at) => {
    masks[at] = seen.get(id) ?? 0
  })
  return { eid: new Map(ids.map((id, at) => [id, at])), masks }
}

interface Scores {
  rank: Int32Array
  standing: Int32Array
  extra: Int8Array
  adult: Uint8Array
  related: Map<Layer, Map<number, number[]>>
}

function scores(dbs: Map<Layer, Database>, eid: Numbering): Scores {
  const n = eid.size
  const sum = new Float64Array(n)
  const weight = new Float64Array(n)
  const prior = new Int8Array(n)
  const known = new Uint8Array(n)
  const adult = new Uint8Array(n)
  const spaces = new Uint32Array(n)
  const bits = new Map<string, number>()
  const all = new Map<number, Set<number>>()
  const related = new Map<Layer, Map<number, number[]>>()
  for (const [layer, db] of dbs) {
    for (const row of db
      .query<{ entity: string; rank: number; weight: number }, []>('SELECT entity, rank, weight FROM ranks')
      .iterate()) {
      const at = eid.get(row.entity)
      if (at === undefined) continue
      sum[at] = (sum[at] ?? 0) + row.rank * row.weight
      weight[at] = (weight[at] ?? 0) + row.weight
    }
    for (const row of db
      .query<{ id: string; kind: string; medium: string | null; type: string | null }, []>(
        'SELECT id, kind, medium, type FROM entities',
      )
      .iterate()) {
      const at = eid.get(row.id)
      if (at === undefined || known[at]) continue
      known[at] = 1
      if (row.kind === 'work') prior[at] = (row.medium === 'anime' ? 6 : 0) + (row.type === 'TV' ? 2 : 0)
    }
    for (const row of db.query<{ entity: string }, []>('SELECT entity FROM adults').iterate()) {
      const at = eid.get(row.entity)
      if (at !== undefined) adult[at] = 1
    }
    for (const row of db
      .query<{ entity: string; space: string }, []>(
        "SELECT DISTINCT entity, substr(ref, 1, instr(ref, ':') - 1) AS space FROM refs",
      )
      .iterate()) {
      const at = eid.get(row.entity)
      if (at === undefined) continue
      let bit = bits.get(row.space)
      if (bit === undefined) {
        bit = bits.size
        if (bit >= 32) throw new Error('aninames: more than 32 ref namespaces')
        bits.set(row.space, bit)
      }
      spaces[at] = (spaces[at] ?? 0) | (1 << bit)
    }
    const own = new Map<number, number[]>()
    for (const row of db.query<{ work: string; other: string }, []>('SELECT work, other FROM related').iterate()) {
      const from = eid.get(row.work)
      const to = eid.get(row.other)
      if (from === undefined || to === undefined) continue
      const list = own.get(from)
      if (list) list.push(to)
      else own.set(from, [to])
      all.set(from, (all.get(from) ?? new Set()).add(to))
    }
    related.set(layer, own)
  }
  const rankOf = (at: number) => ((weight[at] ?? 0) > 0 ? (sum[at] ?? 0) / (weight[at] ?? 1) : 0)
  const out: Scores = {
    rank: new Int32Array(n),
    standing: new Int32Array(n),
    extra: new Int8Array(n),
    adult,
    related,
  }
  for (const [id, at] of eid) {
    const rank = rankOf(at)
    let standing = rank
    const work = id.startsWith('w/')
    if (work) {
      let family = 0
      for (const other of reachOf(all, at)) family = Math.max(family, rankOf(other))
      standing = Math.max(standing, 0.9 * family)
    }
    let count = 0
    for (let mask = spaces[at] ?? 0; mask; mask &= mask - 1) count++
    out.rank[at] = Math.round(rank * 1000)
    out.standing[at] = Math.round(standing * 1000)
    out.extra[at] = work ? (prior[at] ?? 0) : Math.min(10, 2 * Math.max(0, count - 1))
  }
  return out
}

function reachOf(links: Map<number, Iterable<number>>, at: number): number[] {
  const found: number[] = []
  const seen = new Set([at])
  let frontier = [at]
  for (let hop = 1; hop <= 2; hop++) {
    const next: number[] = []
    for (const from of frontier) {
      for (const other of links.get(from) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
        found.push(other)
      }
    }
    frontier = next
  }
  return found
}

interface Context {
  eid: Numbering
  masks: Uint8Array
  score: Scores
  out: string
  target: number
}

interface KeySource {
  key: string
  entity: string
  ekind: string
  kind: NameKind
  variant: number
  support: number
}

const NAME_COLUMNS = 'n.entity AS entity, n.ekind AS ekind, n.kind AS kind, n.variant AS variant, n.support AS support'

const KEY_SQL: Record<KeyTable, string> = {
  flat: `SELECT n.flat AS key, ${NAME_COLUMNS} FROM names n ORDER BY key, entity, n.rowid`,
  latin: `SELECT n.latin AS key, ${NAME_COLUMNS} FROM names n WHERE n.latin GLOB '*[a-z]*' ORDER BY key, entity, n.rowid`,
  sound: `SELECT s.key AS key, ${NAME_COLUMNS} FROM sounds s JOIN names n ON n.rowid = s.name ORDER BY key, entity, n.rowid`,
  part: `SELECT p.part AS key, ${NAME_COLUMNS} FROM parts p JOIN names n ON n.rowid = p.name ORDER BY key, entity, n.rowid`,
  initial: `SELECT i.key AS key, ${NAME_COLUMNS} FROM initials i JOIN names n ON n.rowid = i.name ORDER BY key, entity, n.rowid`,
}

function keyTable(db: Database, layer: Layer, table: KeyTable, context: Context): Writer {
  const { eid, masks, score } = context
  const writer = new Writer(join(context.out, layer, table), context.target)
  let group: { key: string; at: number; character: boolean; best: [number, boolean]; main: number } | undefined
  const emit = () => {
    if (!group) return
    const { key, at, character, best, main } = group
    const flags = (character ? CHARACTER : 0) | (score.adult[at] ? ADULT : 0) | (masks[at] ?? 0)
    const tail = [score.rank[at], score.standing[at], score.extra[at]]
    writer.add([key, at, best[0], flags | (best[1] ? MAIN : 0), ...tail], key)
    if (!best[1] && main >= 0) writer.add([key, at, main, flags | MAIN, ...tail], key)
  }
  for (const row of db.query<KeySource, []>(KEY_SQL[table]).iterate()) {
    const at = eid.get(row.entity)
    if (at === undefined) continue
    const weight = Math.round(weightOf(row) * 1000)
    const isMain = row.kind === 'main' || row.kind === 'official'
    if (!group || group.key !== row.key || group.at !== at) {
      emit()
      group = {
        key: row.key,
        at,
        character: row.ekind === 'character',
        best: [weight, isMain],
        main: isMain ? weight : -1,
      }
      continue
    }
    if (weight > group.best[0] || (weight === group.best[0] && isMain)) group.best = [weight, isMain]
    if (isMain && weight > group.main) group.main = weight
  }
  emit()
  writer.flush()
  return writer
}

const ENTITY_SQL = `WITH ids(id) AS (${IDS})
SELECT id,
  (SELECT json_group_array(json_array(text, lang, kind, source, qual)) FROM
    (SELECT text, lang, kind, source, qual FROM names WHERE entity = ids.id ORDER BY rowid)) AS names,
  (SELECT json_group_array(json_array(substr(ref, 10), rank)) FROM
    (SELECT ref, rank FROM refs WHERE entity = ids.id AND ref GLOB 'danbooru:*' ORDER BY rank IS NULL, rank DESC, rowid)) AS tags,
  (SELECT json_group_array(work) FROM
    (SELECT work FROM works WHERE character = ids.id GROUP BY work ORDER BY min(rowid))) AS works
FROM ids ORDER BY id`

type NameSource = [text: string, lang: string | null, kind: NameKind, source: string, qual: string | null]

function entityTable(db: Database, layer: Layer, context: Context): Writer {
  const { eid, score } = context
  const writer = new Writer(join(context.out, layer, 'entity'), context.target / 2)
  const links = score.related.get(layer) ?? new Map<number, number[]>()
  const order = (at: number) => 25 * (score.standing[at] ?? 0) + 1000 * (score.extra[at] ?? 0)
  for (const row of db.query<{ id: string; names: string; tags: string; works: string }, []>(ENTITY_SQL).iterate()) {
    const at = eid.get(row.id)
    if (at === undefined) continue
    const names = (JSON.parse(row.names) as NameSource[]).map(([text, lang, kind, source, qual]) => {
      const code = NAME_KINDS.indexOf(kind)
      if (code < 0) throw new Error(`aninames: name kind ${kind} has no code`)
      const found = TRUSTED.indexOf(source)
      const trust = found < 0 ? TRUSTED.length : found
      return qual === null ? [text, lang, code, trust] : [text, lang, code, trust, qual]
    })
    const tags = (JSON.parse(row.tags) as [string, number | null][]).map(([tag, posts]) => [
      tag,
      posts === null ? null : Math.round(posts),
    ])
    const works = (JSON.parse(row.works) as string[]).flatMap((work) => {
      const other = eid.get(work)
      return other === undefined ? [] : [[other, work]]
    })
    const reach = row.id.startsWith('w/') ? reachOf(links, at).sort((a, b) => order(b) - order(a) || a - b) : []
    writer.add(
      [at, row.id, names, tags, works, reach, score.rank[at], score.standing[at], score.extra[at], score.adult[at]],
      row.id,
      at,
    )
  }
  writer.flush()
  return writer
}

const html = (text: string) =>
  text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)

async function page(built: string): Promise<string> {
  const sections = (await licenses()).flatMap(([layer, lines]) => [
    `<h2>${html(layer)}</h2>`,
    '<ul>',
    ...lines.map((line) => `<li>${html(line)}</li>`),
    '</ul>',
  ])
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>aninames</title>',
    '<h1>aninames</h1>',
    `<p>The search keys of <a href="https://github.com/kecan0406/aninames">aninames</a>, a multilingual alias index for anime titles and characters, as sorted gzip'd JSON files for its client library. Built ${html(built)}; the files are listed in <a href="manifest.json">manifest.json</a>.</p>`,
    `<p>${html(TERMS)}</p>`,
    ...sections,
    '',
  ].join('\n')
}

function builtAt(db: Database): string {
  return db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'built'").get()?.value ?? ''
}

export async function chunk(dir: string, target = 32_768): Promise<void> {
  const started = performance.now()
  const dbs = new Map<Layer, Database>()
  for (const layer of LAYERS) {
    const path = join(dir, `${layer}.sqlite`)
    if (existsSync(path)) dbs.set(layer, new Database(path, { readonly: true }))
  }
  const core = dbs.get('core')
  if (!core) throw new Error(`aninames: ${join(dir, 'core.sqlite')} is missing; run mise run build`)
  const out = join(dir, 'site')
  rmSync(out, { recursive: true, force: true })
  const { eid, masks } = numbering(dbs)
  const context: Context = { eid, masks, score: scores(dbs, eid), out, target }
  const built = builtAt(core)
  const layers: Partial<Record<Layer, Record<Table, Packed>>> = {}
  let files = 0
  let gz = 0
  for (const [layer, db] of dbs) {
    const tables = {} as Record<Table, Packed>
    for (const table of [...KEY_TABLES, 'entity'] as const) {
      const writer = table === 'entity' ? entityTable(db, layer, context) : keyTable(db, layer, table, context)
      tables[table] = writer.packed(table === 'entity')
      files += writer.hashes.length
      gz += writer.gz
      console.log(
        `chunk: ${layer}/${table} ${writer.hashes.length} files, ${(writer.raw / 2 ** 20).toFixed(1)} MB raw, ${(writer.gz / 2 ** 20).toFixed(1)} MB gz`,
      )
    }
    layers[layer] = tables
    db.close()
  }
  const manifest = JSON.stringify({ aninames: FORMAT, built, layers })
  writeFileSync(join(out, 'manifest.json'), manifest)
  writeFileSync(join(out, 'CNAME'), `${DOMAIN}\n`)
  writeFileSync(join(out, 'NOTICE.md'), await notice())
  writeFileSync(join(out, 'index.html'), await page(built))
  const packed = gzipSync(manifest, { level: 9 }).length
  console.log(
    `chunk: ${files} files, ${(gz / 2 ** 20).toFixed(1)} MB gz; manifest ${(manifest.length / 1024).toFixed(0)} KB raw, ${(packed / 1024).toFixed(0)} KB gz in ${((performance.now() - started) / 1000).toFixed(0)} s to ${out}`,
  )
}
