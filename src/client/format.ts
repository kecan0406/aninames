import { type Kind, LAYERS, type Layer, type NameKind, SPINE } from '../model.ts'
import { flat } from '../text.ts'
import { compare } from './order.ts'

export const FORMAT = 1

export const KEY_TABLES = ['flat', 'latin', 'sound', 'part', 'initial'] as const

export type KeyTable = (typeof KEY_TABLES)[number]

export const TABLES = [...KEY_TABLES, 'tag', 'home', 'entity'] as const

export type Table = (typeof TABLES)[number]

export const NAME_KINDS: readonly NameKind[] = [
  'main',
  'official',
  'synonym',
  'short',
  'reading',
  'redirect',
  'section',
  'generated',
]

export const TRUSTED: readonly string[] = ['wikidata', 'aod', 'anidb', 'vndb']

export const CHARACTER = 1
export const MAIN = 2
export const ADULT = 4

export function present(layer: Layer): number {
  return 8 << LAYERS.indexOf(layer)
}

const HASH = /^[0-9a-f]{12}$/

export const HASH_LENGTH = 12

export function chunkPath(layer: Layer, table: Table, hash: string): string {
  return `${layer}/${table}/${hash}.json.gz`
}

const PATH = new RegExp(`^(${LAYERS.join('|')})/(${TABLES.join('|')})/([0-9a-f]{12})\\.json\\.gz$`)

export function parsePath(path: string): { layer: Layer; table: Table; hash: string } | undefined {
  const match = PATH.exec(path)
  return match ? { layer: match[1] as Layer, table: match[2] as Table, hash: match[3] as string } : undefined
}

export function shared(a: string, b: string): number {
  const length = Math.min(a.length, b.length)
  let at = 0
  while (at < length && a.charCodeAt(at) === b.charCodeAt(at)) at++
  const last = a.charCodeAt(at - 1)
  return at > 0 && last >= 0xd800 && last <= 0xdbff ? at - 1 : at
}

export interface Packed {
  share: number[]
  rest: string[]
  files: string
  eids?: number[]
}

export function pack(keys: string[], hashes: string[], eids?: number[]): Packed {
  const share: number[] = []
  const rest: string[] = []
  let previous = ''
  for (const key of keys) {
    const n = shared(previous, key)
    share.push(n)
    rest.push(key.slice(n))
    previous = key
  }
  const out: Packed = { share, rest, files: hashes.join('') }
  if (eids) out.eids = eids.map((eid, at) => eid - (at > 0 ? (eids[at - 1] ?? 0) : 0))
  return out
}

export interface Spans {
  bounds: string[]
  files: string[]
}

export interface EntitySpans extends Spans {
  eids: number[]
}

export interface LayerSpans {
  keys: Record<KeyTable, Spans>
  tag: Spans | undefined
  home: Spans | undefined
  entity: EntitySpans
}

export interface Manifest {
  built: string
  layers: Map<Layer, LayerSpans>
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

function bad(why: string): Error {
  return new Error(`aninames: cannot read the manifest: ${why}`)
}

function unpack(value: unknown, where: string, numbered: boolean): EntitySpans {
  if (!isObject(value)) throw bad(`${where} is missing`)
  const { share, rest, files, eids } = value
  if (!Array.isArray(share) || !Array.isArray(rest) || typeof files !== 'string' || share.length !== rest.length)
    throw bad(`${where} is malformed`)
  if (files.length !== share.length * HASH_LENGTH) throw bad(`${where} names ${files.length} hash characters`)
  if (numbered && (!Array.isArray(eids) || eids.length !== share.length)) throw bad(`${where} has no entity numbers`)
  const out: EntitySpans = { bounds: [], files: [], eids: [] }
  let previous = ''
  let eid = 0
  for (let at = 0; at < share.length; at++) {
    const n = share[at]
    const tail = rest[at]
    if (!isCount(n) || n > previous.length || typeof tail !== 'string') throw bad(`${where} span ${at} is malformed`)
    const key = previous.slice(0, n) + tail
    if (at > 0 && compare(previous, key) > 0) throw bad(`${where} is out of order at span ${at}`)
    const hash = files.slice(at * HASH_LENGTH, (at + 1) * HASH_LENGTH)
    if (!HASH.test(hash)) throw bad(`${where} span ${at} has no file name`)
    if (numbered) {
      const delta = (eids as unknown[])[at]
      if (!isCount(delta) || (at > 0 && delta === 0)) throw bad(`${where} span ${at} has a bad entity number`)
      eid += delta
      out.eids.push(eid)
    }
    out.bounds.push(key)
    out.files.push(hash)
    previous = key
  }
  return out
}

function spansOf(value: unknown, where: string): Spans {
  const { bounds, files } = unpack(value, where, false)
  return { bounds, files }
}

export function readManifest(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw bad('it is not JSON')
  }
  if (!isObject(value)) throw bad('it is not an object')
  if (value.aninames !== FORMAT) {
    throw new Error(
      `aninames: the manifest has format ${String(value.aninames)}, this library reads format ${FORMAT}; update @kecan0406/aninames`,
    )
  }
  const built = typeof value.built === 'string' ? value.built : ''
  if (!isObject(value.layers)) throw bad('it lists no layers')
  const layers = new Map<Layer, LayerSpans>()
  for (const layer of LAYERS) {
    const tables = value.layers[layer]
    if (tables === undefined) continue
    if (!isObject(tables)) throw bad(`layer ${layer} is malformed`)
    const keys = {} as Record<KeyTable, Spans>
    for (const table of KEY_TABLES) keys[table] = spansOf(tables[table], `${layer}/${table}`)
    const tag = tables.tag === undefined ? undefined : spansOf(tables.tag, `${layer}/tag`)
    const home = tables.home === undefined ? undefined : spansOf(tables.home, `${layer}/home`)
    layers.set(layer, { keys, tag, home, entity: unpack(tables.entity, `${layer}/entity`, true) })
  }
  if (!layers.has(SPINE)) throw bad(`it has no ${SPINE} layer`)
  return { built, layers }
}

