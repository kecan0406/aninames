import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Kind, Layer, NameKind } from './model.ts'
import { flat, latinKey, qualifiers, soundKeys } from './text.ts'

export interface Hit {
  id: string
  kind: Kind
  score: number
  matched: string
  how: string
}

export interface Card {
  id: string
  kind: Kind
  medium: string | null
  names: { text: string; lang: string | null; kind: NameKind; source: string }[]
  refs: string[]
  works: string[]
}

interface NameRow {
  rowid: number
  entity: string
  ekind: Kind
  text: string
  kind: NameKind
  flat: string
  qual: string | null
}

const NAME_WEIGHT: Record<NameKind, number> = {
  main: 1,
  official: 1,
  reading: 1,
  synonym: 0.95,
  short: 0.95,
  redirect: 0.92,
  section: 0.6,
  generated: 0.85,
}

const COLUMNS = 'rowid, entity, ekind, text, kind, flat, qual'

export class Index {
  readonly layers: Layer[]
  private db: Database
  private schemas: string[]
  private ranks = new Map<string, number>()

  constructor(dir: string, layers: Layer[] = ['core', 'kowiki', 'unlicensed']) {
    const core = join(dir, 'core.sqlite')
    if (!existsSync(core)) {
      throw new Error(`aninames: ${core} is missing; run mise run build`)
    }
    this.db = new Database(core)
    this.schemas = ['main']
    this.layers = ['core']
    for (const layer of layers) {
      if (layer === 'core') continue
      const path = join(dir, `${layer}.sqlite`)
      if (!existsSync(path)) continue
      this.db.run(`ATTACH DATABASE '${path.replaceAll("'", "''")}' AS ${layer}`)
      this.schemas.push(layer)
      this.layers.push(layer)
    }
  }

  close(): void {
    this.db.close()
  }

  private union<T>(sql: (schema: string) => string, ...params: (string | number)[]): T[] {
    const rows: T[] = []
    for (const schema of this.schemas) {
      rows.push(...(this.db.query(sql(schema)).all(...params) as T[]))
    }
    return rows
  }

  rank(id: string): number {
    const cached = this.ranks.get(id)
    if (cached !== undefined) return cached
    const rows = this.union<{ rank: number }>((s) => `SELECT rank FROM ${s}.ranks WHERE entity = ?`, id)
    const rank = rows.reduce((best, row) => Math.max(best, row.rank), 0)
    this.ranks.set(id, rank)
    return rank
  }

  refs(id: string): string[] {
    return this.union<{ ref: string }>((s) => `SELECT ref FROM ${s}.refs WHERE entity = ?`, id).map((r) => r.ref)
  }

  resolve(ref: string, kind?: Kind): string | undefined {
    const prefix = kind === 'work' ? 'w/%' : kind === 'character' ? 'c/%' : '%'
    return this.union<{ entity: string }>(
      (s) => `SELECT entity FROM ${s}.refs WHERE ref = ? AND entity LIKE ? LIMIT 1`,
      ref,
      prefix,
    )[0]?.entity
  }

  card(id: string): Card | undefined {
    const head = this.union<{ kind: Kind; medium: string | null }>(
      (s) => `SELECT kind, medium FROM ${s}.entities WHERE id = ?`,
      id,
    )[0]
    if (!head) return undefined
    const { kind, medium } = head
    const names = this.union<Card['names'][number]>(
      (s) => `SELECT text, lang, kind, source FROM ${s}.names WHERE entity = ?`,
      id,
    )
    const works = [
      ...new Set(
        this.union<{ work: string }>((s) => `SELECT work FROM ${s}.works WHERE character = ?`, id).map((r) => r.work),
      ),
    ]
    return { id, kind, medium, names, refs: this.refs(id), works }
  }

  label(id: string, langs: string[] = ['ja', 'en', 'ja-Latn', 'ko']): string {
    const names = this.card(id)?.names ?? []
    const trusted = ['wikidata', 'aod', 'anidb', 'vndb']
    for (const lang of langs) {
      for (const source of [...trusted, undefined]) {
        const found = names.find(
          (n) =>
            n.lang === lang &&
            (n.kind === 'official' || n.kind === 'main') &&
            (source === undefined || n.source === source),
        )
        if (found) return found.text
      }
    }
    return names.find((n) => n.kind === 'main')?.text ?? names[0]?.text ?? id
  }

