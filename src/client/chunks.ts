import type { Layer } from '../model.ts'
import { chunkPath, type EntityRow, type KeyRow, type KeyTable, type Manifest, present, type Table } from './format.ts'
import { compare } from './order.ts'

export type Rows = KeyRow[] | EntityRow[]

export type Loaded = (path: string) => Rows | undefined

export interface Range {
  low: string
  high: string
  open?: boolean
  limit?: number
  spans?: number
  keep?: (row: KeyRow) => boolean
}

function last(count: number, below: (at: number) => boolean): number {
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (below(mid)) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

function firstRow(rows: KeyRow[], low: string, open: boolean): number {
  return (
    last(rows.length, (at) => {
      const c = compare((rows[at] as KeyRow)[0], low)
      return c < 0 || (open && c === 0)
    }) + 1
  )
}

export class View {
  readonly wanted = new Set<string>()
  readonly manifest: Manifest
  readonly layers: Layer[]
  labels = false
  private readonly loaded: Loaded

  constructor(manifest: Manifest, layers: Layer[], loaded: Loaded) {
    this.manifest = manifest
    this.layers = layers
    this.loaded = loaded
  }

  private rows(layer: Layer, table: Table, hash: string): Rows | undefined {
    const path = chunkPath(layer, table, hash)
    const rows = this.loaded(path)
    if (!rows) this.wanted.add(path)
    return rows
  }

  keys(table: KeyTable, range: Range): KeyRow[] {
    return this.layers.flatMap((layer) => this.keysIn(layer, table, range))
  }

  private keysIn(layer: Layer, table: KeyTable, range: Range): KeyRow[] {
    const spans = this.manifest.layers.get(layer)?.keys[table]
    if (!spans) return []
    const { low, high, open = false, limit = Number.POSITIVE_INFINITY, spans: most = Number.POSITIVE_INFINITY } = range
    const start = Math.max(
      0,
      last(spans.bounds.length, (at) => {
        const c = compare(spans.bounds[at] as string, low)
        return c < 0 || (open && c === 0)
      }),
    )
    const out: KeyRow[] = []
    for (let at = start; at < spans.files.length && at < start + most && out.length < limit; at++) {
      const c = compare(spans.bounds[at] as string, high)
      if (c > 0 || (open && c === 0)) break
      const rows = this.rows(layer, table, spans.files[at] as string) as KeyRow[] | undefined
      if (!rows) continue
      for (let i = firstRow(rows, low, open); i < rows.length && out.length < limit; i++) {
        const row = rows[i] as KeyRow
        const d = compare(row[0], high)
        if (d > 0 || (open && d === 0)) break
        if (!range.keep || range.keep(row)) out.push(row)
      }
    }
    return out
  }

  around(table: KeyTable, key: string, radius: number): KeyRow[] {
    const out: KeyRow[] = []
    for (const layer of this.layers) {
      const spans = this.manifest.layers.get(layer)?.keys[table]
      if (!spans || spans.files.length === 0) continue
      const at = Math.max(
        0,
        last(spans.bounds.length, (i) => compare(spans.bounds[i] as string, key) <= 0),
      )
      for (let i = Math.max(0, at - radius); i <= Math.min(spans.files.length - 1, at + radius); i++) {
        const rows = this.rows(layer, table, spans.files[i] as string) as KeyRow[] | undefined
        if (rows) out.push(...rows)
      }
    }
    return out
  }

  entity(eid: number, mask = 0): EntityRow[] {
    const out: EntityRow[] = []
    for (const layer of this.layers) {
      if (mask && !(mask & present(layer))) continue
      const spans = this.manifest.layers.get(layer)?.entity
      if (!spans) continue
      const at = last(spans.eids.length, (i) => (spans.eids[i] as number) <= eid)
      if (at < 0) continue
      const rows = this.rows(layer, 'entity', spans.files[at] as string) as EntityRow[] | undefined
      const i = rows ? last(rows.length, (r) => (rows[r] as EntityRow).eid < eid) + 1 : -1
      const row = rows?.[i]
      if (row?.eid === eid) out.push(row)
    }
    return out
  }

  byId(id: string): EntityRow[] {
    const out: EntityRow[] = []
    for (const layer of this.layers) {
      const spans = this.manifest.layers.get(layer)?.entity
      if (!spans) continue
      const at = last(spans.bounds.length, (i) => compare(spans.bounds[i] as string, id) <= 0)
      if (at < 0) continue
      const rows = this.rows(layer, 'entity', spans.files[at] as string) as EntityRow[] | undefined
      const i = rows ? last(rows.length, (r) => compare((rows[r] as EntityRow).id, id) < 0) + 1 : -1
      const row = rows?.[i]
      if (row?.id === id) out.push(row)
    }
    return out
  }
}
