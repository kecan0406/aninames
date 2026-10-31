import { gunzipSync } from 'node:zlib'
import { type Kind, LAYERS, type Layer, type NameKind } from '../model.ts'
import { flat, qualifiers } from '../text.ts'
import { type Rows, View } from './chunks.ts'
import { type Match, matchOf, search } from './engine.ts'
import {
  ADULT,
  CHARACTER,
  type EntityRow,
  MAIN,
  type Manifest,
  NAME_KINDS,
  type Name,
  parsePath,
  readManifest,
  readRows,
  SHADOWED,
} from './format.ts'
import { Missing, type Source } from './source.ts'

export interface Found {
  id: string
  kind: Kind
  label: string
  names: { text: string; lang: string | null; kind: NameKind; preferred?: true }[]
  danbooru: string[]
  works: string[]
  refs: string[]
  home: string | null
  origin: string[]
  year: number | null
  medium: string | null
  score: number
  match: Match | null
  adult: boolean
}

export interface Trace {
  rounds: number
  labels: number
  files: number
  bytes: number
}

const KEEP = 256
const PARALLEL = 16
const TIMEOUT = 30_000
const LABEL_LANGS = ['ja', 'en', 'ja-Latn', 'ko']
const SHOWN: ReadonlySet<NameKind> = new Set(['main', 'official', 'synonym', 'short'])

const traces = new WeakMap<Names, Trace>()

export function trace(names: Names): Readonly<Trace> {
  return traces.get(names) ?? { rounds: 0, labels: 0, files: 0, bytes: 0 }
}

function race<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}

export function decode(path: string, bytes: Uint8Array): Rows {
  const where = parsePath(path)
  let rows: Rows | undefined
  try {
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
    rows = where && readRows(where.table, JSON.parse(new TextDecoder().decode(text)))
  } catch {
    rows = undefined
  }
  if (!rows) throw new Error(`aninames: ${path} is not a chunk file`)
  return rows
}

function preferredOf(names: readonly Name[]): Map<string, Name> {
  const out = new Map<string, Name>()
  for (const name of names) {
    if (name.lang === null || name.pref === null) continue
    const known = out.get(name.lang)
    if (!known || name.pref < (known.pref ?? Number.POSITIVE_INFINITY)) out.set(name.lang, name)
  }
  return out
}

const PRIMARY: ReadonlySet<NameKind> = new Set(['main', 'official'])

function label(id: string, names: readonly Name[], preferred: ReadonlyMap<string, Name>): string {
  const chain = LABEL_LANGS.flatMap((lang) => preferred.get(lang) ?? [])
  return (
    chain.find((name) => PRIMARY.has(name.kind))?.text ??
    names
      .filter((name) => PRIMARY.has(name.kind) && name.qual === null)
      .sort((a, b) => Number(a.text.includes('(')) - Number(b.text.includes('(')) || a.trust - b.trust)[0]?.text ??
    chain[0]?.text ??
    names[0]?.text ??
    id
  )
}

