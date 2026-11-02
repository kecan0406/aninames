import type { Staged } from './build.ts'
import { tiesOf } from './graph.ts'
import type { Nature } from './model.ts'
import { flat, japanese, qualifiers, titleKey, titleWords } from './text.ts'
import { node, type Union } from './union.ts'

const BANGUMI = 'bangumi'

const HUB = 200

const LATIN_TITLE = 4

const MARKS = /[∀√∞≡≠≒∽∇∴]/gu

const LEAST_LETTERS = 5

const MOST_STARTING = 100

const DOMINANT = 10

const OPEN_QUALIFIERS = new Set(['series', 'franchise'])

const NEAREST_HOPS = 2

export const MOST_GROUP = 60

const INHERITED = 2

export interface Family {
  works: string[]
  head: string | undefined
  reached: Set<string>
}

export interface WorkGraph {
  links: Map<string, Set<string>>
  titles: Map<string, Set<string>>
  families: Map<string, Family>
  named: Map<string, string[]>
  years: Map<string, number>
  natures: Map<string, Nature>
}

export function titleName(text: string): string {
  return `${flat(text)}${text.match(MARKS)?.join('') ?? ''}`
}

export function groupsOf(nodes: readonly string[], tied: (a: string, b: string) => boolean): string[][] {
  const parent = new Map(nodes.map((at) => [at, at]))
  const find = (at: string): string => {
    let root = at
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root)) root = next
    return root
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i] as string
      const b = nodes[j] as string
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb && tied(a, b)) parent.set(rb, ra)
    }
  }
  const groups = new Map<string, string[]>()
  for (const at of nodes) {
    const root = find(at)
    const group = groups.get(root)
    if (group) group.push(at)
    else groups.set(root, [at])
  }
  return [...groups.values()]
}

export function familyOf(
  groups: readonly string[][],
  anchors: ReadonlySet<string>,
  named: ReadonlySet<string> = new Set(),
): string[] {
  const anchored = groups.filter((group) => group.some((at) => anchors.has(at)))
  if (anchored.length > 0) return anchored.flat()
  const titled = groups.filter((group) => group.some((at) => named.has(at)))
  if (titled.length === 1) return titled[0] ?? []
  const [largest = [], second = []] = [...groups].sort((a, b) => b.length - a.length)
  if (groups.length <= 1) return largest
  const total = groups.reduce((sum, group) => sum + group.length, 0)
  return largest.length >= 2 && largest.length > second.length && largest.length * 2 > total ? largest : []
}

function meets(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined, keep = (_: string) => true) {
  if (!a || !b) return false
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const at of small) if (large.has(at) && keep(at)) return true
  return false
}