  private candidates(query: string, kind?: Kind): Map<string, Hit> {
    const hits = new Map<string, Hit>()
    const filter = kind ? ` AND ekind = '${kind}'` : ''
    const consider = (row: NameRow, base: number, how: string) => {
      if (kind && row.ekind !== kind) return
      const score = base * NAME_WEIGHT[row.kind] * (row.qual === null ? 1 : 0.9)
      const current = hits.get(row.entity)
      if (!current || current.score < score)
        hits.set(row.entity, { id: row.entity, kind: row.ekind, score, matched: row.text, how })
    }
    const q = flat(query)
    if (!q) return hits
    for (const row of this.union<NameRow>((s) => `SELECT ${COLUMNS} FROM ${s}.names WHERE flat = ?${filter}`, q)) {
      consider(row, 100, 'exact')
    }
    const latin = latinKey(query)
    if (latin && /[a-z]/.test(latin)) {
      for (const row of this.union<NameRow>(
        (s) => `SELECT ${COLUMNS} FROM ${s}.names WHERE latin = ?${filter}`,
        latin,
      )) {
        consider(row, 95, 'latin')
      }
    }
    if (!/\s/.test(query.trim())) {
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual FROM ${s}.parts p JOIN ${s}.names n ON n.rowid = p.name WHERE p.part = ?${filter.replace('ekind', 'n.ekind')}`,
        q,
      )) {
        consider(row, 84, 'part')
      }
    }
    for (const key of soundKeys(qualifiers(query).base)) {
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual FROM ${s}.sounds k JOIN ${s}.names n ON n.rowid = k.name WHERE k.key = ?${filter.replace('ekind', 'n.ekind')}`,
        key,
      )) {
        consider(row, 82, 'sound')
      }
    }
    const length = [...q].length
    for (const row of this.union<NameRow>(
      (s) => `SELECT ${COLUMNS} FROM ${s}.names WHERE flat > ? AND flat < ?${filter} LIMIT 3000`,
      q,
      `${q}\u{10FFFF}`,
    )) {
      consider(row, 60 + 25 * (length / [...row.flat].length), 'prefix')
    }
    if (length >= 3) {
      const phrase = `"${q.replaceAll('"', '""')}"`
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual FROM ${s}.names_fts f JOIN ${s}.names n ON n.rowid = f.rowid WHERE names_fts MATCH ?${filter.replace('ekind', 'n.ekind')} LIMIT 3000`,
        phrase,
      )) {
        consider(row, 40 + 30 * (length / [...row.flat].length), 'substring')
      }
    }
    return hits
  }

  private fuzzy(query: string, kind?: Kind): Map<string, Hit> {
    const hits = new Map<string, Hit>()
    const q = flat(query)
    const chars = [...q]
    if (chars.length < 4) return hits
    const grams = new Set<string>()
    for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(''))
    const match = [...grams].map((g) => `"${g.replaceAll('"', '""')}"`).join(' OR ')
    const filter = kind ? ` AND n.ekind = '${kind}'` : ''
    for (const row of this.union<NameRow>(
      (s) =>
        `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual FROM ${s}.names_fts f JOIN ${s}.names n ON n.rowid = f.rowid WHERE names_fts MATCH ?${filter} LIMIT 5000`,
      match,
    )) {
      let shared = 0
      for (const gram of grams) if (row.flat.includes(gram)) shared++
      const overlap = shared / grams.size
      const lengthRatio = Math.min(chars.length, [...row.flat].length) / Math.max(chars.length, [...row.flat].length)
      if (overlap < 0.5) continue
      const score = 55 * overlap * (0.5 + 0.5 * lengthRatio) * NAME_WEIGHT[row.kind]
      const current = hits.get(row.entity)
      if (!current || current.score < score)
        hits.set(row.entity, { id: row.entity, kind: row.ekind, score, matched: row.text, how: 'fuzzy' })
    }
    return hits
  }

  medium(id: string): string | null {
    return (
      this.union<{ medium: string | null }>((s) => `SELECT medium FROM ${s}.entities WHERE id = ?`, id)[0]?.medium ??
      null
    )
  }

  private prior(hit: Hit): number {
    if (hit.kind !== 'work') return 0
    const head = this.union<{ medium: string | null; type: string | null }>(
      (s) => `SELECT medium, type FROM ${s}.entities WHERE id = ?`,
      hit.id,
    )[0]
    return (head?.medium === 'anime' ? 6 : 0) + (head?.type === 'TV' ? 2 : 0)
  }

  related(id: string): string[] {
    return [
      ...new Set(
        this.union<{ other: string }>((s) => `SELECT other FROM ${s}.related WHERE work = ?`, id).map((r) => r.other),
      ),
    ]
  }

  private reach(id: string): string[] {
    const out: string[] = []
    let frontier = [id]
    const seen = new Set(frontier)
    for (let hop = 1; hop <= 2; hop++) {
      const next: string[] = []
      for (const at of frontier) {
        for (const other of this.related(at)) {
          if (seen.has(other)) continue
          seen.add(other)
          next.push(other)
          out.push(other)
        }
      }
      frontier = next
    }
    return out
  }

  private names(id: string, text: string): boolean {
    return (
      this.union<{ found: number }>(
        (s) => `SELECT 1 AS found FROM ${s}.names WHERE entity = ? AND instr(flat, ?) > 0 LIMIT 1`,
        id,
        text,
      ).length > 0
    )
  }

  private family(hits: Map<string, Hit>, query: string): void {
    const wanted = flat(query)
    const seeds = [...hits.values()].filter((hit) => hit.kind === 'work' && hit.score >= 50)
    for (const seed of seeds) {
      const score = seed.score * 0.97
      for (const other of this.reach(seed.id)) {
        const current = hits.get(other)
        if (current && current.score >= score) continue
        if (!this.names(other, wanted) && !this.names(other, flat(seed.matched))) continue
        hits.set(other, { id: other, kind: 'work', score, matched: seed.matched, how: `family(${seed.how})` })
      }
    }
  }

  private shared = new Map<string, number>()

  private standing(hit: Hit): number {
    const own = this.rank(hit.id)
    if (hit.kind !== 'work') return own
    let family = this.shared.get(hit.id)
    if (family === undefined) {
      family = Math.max(0, ...this.reach(hit.id).map((other) => this.rank(other)))
      this.shared.set(hit.id, family)
    }
    return Math.max(own, 0.9 * family)
  }

  private corroboration(id: string): number {
    const spaces = new Set(this.refs(id).map((ref) => ref.slice(0, ref.indexOf(':'))))
    return Math.min(10, 2 * Math.max(0, spaces.size - 1))
  }

  private works(id: string): Set<string> {
    return new Set(
      this.union<{ work: string }>((s) => `SELECT work FROM ${s}.works WHERE character = ?`, id).map((r) => r.work),
    )
  }

  private quals(id: string): string[] {
    return this.union<{ qual: string }>(
      (s) => `SELECT qual FROM ${s}.names WHERE entity = ? AND qual IS NOT NULL`,
      id,
    ).map((r) => flat(r.qual))
  }

  private scoped(query: string): Map<string, Hit> {
    const hits = new Map<string, Hit>()
    const tokens = query.normalize('NFKC').split(/\s+/).filter(Boolean)
    for (let cut = 1; cut < tokens.length; cut++) {
      for (const [who, where] of [
        [tokens.slice(0, cut), tokens.slice(cut)],
        [tokens.slice(cut), tokens.slice(0, cut)],
      ] as const) {
        const people = [...this.candidates(who.join(' '), 'character').values()].filter((h) => h.score >= 80)
        if (people.length === 0) continue
        const series = flat(where.join(' '))
        const works = new Set(
          [...this.candidates(where.join(' '), 'work').values()].filter((h) => h.score >= 50).map((h) => h.id),
        )
        for (const person of people) {
          const linked = [...this.works(person.id)].some((w) => works.has(w))
          const qualified = this.quals(person.id).some((q) => q.startsWith(series) || series.startsWith(q))
          if (!linked && !qualified) continue
          const score = 90 + person.score / 10
          const current = hits.get(person.id)
          if (!current || current.score < score)
            hits.set(person.id, { ...person, score, how: linked ? 'scoped-work' : 'scoped-qual' })
        }
      }
    }
    return hits
  }

  search(query: string, options: { kind?: Kind; limit?: number } = {}): Hit[] {
    const hits = this.candidates(query, options.kind)
    if (!options.kind || options.kind === 'character') {
      for (const [id, hit] of this.scoped(query)) {
        const current = hits.get(id)
        if (!current || current.score < hit.score) hits.set(id, hit)
      }
    }
    if (!options.kind || options.kind === 'work') this.family(hits, query)
    const best = Math.max(0, ...[...hits.values()].map((h) => h.score))
    if (best < 60) {
      for (const [id, hit] of this.fuzzy(query, options.kind)) if (!hits.has(id)) hits.set(id, hit)
    }
    const first = [...hits.values()]
      .map((hit) => ({ ...hit, score: hit.score + 15 * this.rank(hit.id) + this.prior(hit) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
    return first
      .map((hit) => {
        const base = hits.get(hit.id)?.score ?? 0
        return {
          ...hit,
          score:
            base +
            15 * this.standing(hit) +
            this.prior(hit) +
            (hit.kind === 'character' ? this.corroboration(hit.id) : 0),
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 10)
  }
}
