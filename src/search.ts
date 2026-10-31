import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { swapLayout, TOP, typing, weightOf } from './match.ts'
import type { Kind, Layer, NameKind } from './model.ts'
import { editDistance, flat, latinKey, partKey, qualifiers, soundKeys } from './text.ts'

export interface Hit {
  id: string
  kind: Kind
  score: number
  matched: string
  how: string
  adult?: boolean
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
  variant: number
  support: number
}

const COLUMNS = 'rowid, entity, ekind, text, kind, flat, qual, variant, support'

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
    const rank = Math.max(0, ...rows.map((row) => row.rank))
    this.ranks.set(id, rank)
    return rank
  }

  home(id: string): string | undefined {
    return this.union<{ tag: string }>((s) => `SELECT tag FROM ${s}.homes WHERE entity = ?`, id).at(-1)?.tag
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

  preferred(id: string, lang: string): { text: string; kind: NameKind } | undefined {
    return this.union<{ text: string; kind: NameKind; pref: number }>(
      (s) => `SELECT text, kind, pref FROM ${s}.names WHERE entity = ? AND lang = ? AND pref IS NOT NULL`,
      id,
      lang,
    ).sort((a, b) => a.pref - b.pref)[0]
  }

  label(id: string, langs: string[] = ['ja', 'en', 'ja-Latn', 'ko']): string {
    const primary = (kind: NameKind) => kind === 'main' || kind === 'official'
    const chain = langs.flatMap((lang) => this.preferred(id, lang) ?? [])
    const names = this.card(id)?.names ?? []
    return (
      chain.find((name) => primary(name.kind))?.text ??
      names
        .filter((name) => primary(name.kind))
        .sort(
          (a, b) =>
            Number(a.text.includes('(')) - Number(b.text.includes('(')) ||
            Number(a.source === 'danbooru') - Number(b.source === 'danbooru'),
        )[0]?.text ??
      chain[0]?.text ??
      names[0]?.text ??
      id
    )
  }

  private candidates(query: string, kind?: Kind): Map<string, Hit> {
    const hits = new Map<string, Hit>()
    const filter = kind ? ` AND ekind = '${kind}'` : ''
    const consider = (row: NameRow, base: number, how: string) => {
      if (kind && row.ekind !== kind) return
      const score = base * weightOf(row)
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
    if (/^[ㄱ-ㅎ\s]+$/.test(query.trim())) {
      const key = query.replace(/\s+/g, '')
      const join = (s: string) =>
        `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual, n.variant, n.support FROM ${s}.initials i JOIN ${s}.names n ON n.rowid = i.name`
      for (const row of this.union<NameRow>(
        (s) => `${join(s)} WHERE i.key = ?${filter.replace('ekind', 'n.ekind')}`,
        key,
      )) {
        consider(row, 86, 'initials')
      }
      for (const row of this.union<NameRow & { key: string }>(
        (s) =>
          `${join(s).replace('SELECT n.rowid', 'SELECT i.key, n.rowid')} WHERE i.key > ? AND i.key < ?${filter.replace('ekind', 'n.ekind')} LIMIT 3000`,
        key,
        `${key}${TOP}`,
      )) {
        consider(row, 60 + 20 * ([...key].length / [...row.key].length), 'initials prefix')
      }
    }
    if (!/\s/.test(query.trim())) {
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual, n.variant, n.support FROM ${s}.parts p JOIN ${s}.names n ON n.rowid = p.name WHERE p.part = ?${filter.replace('ekind', 'n.ekind')}`,
        partKey(query),
      )) {
        consider(row, row.ekind === 'character' && (row.kind === 'main' || row.kind === 'official') ? 92 : 84, 'part')
      }
    }
    for (const key of /[ㄱ-ㅎㅏ-ㅣ\u1100-\u11ff]/.test(query) ? [] : soundKeys(qualifiers(query).base)) {
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual, n.variant, n.support FROM ${s}.sounds k JOIN ${s}.names n ON n.rowid = k.name WHERE k.key = ?${filter.replace('ekind', 'n.ekind')}`,
        key,
      )) {
        consider(row, 82, 'sound')
      }
    }
    const length = [...q].length
    for (const [low, high] of typing(q)) {
      for (const row of this.union<NameRow>(
        (s) => `SELECT ${COLUMNS} FROM ${s}.names WHERE flat > ? AND flat < ?${filter} LIMIT 3000`,
        low,
        high,
      )) {
        consider(row, 60 + 25 * (length / [...row.flat].length), low === q ? 'prefix' : 'typing')
      }
    }
    if (length >= 3) {
      const phrase = `"${q.replaceAll('"', '""')}"`
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual, n.variant, n.support FROM ${s}.names_fts f JOIN ${s}.names n ON n.rowid = f.rowid WHERE names_fts MATCH ?${filter.replace('ekind', 'n.ekind')} LIMIT 3000`,
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
    const limit = chars.length >= 8 ? 2 : 1
    const grams: string[] = []
    for (let i = 0; i + 3 <= chars.length; i++) grams.push(chars.slice(i, i + 3).join(''))
    const quoted = (gram: string) => `"${gram.replaceAll('"', '""')}"`
    const probes = new Set<string>()
    if (grams.length <= 5) probes.add(grams.map(quoted).join(' OR '))
    else {
      probes.add(`${quoted(grams[0] ?? '')} AND ${quoted(grams[1] ?? '')}`)
      probes.add(`${quoted(grams.at(-2) ?? '')} AND ${quoted(grams.at(-1) ?? '')}`)
    }
    const filter = kind ? ` AND n.ekind = '${kind}'` : ''
    for (const probe of probes) {
      for (const row of this.union<NameRow>(
        (s) =>
          `SELECT n.rowid, n.entity, n.ekind, n.text, n.kind, n.flat, n.qual, n.variant, n.support FROM ${s}.names_fts f JOIN ${s}.names n ON n.rowid = f.rowid WHERE names_fts MATCH ?${filter} ORDER BY f.rank LIMIT 3000`,
        probe,
      )) {
        const name = [...row.flat]
        let score = 0
        const whole = editDistance(q, row.flat, limit)
        if (whole <= limit) score = 92 - 10 * whole
        else if (name.length > chars.length) {
          const lead = editDistance(q, name.slice(0, chars.length).join(''), limit)
          if (lead <= limit) score = 72 - 10 * lead
        }
        if (score === 0) continue
        score *= weightOf(row)
        const current = hits.get(row.entity)
        if (!current || current.score < score)
          hits.set(row.entity, { id: row.entity, kind: row.ekind, score, matched: row.text, how: 'typo' })
      }
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
        const matched = [...this.candidates(where.join(' '), 'work').values()]
          .filter((h) => h.score >= 50)
          .map((h) => h.id)
        const works = new Set(matched)
        for (const id of matched.slice(0, 20)) for (const other of this.reach(id)) works.add(other)
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

  homonyms(query: string, kind: Kind): number {
    const key = flat(query)
    const ids = new Set(
      this.union<{ entity: string }>(
        (s) => `SELECT entity FROM ${s}.names WHERE flat = ? AND ekind = ?`,
        key,
        kind,
      ).map((row) => row.entity),
    )
    return ids.size
  }

  adult(id: string): boolean {
    return this.union<{ entity: string }>((s) => `SELECT entity FROM ${s}.adults WHERE entity = ?`, id).length > 0
  }

  search(query: string, options: { kind?: Kind; limit?: number; adult?: boolean } = {}): Hit[] {
    const hits = this.candidates(query, options.kind)
    if (!options.kind || options.kind === 'character') {
      for (const [id, hit] of this.scoped(query)) {
        const current = hits.get(id)
        if (!current || current.score < hit.score) hits.set(id, hit)
      }
    }
    if (!options.kind || options.kind === 'work') this.family(hits, query)
    const merge = (more: Map<string, Hit>, factor: number, how?: string) => {
      for (const [id, hit] of more) {
        const score = hit.score * factor
        const current = hits.get(id)
        if (!current || current.score < score)
          hits.set(id, { ...hit, score, how: how ? `${how}(${hit.how})` : hit.how })
      }
    }
    let best = Math.max(0, ...[...hits.values()].map((h) => h.score))
    if (best < 90) {
      const swapped = swapLayout(query)
      if (swapped) merge(this.candidates(swapped, options.kind), 0.95, 'layout')
      best = Math.max(0, ...[...hits.values()].map((h) => h.score))
    }
    if (best < 95) merge(this.fuzzy(query, options.kind), 1)
    const first = [...hits.values()]
      .map((hit) => ({ ...hit, score: hit.score + 15 * this.rank(hit.id) + this.prior(hit) }))
      .sort((a, b) => b.score - a.score)
      .filter((hit) => options.adult !== false || !this.adult(hit.id))
      .slice(0, 60)
    const weight = /\s/.test(query.trim()) ? 15 : 25
    return first
      .map((hit) => {
        const base = hits.get(hit.id)?.score ?? 0
        return {
          ...hit,
          score:
            base +
            weight * this.standing(hit) +
            this.prior(hit) +
            (hit.kind === 'character' ? this.corroboration(hit.id) : 0),
          adult: this.adult(hit.id),
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 10)
  }
}