function remember(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

export function closure(links: ReadonlyMap<string, ReadonlySet<string>>, from: readonly string[]): Set<string> {
  const reached = new Set(from)
  for (const queue = [...from]; queue.length > 0; ) {
    for (const other of links.get(queue.pop() as string) ?? []) {
      if (reached.has(other)) continue
      reached.add(other)
      queue.push(other)
    }
  }
  for (const root of from) reached.delete(root)
  return reached
}

export function workNames(union: Union, staged: readonly Staged[]): Map<string, Set<string>> {
  const names = new Map<string, Set<string>>()
  for (const { entry } of staged) {
    if (entry.attach || entry.kind !== 'work') continue
    const at = node('work', entry.id)
    if (!union.anchored(at)) continue
    const root = union.find(at)
    for (const name of entry.names) {
      if (!japanese(name.text)) continue
      const key = titleName(name.text)
      if (key) remember(names, key, root)
    }
  }
  return names
}

export function workGraph(
  union: Union,
  staged: readonly Staged[],
  titles: Map<string, Set<string>>,
  names: ReadonlyMap<string, ReadonlySet<string>>,
): WorkGraph {
  const workRoot = (ref: string) => {
    const key = node('work', ref)
    return union.has(key) ? union.find(key) : undefined
  }
  const links = new Map<string, Set<string>>()
  const cast = new Map<string, Set<string>>()
  const casts = new Map<string, Set<string>>()
  const years = new Map<string, number>()
  for (const { source, entry } of staged) {
    if (entry.attach || !entry.kind) continue
    if (entry.kind === 'work') {
      const at = node('work', entry.id)
      if (!union.anchored(at)) continue
      const root = union.find(at)
      if (entry.year) years.set(root, Math.min(years.get(root) ?? Number.POSITIVE_INFINITY, entry.year))
      if (source !== BANGUMI) continue
      for (const other of tiesOf(entry)) {
        const there = workRoot(other)
        if (!there || there === root) continue
        remember(links, root, there)
        remember(links, there, root)
      }
    } else if (source === BANGUMI) {
      const person = union.find(node('character', entry.id))
      for (const work of entry.works ?? []) {
        const there = workRoot(work)
        if (!there) continue
        remember(cast, there, person)
        remember(casts, person, there)
      }
    }
  }
  const small = (person: string) => (casts.get(person)?.size ?? 0) <= HUB
  const tied = (a: string, b: string) =>
    (links.get(a)?.has(b) ?? false) || meets(links.get(a), links.get(b)) || meets(cast.get(a), cast.get(b), small)
  const titledBy = (text: string): ReadonlySet<string> => {
    if (japanese(text)) return names.get(titleName(text)) ?? new Set<string>()
    const key = titleKey(text)
    return (key.replace(/\s+/g, '').length >= LATIN_TITLE ? titles.get(key) : undefined) ?? new Set<string>()
  }
  const families = new Map<string, Family>()
  const named = new Map<string, string[]>()
  const natures = new Map<string, Nature>()
  for (const { entry } of staged) if (entry.nature) natures.set(entry.id, entry.nature)
  for (const { entry } of staged) {
    if (!entry.family) continue
    if (natures.has(entry.id)) {
      families.set(entry.id, { works: [], head: undefined, reached: new Set() })
      continue
    }
    const anchors = new Set<string>()
    const own = workRoot(entry.id)
    if (own && union.anchored(own)) anchors.add(own)
    const candidates = new Set(anchors)
    for (const text of entry.link ?? []) {
      for (const root of titledBy(text)) candidates.add(root)
      if (japanese(text)) continue
      for (const root of titles.get(titleKey(text)) ?? []) {
        if ([...anchors].some((anchor) => links.get(anchor)?.has(root))) candidates.add(root)
      }
    }
    const main = entry.names.filter((name) => name.kind === 'main').flatMap((name) => [...titledBy(name.text)])
    if (main.length > 0) named.set(entry.id, main)
    const works = familyOf(groupsOf([...candidates], tied), anchors, new Set(main))
    const year = (root: string) => years.get(root) ?? Number.POSITIVE_INFINITY
    const head =
      works.find((root) => anchors.has(root)) ??
      works.toSorted((a, b) => year(a) - year(b) || (a < b ? -1 : a > b ? 1 : 0))[0]
    families.set(entry.id, { works, head, reached: closure(links, works) })
  }
  return { links, titles, families, named, years, natures }
}

export function startsWith(title: readonly string[], words: readonly string[]): boolean {
  return words.every((word, at) => title[at] === word)
}

export function dominantOf(ranks: ReadonlyMap<string, number>): string[] {
  const top = Math.max(0, ...ranks.values())
  return [...ranks.keys()].filter((root) => (ranks.get(root) ?? 0) * DOMINANT >= top).sort()
}

export function attachByTitleStart(union: Union, staged: readonly Staged[], graph: WorkGraph): number {
  const starts = new Map<string, { words: string[]; root: string; rank: number }[]>()
  for (const { source, entry } of staged) {
    if (source !== BANGUMI || entry.attach || entry.kind !== 'work') continue
    const at = node('work', entry.id)
    if (!union.anchored(at)) continue
    const root = union.find(at)
    for (const name of entry.names) {
      if (name.kind === 'reading' || japanese(name.text)) continue
      const words = titleWords(name.text)
      const first = words[0]
      if (!first) continue
      const list = starts.get(first)
      const title = { words, root, rank: entry.rank ?? 0 }
      if (list) list.push(title)
      else starts.set(first, [title])
    }
  }
  let attached = 0
  for (const { entry } of staged) {
    if (!entry.family || graph.natures.has(entry.id)) continue
    const family = graph.families.get(entry.id)
    if (!family || family.works.length > 0) continue
    const { base, quals } = qualifiers(entry.id.slice(entry.id.indexOf(':') + 1).replace(/_/g, ' '))
    if (!quals.every((qual) => OPEN_QUALIFIERS.has(qual))) continue
    const words = titleWords(base)
    if (words.join('').length < LEAST_LETTERS) continue
    const found = new Map<string, number>()
    for (const title of starts.get(words[0] ?? '') ?? []) {
      if (startsWith(title.words, words)) found.set(title.root, Math.max(found.get(title.root) ?? 0, title.rank))
    }
    if (found.size === 0 || found.size > MOST_STARTING) continue
    const works = dominantOf(found)
    const year = (root: string) => graph.years.get(root) ?? Number.POSITIVE_INFINITY
    family.works = works
    family.head = works.toSorted((a, b) => year(a) - year(b))[0]
    for (const work of closure(graph.links, works)) family.reached.add(work)
    attached++
  }
  return attached
}

export interface KeyedWork {
  key: string
  year: number | undefined
  rank: number
  tag: string | undefined
  posts: number
}

export interface FamilyKey {
  key: string
  tier: number
}

function nearestTag(
  root: string,
  works: ReadonlyMap<string, KeyedWork>,
  links: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  const seen = new Set([root])
  let frontier = [root]
  for (let hop = 0; hop < NEAREST_HOPS; hop++) {
    const next: string[] = []
    for (const at of frontier) {
      for (const other of links.get(at) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
      }
    }
    const tagged = next.flatMap((at) => {
      const work = works.get(at)
      return work?.tag ? [work] : []
    })
    const [best] = tagged.sort((a, b) => b.posts - a.posts || ((a.tag ?? '') < (b.tag ?? '') ? -1 : 1))
    if (best) return best.tag
    frontier = next
  }
  return undefined
}

export function familyKeysOf(
  works: ReadonlyMap<string, KeyedWork>,
  links: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, FamilyKey> {
  const out = new Map<string, FamilyKey>()
  const free = new Set<string>()
  for (const [root, work] of works) {
    if (work.tag) continue
    const tag = nearestTag(root, works, links)
    if (tag) out.set(root, { key: tag, tier: INHERITED })
    else free.add(root)
  }
  const placed = new Set<string>()
  for (const start of free) {
    if (placed.has(start)) continue
    placed.add(start)
    const group = [start]
    for (let at = 0; at < group.length; at++) {
      for (const other of links.get(group[at] as string) ?? []) {
        if (!free.has(other) || placed.has(other)) continue
        placed.add(other)
        group.push(other)
      }
    }
    const year = (root: string) => works.get(root)?.year ?? Number.POSITIVE_INFINITY
    const rank = (root: string) => works.get(root)?.rank ?? 0
    const head = group.toSorted((a, b) => year(a) - year(b) || rank(b) - rank(a) || (a < b ? -1 : 1))[0] as string
    for (const root of group) {
      if (group.length > MOST_GROUP) out.set(root, { key: works.get(root)?.key ?? root, tier: 0 })
      else out.set(root, { key: works.get(head)?.key ?? head, tier: root === head ? 0 : 1 })
    }
  }
  return out
}
