import type { Staged } from './build.ts'
import { tiesOf } from './graph.ts'
import { foldHan } from './han.ts'
import { flat, hasKanji, japanese, latinKey, qualifiers, titleKey } from './text.ts'
import { node, Union } from './union.ts'

export const BANGUMI = 'bangumi'

const ANIME_TYPES = new Set(['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'UNKNOWN'])

export const MEDIUM_ORDER = ['anime', 'vn', 'game', 'manga', 'novel'] as const

export type Medium = (typeof MEDIUM_ORDER)[number]

const MATCHED_AS: Partial<Record<Medium, Medium>> = { vn: 'game' }

const QUALIFIED_WORKS = 3

const HOPS = 2

const DOMINANT = 10

export function mediaOf(staged: Staged): Medium[] {
  const { entry, source } = staged
  const out: Medium[] = []
  if (source === 'aod' || source === 'anidb' || source === 'anissia') out.push('anime')
  if (source === 'vndb' && entry.id.startsWith('vndb:v')) out.push('vn')
  if (source === BANGUMI) {
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
    else if (ns === 'igdb' || ns === 'steam') out.push('game')
  }
  return out
}

export function workTitles(union: Union, staged: Staged[]): Map<string, Set<string>> {
  const titles = new Map<string, Set<string>>()
  for (const s of staged) {
    if (s.entry.attach || s.entry.kind !== 'work') continue
    const at = node('work', s.entry.id)
    if (!union.anchored(at)) continue
    const root = union.find(at)
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

export interface CharacterKey {
  key: string
  level: number
}

export function characterKey(text: string): CharacterKey | undefined {
  const base = qualifiers(text).base
  if (japanese(base)) {
    const key = foldHan(flat(base))
    const length = [...key].length
    if (length < 2) return undefined
    const named = (hasKanji(base) && length >= 3) || /[\s・·=＝]/u.test(base)
    return { key: `ja|${key}`, level: named ? 4 : length >= 5 ? 3 : length >= 3 ? 1 : 0 }
  }
  if (!/^[\p{Script=Latin}\s.'’-]+$/u.test(base.normalize('NFKD').replace(/\p{M}/gu, ''))) return undefined
  const tokens = latinKey(base)
    .split(' ')
    .filter((token) => token.length >= 2)
  if (tokens.length > 0 && tokens.join('').length >= 3) {
    return { key: `latin|${tokens.join(' ')}`, level: tokens.length < 2 ? 0 : 2 }
  }
  const joined = flat(base)
  return !/\s/.test(base) && /^[a-z]{3,}$/.test(joined) ? { key: `latin|${joined}`, level: 0 } : undefined
}

function titleOf(text: string, medium: Medium): string | undefined {
  const base = qualifiers(text).base
  if (!japanese(base)) return undefined
  const key = foldHan(flat(base))
  return [...key].length >= 2 ? `${medium}|${key}` : undefined
}

function close(a: ReadonlySet<number> | undefined, b: ReadonlySet<number> | undefined): boolean {
  if (!a?.size || !b?.size) return true
  return [...a].some((x) => [...b].some((y) => Math.abs(x - y) <= 1))
}

function remember(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0)

function attachWorks(union: Union, staged: Staged[]): number {
  const years = new Map<string, Set<number>>()
  const spine = new Map<string, Set<string>>()
  const bySource = new Map<string, Map<string, Set<string>>>()
  const keysOf = new Map<string, Map<string, string>>()
  for (const s of staged) {
    const { entry } = s
    if (entry.attach || entry.kind !== 'work') continue
    const root = union.find(node('work', entry.id))
    if (entry.year) {
      const set = years.get(root) ?? new Set<number>()
      set.add(entry.year)
      years.set(root, set)
    }
    const found = mediaOf(s)[0]
    if (!found) continue
    const medium = MATCHED_AS[found] ?? found
    for (const name of entry.names) {
      if (name.kind === 'reading' || name.kind === 'short') continue
      const key = titleOf(name.text, medium)
      if (!key) continue
      if (s.source === BANGUMI) {
        remember(spine, key, root)
        continue
      }
      const holders = bySource.get(s.source) ?? new Map<string, Set<string>>()
      remember(holders, key, root)
      bySource.set(s.source, holders)
      if (!union.anchored(root)) {
        const keys = keysOf.get(root) ?? new Map<string, string>()
        keys.set(key, s.source)
        keysOf.set(root, keys)
      }
    }
  }
  let attached = 0
  for (const [root, keys] of [...keysOf].sort(byKey)) {
    const targets = new Set<string>()
    for (const [key, source] of keys) {
      const near = (other: string) => close(years.get(root), years.get(other))
      const rivals = [...(bySource.get(source)?.get(key) ?? [])].filter((other) => other !== root && near(other))
      const found = [...(spine.get(key) ?? [])].filter(near)
      if (rivals.length === 0 && found.length === 1) targets.add(found[0] as string)
    }
    if (targets.size === 1 && union.union([...targets][0] as string, root)) attached++
  }
  return attached
}

interface Pending {
  keys: Map<string, number>
  scope: Set<string>
  known: boolean
  drawn: boolean
  plain: boolean
}

function attachCharacters(union: Union, staged: Staged[], titles: ReadonlyMap<string, ReadonlySet<string>>): number {
  const workOf = (ref: string) => {
    const key = node('work', ref)
    return union.has(key) && union.anchored(key) ? union.find(key) : undefined
  }
  const neighbours = new Map<string, Set<string>>()
  for (const s of staged) {
    if (s.source !== BANGUMI || s.entry.kind !== 'work' || s.entry.attach) continue
    const at = union.find(node('work', s.entry.id))
    for (const ref of [...tiesOf(s.entry), ...(s.entry.near ?? [])]) {
      const there = workOf(ref)
      if (!there || there === at) continue
      remember(neighbours, at, there)
      remember(neighbours, there, at)
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
  const together = (groups: ReadonlySet<string>[]) => {
    const [first, ...rest] = groups
    if (!first) return false
    const joined = new Set<string>()
    for (const work of first) for (const at of familyOf(work)) joined.add(at)
    const left = [...rest]
    for (let grew = true; grew && left.length > 0; ) {
      grew = false
      for (let at = left.length - 1; at >= 0; at--) {
        const group = left[at] as ReadonlySet<string>
        if (![...group].some((work) => joined.has(work))) continue
        for (const work of group) for (const other of familyOf(work)) joined.add(other)
        left.splice(at, 1)
        grew = true
      }
    }
    return left.length === 0
  }
  const holders = new Map<string, Set<string>>()
  const appears = new Map<string, Set<string>>()
  const ranks = new Map<string, number>()
  for (const s of staged) {
    if (s.source !== BANGUMI || s.entry.kind !== 'character' || s.entry.attach) continue
    const root = union.find(node('character', s.entry.id))
    ranks.set(root, Math.max(ranks.get(root) ?? 0, s.entry.rank ?? 0))
    for (const work of s.entry.works ?? []) {
      const there = workOf(work)
      if (there) remember(appears, root, there)
    }
    for (const name of s.entry.names) {
      if (name.kind === 'reading') continue
      const found = characterKey(name.text)
      if (found) remember(holders, found.key, root)
    }
  }
  const ranked = (named: Iterable<string>) =>
    [...named].sort((a, b) => (ranks.get(b) ?? 0) - (ranks.get(a) ?? 0) || (a < b ? -1 : 1))
  const chosen = (named: readonly string[], dominance: boolean) => {
    if (named.length === 1) return named[0]
    const [first, second] = ranked(named)
    if (together(named.map((at) => appears.get(at) ?? new Set<string>()))) return first
    const lead = ranks.get(first ?? '') ?? 0
    return dominance && lead >= DOMINANT && lead >= DOMINANT * (ranks.get(second ?? '') ?? 0) ? first : undefined
  }
  const pending = new Map<string, Pending>()
  for (const s of staged) {
    const { entry } = s
    if (s.source === BANGUMI || entry.kind !== 'character' || entry.attach) continue
    const root = union.find(node('character', entry.id))
    if (union.anchored(root)) continue
    const found = pending.get(root) ?? {
      keys: new Map<string, number>(),
      scope: new Set<string>(),
      known: false,
      drawn: false,
      plain: false,
    }
    pending.set(root, found)
    const widen = (work: string) => {
      for (const at of familyOf(work)) found.scope.add(at)
    }
    for (const work of entry.works ?? []) {
      found.known = true
      const there = workOf(work)
      if (there) widen(there)
    }
    if (s.source === 'danbooru') {
      found.drawn = true
      found.plain ||= qualifiers(entry.id.slice('danbooru:'.length).replace(/_/g, ' ')).quals.length === 0
      for (const tag of [entry.id, ...(entry.refs ?? [])]) {
        if (!tag.startsWith('danbooru:')) continue
        const quals = qualifiers(tag.slice('danbooru:'.length).replace(/_/g, ' ')).quals
        const works = quals.length === 1 ? [...(titles.get(titleKey(quals[0] ?? '')) ?? [])] : []
        if (works.length <= QUALIFIED_WORKS || together(works.map((work) => new Set([work])))) {
          for (const work of works) widen(work)
        }
      }
    }
    for (const name of entry.names) {
      if (name.kind === 'reading' || name.kind === 'short' || name.lang?.startsWith('zh')) continue
      const key = characterKey(name.text)
      if (key && key.level > (found.keys.get(key.key) ?? -1)) found.keys.set(key.key, key.level)
    }
  }
  let attached = 0
  for (const [root, { keys, scope, known, drawn, plain }] of [...pending].sort(byKey)) {
    if (scope.size === 0 && known && !drawn) continue
    const levels = new Map<number, { targets: Set<string>; unclear: boolean }>()
    for (const [key, level] of keys) {
      const named = [...(holders.get(key) ?? [])].filter(
        (at) => scope.size === 0 || [...(appears.get(at) ?? [])].some((work) => scope.has(work)),
      )
      if (named.length === 0) continue
      const found = levels.get(level) ?? { targets: new Set<string>(), unclear: false }
      const target = chosen(named, plain && scope.size === 0 && level >= 2)
      if (target === undefined) found.unclear = true
      else found.targets.add(target)
      levels.set(level, found)
    }
    const [top] = [...levels].sort((a, b) => b[0] - a[0])
    const targets = [...(top?.[1].targets ?? [])]
    const one = targets.length === 1 || together(targets.map((at) => appears.get(at) ?? new Set<string>()))
    const [target] = ranked(targets)
    if (one && target !== undefined && union.union(target, root)) attached++
  }
  return attached
}

export function link(staged: Staged[], hide = false): Union {
  const spine = new Set<string>()
  for (const s of staged) {
    if (s.source === BANGUMI && !s.entry.attach && s.entry.kind) spine.add(node(s.entry.kind, s.entry.id))
  }
  const union = new Union((key) => spine.has(key))
  for (const key of spine) union.add(key)
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
  console.log(`build: refused ${union.refused} id links that would join two Bangumi entries`)
  const works = attachWorks(union, staged)
  console.log(`build: attached ${works} works by a Japanese title only one Bangumi work of that medium and year has`)
  const characters = attachCharacters(union, staged, workTitles(union, staged))
  console.log(`build: attached ${characters} characters by a name only one Bangumi character in reach has`)
  return union
}