function card(rows: EntityRow[], score: number, adult: boolean, match: Match | null = null): Found {
  const head = rows[0] as EntityRow
  const all = rows.flatMap((row) => row.names)
  const preferred = preferredOf(all)
  const seen = new Map<string, Found['names'][number]>()
  const names: Found['names'] = []
  for (const name of all) {
    if (!SHOWN.has(name.kind) && preferred.get(name.lang ?? '') !== name) continue
    const key = `${name.lang ?? ''}\u0000${name.text}`
    const known = seen.get(key)
    if (known) {
      if (NAME_KINDS.indexOf(name.kind) < NAME_KINDS.indexOf(known.kind)) known.kind = name.kind
      if (preferred.get(name.lang ?? '') === name) known.preferred = true
      continue
    }
    const shown: Found['names'][number] = { text: name.text, lang: name.lang, kind: name.kind }
    if (preferred.get(name.lang ?? '') === name) shown.preferred = true
    seen.set(key, shown)
    names.push(shown)
  }
  const posts = new Map<string, number | null>()
  for (const [tag, count] of rows.flatMap((row) => row.danbooru)) {
    if (!posts.has(tag) || (count ?? -1) > (posts.get(tag) ?? -1)) posts.set(tag, count)
  }
  const danbooru = [...posts]
    .map(([tag, count], at) => ({ tag, count, at }))
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.at - b.at)
    .map((entry) => entry.tag)
  const works = head.kind === 'character' ? [...new Set(rows.flatMap((row) => row.works.map(([, id]) => id)))] : []
  const refs = [...new Set(rows.flatMap((row) => row.refs))].sort()
  const home = rows.findLast((row) => row.home !== null)?.home ?? null
  const origin = [...new Set(rows.flatMap((row) => row.origin))]
  return {
    id: head.id,
    kind: head.kind,
    label: label(head.id, all, preferred),
    names,
    danbooru,
    works,
    refs,
    home,
    origin,
    year: rows.find((row) => row.year !== null)?.year ?? null,
    medium: rows.find((row) => row.medium !== null)?.medium ?? null,
    score,
    match,
    adult,
  }
}

interface State {
  text: string
  manifest: Manifest
}

export class Names {
  readonly #source: Source
  readonly #layers: readonly Layer[]
  #state: Promise<State> | undefined
  readonly #cache = new Map<string, Rows>()
  readonly #loading = new Map<string, Promise<void>>()
  readonly #queue: (() => void)[] = []
  #active = 0
  #runs = 0

  constructor(source: Source, options: { layers?: Layer[] } = {}) {
    this.#source = source
    this.#layers = options.layers ?? LAYERS
    traces.set(this, { rounds: 0, labels: 0, files: 0, bytes: 0 })
  }

