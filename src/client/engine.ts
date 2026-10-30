import { swapLayout, TOP, typing } from '../match.ts'
import type { Kind } from '../model.ts'
import { editDistance, flat, latinKey, partKey, qualifiers, soundKeys } from '../text.ts'
import type { View } from './chunks.ts'
import { ADULT, CHARACTER, type EntityRow, type KeyRow, type KeyTable, MAIN } from './format.ts'

export interface Hit {
  eid: number
  kind: Kind
  score: number
  matched: string
  how: string
  rank: number
  standing: number
  extra: number
  adult: boolean
  mask: number
}

const SEEDS = 8
const FAMILY = 16
const PEOPLE = 10
const SPANS = 2
const RADIUS = 1

function hitOf(row: KeyRow, score: number, how: string): Hit {
  const flags = row[3]
  return {
    eid: row[1],
    kind: flags & CHARACTER ? 'character' : 'work',
    score,
    matched: row[0],
    how,
    rank: row[4],
    standing: row[5],
    extra: row[6],
    adult: (flags & ADULT) !== 0,
    mask: flags & ~(CHARACTER | MAIN | ADULT),
  }
}

function keeper(kind?: Kind): ((row: KeyRow) => boolean) | undefined {
  if (!kind) return undefined
  const character = kind === 'character'
  return (row) => ((row[3] & CHARACTER) !== 0) === character
}

function candidates(view: View, query: string, kind?: Kind): Map<number, Hit> {
  const hits = new Map<number, Hit>()
  const keep = keeper(kind)
  const consider = (row: KeyRow, base: number, how: string) => {
    if (keep && !keep(row)) return
    const score = base * (row[2] / 1000)
    const current = hits.get(row[1])
    if (!current || current.score < score) hits.set(row[1], hitOf(row, score, how))
  }
  const exact = (table: KeyTable, key: string) => view.keys(table, { low: key, high: key, ...(keep ? { keep } : {}) })
  const prefix = (table: KeyTable, low: string, high: string) =>
    view.keys(table, { low, high, open: true, limit: 3000, spans: SPANS, ...(keep ? { keep } : {}) })
  const q = flat(query)
  if (!q) return hits
  for (const row of exact('flat', q)) consider(row, 100, 'exact')
  const latin = latinKey(query)
  if (latin && /[a-z]/.test(latin)) for (const row of exact('latin', latin)) consider(row, 95, 'latin')
  if (/^[ㄱ-ㅎ\s]+$/.test(query.trim())) {
    const key = query.replace(/\s+/g, '')
    for (const row of exact('initial', key)) consider(row, 86, 'initials')
    for (const row of prefix('initial', key, `${key}${TOP}`))
      consider(row, 60 + 20 * ([...key].length / [...row[0]].length), 'initials prefix')
  }
  if (!/\s/.test(query.trim())) {
    for (const row of exact('part', partKey(query)))
      consider(row, row[3] & CHARACTER && row[3] & MAIN ? 92 : 84, 'part')
  }
  for (const key of /[ㄱ-ㅎㅏ-ㅣᄀ-ᇿ]/.test(query) ? [] : soundKeys(qualifiers(query).base)) {
    for (const row of exact('sound', key)) consider(row, 82, 'sound')
  }
  const length = [...q].length
  for (const [low, high] of typing(q)) {
    for (const row of prefix('flat', low, high))
      consider(row, 60 + 25 * (length / [...row[0]].length), low === q ? 'prefix' : 'typing')
  }
  return hits
}

function fuzzy(view: View, query: string, kind?: Kind): Map<number, Hit> {
  const hits = new Map<number, Hit>()
  const q = flat(query)
  const chars = [...q]
  if (chars.length < 4) return hits
  const limit = chars.length >= 8 ? 2 : 1
  const keep = keeper(kind)
  for (const row of view.around('flat', q, RADIUS)) {
    if (keep && !keep(row)) continue
    const name = [...row[0]]
    let score = 0
    const whole = editDistance(q, row[0], limit)
    if (whole <= limit) score = 92 - 10 * whole
    else if (name.length > chars.length) {
      const lead = editDistance(q, name.slice(0, chars.length).join(''), limit)
      if (lead <= limit) score = 72 - 10 * lead
    }
    if (score === 0) continue
    score *= row[2] / 1000
    const current = hits.get(row[1])
    if (!current || current.score < score) hits.set(row[1], hitOf(row, score, 'typo'))
  }
  return hits
}

function reach(view: View, hit: Hit): number[] {
  return [...new Set(view.entity(hit.eid, hit.mask).flatMap((row) => row.reach))]
}

function named(rows: EntityRow[], text: string): boolean {
  return rows.some((row) => row.names.some((name) => name.flat.includes(text)))
}