export function manifestPaths(manifest: Manifest): Set<string> {
  const paths = new Set<string>()
  for (const [layer, spans] of manifest.layers) {
    for (const table of KEY_TABLES) for (const hash of spans.keys[table].files) paths.add(chunkPath(layer, table, hash))
    for (const hash of spans.tag?.files ?? []) paths.add(chunkPath(layer, 'tag', hash))
    for (const hash of spans.home?.files ?? []) paths.add(chunkPath(layer, 'home', hash))
    for (const hash of spans.entity.files) paths.add(chunkPath(layer, 'entity', hash))
  }
  return paths
}

export type KeyRow = readonly [
  key: string,
  eid: number,
  weight: number,
  flags: number,
  rank: number,
  standing: number,
  extra: number,
  tier?: number,
]

export interface Name {
  text: string
  lang: string | null
  kind: NameKind
  trust: number
  qual: string | null
  pref: number | null
  flat: string
}

export interface EntityRow {
  eid: number
  id: string
  kind: Kind
  names: Name[]
  danbooru: [tag: string, posts: number | null][]
  works: [eid: number, id: string][]
  reach: number[]
  rank: number
  standing: number
  extra: number
  adult: boolean
  refs: string[]
  home: string | null
  origin: string[]
  year: number | null
  medium: string | null
  copyrights: string[]
}

const isInt = (value: unknown): value is number => Number.isSafeInteger(value)

function keyRow(value: unknown): KeyRow | undefined {
  if (!Array.isArray(value) || value.length < 7) return undefined
  const [key, eid, weight, flags, rank, standing, extra, tier] = value
  if (typeof key !== 'string' || !isCount(eid)) return undefined
  if (!isInt(weight) || !isInt(flags) || !isInt(rank) || !isInt(standing) || !isInt(extra)) return undefined
  return isCount(tier)
    ? [key, eid, weight, flags, rank, standing, extra, tier]
    : [key, eid, weight, flags, rank, standing, extra]
}

function nameOf(value: unknown): Name | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined
  const [text, lang, kind, trust, qual, pref] = value
  if (typeof text !== 'string' || (lang !== null && typeof lang !== 'string')) return undefined
  const named = isCount(kind) ? NAME_KINDS[kind] : undefined
  if (!named || !isCount(trust)) return undefined
  if (qual !== undefined && qual !== null && typeof qual !== 'string') return undefined
  if (pref !== undefined && !isCount(pref)) return undefined
  return { text, lang, kind: named, trust, qual: qual ?? null, pref: pref ?? null, flat: flat(text) }
}

function list<T>(value: unknown, item: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: T[] = []
  for (const entry of value) {
    const read = item(entry)
    if (read === undefined) return undefined
    out.push(read)
  }
  return out
}

const tagOf = (value: unknown): [string, number | null] | undefined =>
  Array.isArray(value) && typeof value[0] === 'string' && (value[1] === null || typeof value[1] === 'number')
    ? [value[0], value[1]]
    : undefined

const workOf = (value: unknown): [number, string] | undefined =>
  Array.isArray(value) && isCount(value[0]) && typeof value[1] === 'string' ? [value[0], value[1]] : undefined

const eidOf = (value: unknown): number | undefined => (isCount(value) ? value : undefined)

const refOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.indexOf(':') > 0 ? value : undefined

const countryOf = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : undefined

function entityRow(value: unknown): EntityRow | undefined {
  if (!Array.isArray(value) || value.length < 10) return undefined
  const [
    eid,
    id,
    rawNames,
    rawTags,
    rawWorks,
    rawReach,
    rank,
    standing,
    extra,
    adult,
    rawRefs = [],
    home = null,
    rawOrigin = [],
    year = null,
    medium = null,
    rawCopyrights = [],
  ] = value
  if (!isCount(eid) || typeof id !== 'string') return undefined
  const kind: Kind | undefined = id.startsWith('w/') ? 'work' : id.startsWith('c/') ? 'character' : undefined
  if (!kind || !isInt(rank) || !isInt(standing) || !isInt(extra)) return undefined
  const names = list(rawNames, nameOf)
  const danbooru = list(rawTags, tagOf)
  const works = list(rawWorks, workOf)
  const reach = list(rawReach, eidOf)
  const refs = list(rawRefs, refOf)
  const origin = list(rawOrigin, countryOf)
  const copyrights = list(rawCopyrights, (tag) => (typeof tag === 'string' && tag !== '' ? tag : undefined))
  if (!names || !danbooru || !works || !reach || !refs || !origin || !copyrights) return undefined
  if (home !== null && typeof home !== 'string') return undefined
  if ((year !== null && !isCount(year)) || (medium !== null && typeof medium !== 'string')) return undefined
  return {
    eid,
    id,
    kind,
    names,
    danbooru,
    works,
    reach,
    rank,
    standing,
    extra,
    adult: adult === 1,
    refs,
    home,
    origin,
    year,
    medium,
    copyrights,
  }
}

export function readRows(table: Table, value: unknown): KeyRow[] | EntityRow[] | undefined {
  if (!Array.isArray(value)) return undefined
  const read: (row: unknown) => KeyRow | EntityRow | undefined = table === 'entity' ? entityRow : keyRow
  const rows: (KeyRow | EntityRow)[] = []
  for (const row of value) {
    const decoded = read(row)
    if (decoded) rows.push(decoded)
  }
  return rows as KeyRow[] | EntityRow[]
}
