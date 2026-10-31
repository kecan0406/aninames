import type { Staged } from './build.ts'
import { tiesOf } from './graph.ts'
import { foldHan } from './han.ts'
import type { Ref } from './model.ts'
import { flat, hasKanji, japanese, latinKey, qualifiers, titleKey } from './text.ts'
import { node, type Union } from './union.ts'

export function workTitles(union: Union, staged: Staged[]): Map<string, Set<string>> {
  const titles = new Map<string, Set<string>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== 'work') continue
    const root = union.find(node('work', s.entry.id))
    for (const name of s.entry.names) {
      if (japanese(name.text)) continue
      const key = titleKey(name.text)
      if (key.length < 3) continue
      const roots = titles.get(key) ?? new Set<string>()
      roots.add(root)
      titles.set(key, roots)
    }
  }
  return titles
}

type Script = 'ja' | 'latin'

interface CharacterKey {
  key: string
  loose: boolean
  short: boolean
  script: Script
}

export function characterKey(text: string): CharacterKey | undefined {
  const base = qualifiers(text).base
  if (japanese(base)) {
    const key = foldHan(flat(base))
    const length = [...key].length
    const full = length >= 5 || (hasKanji(base) && length >= 3) || /[\s・·=＝]/u.test(base)
    return length >= 2 ? { key: `ja|${key}`, loose: length < 3, short: !full, script: 'ja' } : undefined
  }
  if (!/^[\p{Script=Latin}\s.'’-]+$/u.test(base.normalize('NFKD').replace(/\p{M}/gu, ''))) return undefined
  const tokens = latinKey(base)
    .split(' ')
    .filter((token) => token.length >= 2)
  if (tokens.length > 0 && tokens.join('').length >= 3) {
    return { key: `latin|${tokens.join(' ')}`, loose: tokens.length < 2, short: false, script: 'latin' }
  }
  const joined = flat(base)
  return !/\s/.test(base) && /^[a-z]{3,}$/.test(joined)
    ? { key: `latin|${joined}`, loose: true, short: false, script: 'latin' }
    : undefined
}

export type Relation = 'same' | 'family' | 'unknown' | 'disjoint'

const NAME: Record<Script, readonly number[]> = { ja: [2, 4, 6], latin: [2, 3, 5] }

const LOOSE = 1

const SHORT: readonly number[] = [1, 2, 3]

const WORKS: Record<Relation, number> = { same: 4, family: 2, unknown: 0, disjoint: -2 }

const CONTRADICTION = -4

export const ACCEPT = 3

export const FORM = 7

export const VETO = -3

export function keyScore(script: Script, loose: boolean, short: boolean, strong: number): number {
  if (loose) return LOOSE
  return (short ? SHORT[strong] : NAME[script][strong]) ?? 0
}

export function pairScore(ja: number, latin: number, relation: Relation, named: boolean, differ: boolean): number {
  let score = ja + latin + WORKS[relation]
  if (relation === 'disjoint' && named) score += CONTRADICTION
  if (differ && ja < (NAME.ja[1] ?? 0)) score += CONTRADICTION
  return score
}

interface Holder {
  node: string
  source: string
  strong: boolean
}

interface Root {
  sources: Set<string>
  works: Set<string>
  hinted: Set<string>
  named: boolean
  primary: Set<string>
  danbooru: boolean
}

interface Pair {
  a: string
  b: string
  ja: number
  latin: number
  freed: boolean
  unique: boolean
}

const HOLDERS = 60

const HOPS = 2

function aliased(entry: Staged['entry'], text: string): boolean {
  const tag: Ref = `danbooru:${text.replace(/ /g, '_')}`
  return entry.refs?.includes(tag) ?? false
}

export function mergeCharacters(
  union: Union,
  staged: Staged[],
  titles: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  const roots = new Map<string, Root>()
  const rootOf = (key: string): Root => {
    let found = roots.get(key)
    if (!found) {
      found = {
        sources: new Set(),
        works: new Set(),
        hinted: new Set(),
        named: false,
        primary: new Set(),
        danbooru: true,
      }
      roots.set(key, found)
    }
    return found
  }
  const neighbours = new Map<string, Set<string>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== 'work') continue
    const at = union.find(node('work', s.entry.id))
    for (const ref of [...tiesOf(s.entry), ...(s.entry.near ?? [])]) {
      const key = node('work', ref)
      if (!union.has(key)) continue
      const there = union.find(key)
      if (there === at) continue
      for (const [from, to] of [
        [at, there],
        [there, at],
      ] as const) {
        const set = neighbours.get(from) ?? new Set<string>()
        set.add(to)
        neighbours.set(from, set)
      }
    }
  }
  const reach = new Map<string, Set<string>>()
  const familyOf = (work: string) => {
    let found = reach.get(work)
    if (found) return found
    found = new Set([work])
    let frontier = [work]
    for (let hop = 0; hop < HOPS; hop++) {
      const next: string[] = []
      for (const at of frontier)
        for (const other of neighbours.get(at) ?? [])
          if (!found.has(other)) {
            found.add(other)
            next.push(other)
          }
      frontier = next
    }
    reach.set(work, found)
    return found
  }
  const index = new Map<string, { loose: boolean; short: boolean; script: Script; holders: Holder[] }>()
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || entry.kind !== 'character') continue
    const self = node('character', entry.id)
    const root = rootOf(union.find(self))
    root.sources.add(s.source)
    if (s.source !== 'danbooru') root.danbooru = false
    for (const work of entry.works ?? []) {
      const key = node('work', work)
      if (union.has(key)) root.works.add(union.find(key))
    }
    if (s.source === 'danbooru') {
      const quals = qualifiers(entry.id.slice('danbooru:'.length).replace(/_/g, ' ')).quals
      if (quals.length > 1) continue
      for (const qual of quals) {
        const found = titles.get(titleKey(qual))
        if (!found) continue
        for (const work of found) (found.size > 3 ? root.hinted : root.works).add(work)
        root.named = true
      }
    }
    const strongest = new Map<string, CharacterKey & { strong: boolean }>()
    for (const name of entry.names) {
      if (name.kind === 'reading' || name.kind === 'short') continue
      const found = characterKey(name.text)
      if (!found) continue
      const chinese = name.lang?.startsWith('zh') ?? false
      const primary = name.kind === 'main' || name.kind === 'official'
      if (primary && !chinese && found.script === 'latin' && !found.loose) root.primary.add(found.key)
      const strong =
        !chinese &&
        (primary ||
          (s.source === 'danbooru' && (japanese(name.text) || (found.script === 'latin' && aliased(entry, name.text)))))
      const known = strongest.get(found.key)
      if (!known || (strong && !known.strong)) strongest.set(found.key, { ...found, strong })
    }
    for (const found of strongest.values()) {
      const group = index.get(found.key) ?? {
        loose: found.loose,
        short: found.short,
        script: found.script,
        holders: [],
      }
      group.holders.push({ node: self, source: s.source, strong: found.strong })
      index.set(found.key, group)
    }
  }
  const works = (at: string) => roots.get(at)?.works ?? new Set<string>()
  const relations = new Map<string, Relation>()
  const relationOf = (a: string, b: string): Relation => {
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
    let found = relations.get(key)
    if (found) return found
    const wa = works(a)
    const wb = works(b)
    const ha = roots.get(a)?.hinted ?? new Set<string>()
    const hb = roots.get(b)?.hinted ?? new Set<string>()
    const meets = (x: ReadonlySet<string>, y: ReadonlySet<string>) =>
      [...x].some((work) => y.has(work) || [...familyOf(work)].some((other) => y.has(other)))
    if (wa.size > 0 && wb.size > 0) {
      if ([...wa].some((work) => wb.has(work))) found = 'same'
      else found = meets(wa, wb) ? 'family' : 'disjoint'
    } else if (wa.size === 0 && ha.size > 0 && wb.size > 0) found = meets(ha, wb) ? 'family' : 'disjoint'
    else if (wb.size === 0 && hb.size > 0 && wa.size > 0) found = meets(hb, wa) ? 'family' : 'disjoint'
    else found = 'unknown'
    relations.set(key, found)
    return found
  }
  const pairs = new Map<string, Pair>()
  for (const { loose, short, script, holders } of index.values()) {
    if (holders.length > HOLDERS || new Set(holders.map((h) => h.source)).size < 2) continue
    const bySource = new Map<string, Set<string>>()
    for (const holder of holders) {
      const set = bySource.get(holder.source) ?? new Set<string>()
      set.add(union.find(holder.node))
      bySource.set(holder.source, set)
    }
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const x = holders[i] as Holder
        const y = holders[j] as Holder
        if (x.source === y.source) continue
        const a = union.find(x.node)
        const b = union.find(y.node)
        if (a === b) continue
        const score = keyScore(script, loose, short, Number(x.strong) + Number(y.strong))
        const relation = relationOf(a, b)
        const rivals =
          [...(bySource.get(x.source) ?? [])].some((r) => r !== a && relationOf(r, b) !== 'disjoint') ||
          [...(bySource.get(y.source) ?? [])].some((r) => r !== b && relationOf(r, a) !== 'disjoint')
        const unique = (bySource.get(x.source)?.size ?? 0) === 1 && (bySource.get(y.source)?.size ?? 0) === 1
        const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
        const pair = pairs.get(key) ?? { a, b, ja: 0, latin: 0, freed: false, unique: false }
        if (script === 'ja') pair.ja = Math.max(pair.ja, score)
        else pair.latin = Math.max(pair.latin, score)
        if (!rivals && (relation === 'same' || relation === 'family')) pair.freed = true
        if (unique && !loose && (x.strong || y.strong)) pair.unique = true
        pairs.set(key, pair)
      }
    }
  }
  const edges: { a: string; b: string; score: number }[] = []
  const vetoed = new Map<string, Set<string>>()
  for (const pair of pairs.values()) {
    const relation = relationOf(pair.a, pair.b)
    const ra = roots.get(pair.a)
    const rb = roots.get(pair.b)
    const named = (ra?.named ?? false) || (rb?.named ?? false)
    const differ =
      (ra?.primary.size ?? 0) > 0 &&
      (rb?.primary.size ?? 0) > 0 &&
      ![...(ra?.primary ?? [])].some((key) => rb?.primary.has(key))
    const score = pairScore(pair.ja, pair.latin, relation, named, differ)
    if (score <= VETO) {
      for (const [from, to] of [
        [pair.a, pair.b],
        [pair.b, pair.a],
      ] as const) {
        const set = vetoed.get(from) ?? new Set<string>()
        set.add(to)
        vetoed.set(from, set)
      }
    }
    const allowed = relation === 'same' || relation === 'family' ? pair.freed : pair.unique
    if (allowed && score >= ACCEPT) edges.push({ a: pair.a, b: pair.b, score })
  }
  const refuses = (a: string, b: string) =>
    [...(vetoed.get(a) ?? [])].some((other) => union.find(other) === b) ||
    [...(vetoed.get(b) ?? [])].some((other) => union.find(other) === a)
  edges.sort((p, q) => q.score - p.score || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1))
  let merged = 0
  for (const edge of edges) {
    const a = union.find(edge.a)
    const b = union.find(edge.b)
    if (a === b) continue
    const ra = rootOf(a)
    const rb = rootOf(b)
    const shared = [...ra.sources].filter((source) => rb.sources.has(source))
    const form =
      shared.length === 1 &&
      shared[0] === 'danbooru' &&
      (ra.danbooru || rb.danbooru) &&
      edge.score >= FORM &&
      relationOf(a, b) !== 'disjoint'
    if ((shared.length > 0 && !form) || refuses(a, b)) continue
    if (!union.union(a, b)) continue
    const root = union.find(a)
    vetoed.set(root, new Set([...(vetoed.get(a) ?? []), ...(vetoed.get(b) ?? [])]))
    const joined: Root = {
      sources: new Set([...ra.sources, ...rb.sources]),
      works: new Set([...ra.works, ...rb.works]),
      hinted: new Set([...ra.hinted, ...rb.hinted]),
      named: ra.named || rb.named,
      primary: new Set([...ra.primary, ...rb.primary]),
      danbooru: ra.danbooru && rb.danbooru,
    }
    roots.set(root, joined)
    merged++
  }
  return merged
}