function family(view: View, hits: Map<number, Hit>, query: string): void {
  const wanted = flat(query)
  const seeds = [...hits.values()]
    .filter((hit) => hit.kind === 'work' && hit.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEEDS)
  for (const seed of seeds) {
    const score = seed.score * 0.97
    const matched = flat(seed.matched)
    for (const other of reach(view, seed).slice(0, FAMILY)) {
      const current = hits.get(other)
      if (current && current.score >= score) continue
      const rows = view.entity(other)
      const row = rows[0]
      if (!row || (!named(rows, wanted) && !named(rows, matched))) continue
      hits.set(other, {
        eid: other,
        kind: 'work',
        score,
        matched: seed.matched,
        how: `family(${seed.how})`,
        rank: row.rank,
        standing: row.standing,
        extra: row.extra,
        adult: row.adult,
        mask: 0,
      })
    }
  }
}

function scoped(view: View, query: string): Map<number, Hit> {
  const hits = new Map<number, Hit>()
  const tokens = query.normalize('NFKC').split(/\s+/).filter(Boolean)
  for (let cut = 1; cut < tokens.length; cut++) {
    for (const [who, where] of [
      [tokens.slice(0, cut), tokens.slice(cut)],
      [tokens.slice(cut), tokens.slice(0, cut)],
    ] as const) {
      const before = view.wanted.size
      const people = [...candidates(view, who.join(' '), 'character').values()]
        .filter((h) => h.score >= 80)
        .sort((a, b) => b.score - a.score)
        .slice(0, PEOPLE)
      if (people.length === 0) continue
      const series = flat(where.join(' '))
      const matched = [...candidates(view, where.join(' '), 'work').values()]
        .filter((h) => h.score >= 50)
        .sort((a, b) => b.score - a.score)
      if (view.wanted.size > before) continue
      const works = new Set(matched.map((h) => h.eid))
      for (const hit of matched.slice(0, 20)) for (const other of reach(view, hit)) works.add(other)
      for (const person of people) {
        const rows = view.entity(person.eid, person.mask)
        const linked = rows.some((row) => row.works.some(([eid]) => works.has(eid)))
        const qualified = rows.some((row) =>
          row.names.some((name) => {
            if (!name.qual) return false
            const q = flat(name.qual)
            return q.startsWith(series) || series.startsWith(q)
          }),
        )
        if (!linked && !qualified) continue
        const score = 90 + person.score / 10
        const current = hits.get(person.eid)
        if (!current || current.score < score)
          hits.set(person.eid, { ...person, score, how: linked ? 'scoped-work' : 'scoped-qual' })
      }
    }
  }
  return hits
}

export interface Options {
  kind?: Kind
  limit?: number
  adult?: boolean
}

export function search(view: View, query: string, options: Options = {}): Hit[] | undefined {
  const { kind } = options
  const hits = candidates(view, query, kind)
  const swapped = swapLayout(query)
  if (swapped) candidates(view, swapped, kind)
  fuzzy(view, query, kind)
  if (!kind || kind === 'character') {
    const tokens = query.normalize('NFKC').split(/\s+/).filter(Boolean)
    for (let cut = 1; cut < tokens.length; cut++) {
      for (const part of [tokens.slice(0, cut), tokens.slice(cut)]) {
        candidates(view, part.join(' '), 'character')
        candidates(view, part.join(' '), 'work')
      }
    }
  }
  if (view.wanted.size > 0) return undefined
  if (!kind || kind === 'character') {
    for (const [eid, hit] of scoped(view, query)) {
      const current = hits.get(eid)
      if (!current || current.score < hit.score) hits.set(eid, hit)
    }
  }
  if (!kind || kind === 'work') family(view, hits, query)
  if (view.wanted.size > 0) return undefined
  const merge = (more: Map<number, Hit>, factor: number, how?: string) => {
    for (const [eid, hit] of more) {
      const score = hit.score * factor
      const current = hits.get(eid)
      if (!current || current.score < score) hits.set(eid, { ...hit, score, how: how ? `${how}(${hit.how})` : hit.how })
    }
  }
  let best = Math.max(0, ...[...hits.values()].map((h) => h.score))
  if (best < 90 && swapped) {
    merge(candidates(view, swapped, kind), 0.95, 'layout')
    best = Math.max(0, ...[...hits.values()].map((h) => h.score))
  }
  if (best < 95) merge(fuzzy(view, query, kind), 1)
  if (view.wanted.size > 0) return undefined
  const prior = (hit: Hit) => (hit.kind === 'work' ? hit.extra : 0)
  const first = [...hits.values()]
    .map((hit) => ({ ...hit, score: hit.score + (15 * hit.rank) / 1000 + prior(hit) }))
    .sort((a, b) => b.score - a.score)
    .filter((hit) => options.adult !== false || !hit.adult)
    .slice(0, 60)
  const weight = /\s/.test(query.trim()) ? 15 : 25
  return first
    .map((hit) => ({ ...hit, score: (hits.get(hit.eid)?.score ?? 0) + (weight * hit.standing) / 1000 + hit.extra }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 10)
}