  search(
    query: string,
    options: { kind?: Kind; limit?: number; adult?: boolean; signal?: AbortSignal } = {},
  ): Promise<Found[]> {
    const { signal, ...rest } = options
    return this.#run(signal, (view) => {
      const hits = search(view, query, rest)
      if (!hits) return undefined
      view.labels = true
      const out = hits.flatMap((hit) => {
        const rows = view.entity(hit.eid, hit.mask)
        return rows.length > 0 ? [card(rows, hit.score, hit.adult, matchOf(hit.how))] : []
      })
      return view.wanted.size > 0 ? undefined : out
    })
  }

  lookup(ids: string[], signal?: AbortSignal): Promise<Found[]> {
    const wanted = [...new Set(ids.filter((id) => typeof id === 'string'))]
    return this.#run(signal, (view) => {
      view.labels = true
      const out = wanted.flatMap((id) => {
        const rows = view.byId(id)
        return rows.length > 0 ? [card(rows, 0, (rows[0] as EntityRow).adult)] : []
      })
      return view.wanted.size > 0 ? undefined : out
    })
  }

  tagged(
    tag: string,
    options: { kind?: Kind; adult?: boolean; prefix?: boolean; signal?: AbortSignal } = {},
  ): Promise<Found[]> {
    return this.#tagged('tag', tag, options)
  }

  cast(
    tag: string,
    options: { adult?: boolean; prefix?: boolean; limit?: number; signal?: AbortSignal } = {},
  ): Promise<Found[]> {
    return this.#tagged('home', tag, options)
  }

  #tagged(
    table: 'tag' | 'home',
    tag: string,
    options: { kind?: Kind; adult?: boolean; prefix?: boolean; limit?: number; signal?: AbortSignal },
  ): Promise<Found[]> {
    const { kind, adult = true, prefix = false, limit = Number.POSITIVE_INFINITY, signal } = options
    const key = flat(qualifiers(tag).base)
    return this.#run(signal, (view) => {
      if (!key) return []
      const covered = view.layers.includes('unlicensed')
      const best = new Map<number, { posts: number; mask: number; flags: number; standing: number; tier: number }>()
      for (const [, eid, posts, flags, , standing, , tier = 0] of view.tagged(key, prefix, table)) {
        if (kind && (flags & CHARACTER ? 'character' : 'work') !== kind) continue
        if (!adult && flags & ADULT) continue
        if (covered && flags & SHADOWED) continue
        const known = best.get(eid)
        const mask = flags & ~(CHARACTER | MAIN | ADULT | SHADOWED)
        if (!known || posts > known.posts) {
          best.set(eid, {
            posts,
            mask: mask | (known?.mask ?? 0),
            flags,
            standing,
            tier: Math.min(tier, known?.tier ?? tier),
          })
        } else {
          known.mask |= mask
          known.tier = Math.min(known.tier, tier)
        }
      }
      const order = [...best]
        .sort(([a, x], [b, y]) => x.tier - y.tier || y.posts - x.posts || y.standing - x.standing || a - b)
        .slice(0, limit)
      view.labels = true
      const out = order.flatMap(([eid, hit]) => {
        const rows = view.entity(eid, hit.mask)
        return rows.length > 0 ? [card(rows, 0, (hit.flags & ADULT) !== 0)] : []
      })
      return view.wanted.size > 0 ? undefined : out
    })
  }

  #open(): Promise<State> {
    if (this.#state) return this.#state
    const state = this.#source
      .manifest(AbortSignal.timeout(TIMEOUT))
      .then((text) => ({ text, manifest: readManifest(text) }))
    this.#state = state
    state.catch(() => {
      if (this.#state === state) this.#state = undefined
    })
    return state
  }

  #view(manifest: Manifest): View {
    const layers = LAYERS.filter(
      (layer) => (layer === 'core' || this.#layers.includes(layer)) && manifest.layers.has(layer),
    )
    return new View(manifest, layers, (path) => {
      const rows = this.#cache.get(path)
      if (rows) {
        this.#cache.delete(path)
        this.#cache.set(path, rows)
      }
      return rows
    })
  }

  async #run<T>(signal: AbortSignal | undefined, compute: (view: View) => T | undefined): Promise<T> {
    signal?.throwIfAborted()
    const counts = traces.get(this) as Trace
    this.#runs++
    try {
      for (let retry = true; ; retry = false) {
        const state = await race(this.#open(), signal)
        try {
          for (;;) {
            const view = this.#view(state.manifest)
            const value = compute(view)
            if (view.wanted.size === 0) return value as T
            if (view.labels) counts.labels++
            else counts.rounds++
            await race(this.#load([...view.wanted]), signal)
          }
        } catch (error) {
          if (!retry || !(error instanceof Missing)) throw error
          const text = await race(this.#source.manifest(AbortSignal.timeout(TIMEOUT)), signal)
          if (text === state.text) throw error
          this.#state = Promise.resolve({ text, manifest: readManifest(text) })
        }
      }
    } finally {
      this.#runs--
      if (this.#runs === 0) for (const path of [...this.#cache.keys()].slice(0, -KEEP)) this.#cache.delete(path)
    }
  }

  #load(paths: string[]): Promise<unknown> {
    return Promise.all(
      paths.map((path) => {
        if (this.#cache.has(path)) return undefined
        let loading = this.#loading.get(path)
        if (!loading) {
          loading = this.#fetch(path).finally(() => this.#loading.delete(path))
          this.#loading.set(path, loading)
        }
        return loading
      }),
    )
  }

  async #fetch(path: string): Promise<void> {
    while (this.#active >= PARALLEL) await new Promise<void>((go) => this.#queue.push(go))
    this.#active++
    try {
      const bytes = await this.#source.file(path, AbortSignal.timeout(TIMEOUT))
      this.#cache.set(path, decode(path, bytes))
      const counts = traces.get(this) as Trace
      counts.files++
      counts.bytes += bytes.byteLength
    } finally {
      this.#active--
      this.#queue.shift()?.()
    }
  }
}
