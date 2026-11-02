import type { Staged } from './build.ts'
import { apart, type Copyrights, type Drawn, majorsOf, NO_COPYRIGHTS, ownersOf } from './copyrights.ts'
import { closure, type WorkGraph, workGraph, workNames } from './families.ts'
import { tiesOf } from './graph.ts'
import { foldHan } from './han.ts'
import type { Entry } from './model.ts'
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

const LEARNED_VOTES = 2

const LEARNED_SHARE = 0.1

const KIN_LEVEL = 2

const LATIN_TITLE = 4

const PART_WORKS = 40

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
  copyrights: Drawn[]
  named: Set<string>
  tags: string[]
}

const DANBOORU = 'danbooru:'

function attachCharacters(union: Union, staged: Staged[], graph: WorkGraph, copyrights: Copyrights): number {
  const { titles, families } = graph
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
  const primary = new Map<string, Set<string>>()
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
      if (!found) continue
      remember(holders, found.key, root)
      if (name.kind === 'main' || name.kind === 'official') remember(primary, found.key, root)
    }
  }
  const ranked = (named: Iterable<string>) =>
    [...named].sort((a, b) => (ranks.get(b) ?? 0) - (ranks.get(a) ?? 0) || (a < b ? -1 : 1))
  const chosen = (key: string, named: readonly string[], scoped: boolean, dominance: boolean) => {
    if (named.length === 1) return named[0]
    const main = scoped ? named.filter((at) => primary.get(key)?.has(at)) : []
    if (main.length === 1) return main[0]
    const [first, second] = ranked(named)
    if (together(named.map((at) => appears.get(at) ?? new Set<string>()))) return first
    const lead = ranks.get(first ?? '') ?? 0
    return dominance && lead >= DOMINANT && lead >= DOMINANT * (ranks.get(second ?? '') ?? 0) ? first : undefined
  }
  const pending = new Map<string, Pending>()
  const held = new Map<string, Drawn[]>()
  const hold = (at: string, drawn: readonly Drawn[]) => held.set(at, [...(held.get(at) ?? []), ...drawn])
  const drawnBy = (entry: Entry) =>
    [entry.id, ...(entry.refs ?? [])].flatMap((ref) => {
      const drawn = ref.startsWith(DANBOORU) ? copyrights.characters.get(ref.slice(DANBOORU.length)) : undefined
      return drawn ? [drawn] : []
    })
  for (const s of staged) {
    const { entry } = s
    if (s.source === BANGUMI || entry.kind !== 'character' || entry.attach) continue
    const root = union.find(node('character', entry.id))
    if (union.anchored(root)) {
      if (s.source === 'danbooru') hold(root, drawnBy(entry))
      continue
    }
    const found = pending.get(root) ?? {
      keys: new Map<string, number>(),
      scope: new Set<string>(),
      known: false,
      drawn: false,
      plain: false,
      copyrights: [],
      named: new Set<string>(),
      tags: [],
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
      found.tags.push(entry.id.slice(DANBOORU.length))
      found.copyrights.push(...drawnBy(entry))
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
      if (key && s.source === 'danbooru' && name.kind === 'main') found.named.add(key.key)
    }
  }
  let attached = 0
  let separate = 0
  const postsOf = (found: Pending) => Math.max(0, ...found.copyrights.map((drawn) => drawn.posts))
  const inOrder = [...pending].sort((a, b) => postsOf(b[1]) - postsOf(a[1]) || byKey(a, b))
  const appearing = (at: string) => appears.get(at) ?? new Set<string>()
  const kinOf = (key: string, target: string) => {
    const mains = primary.get(key)
    const alike = mains?.has(target) ? mains : (holders.get(key) ?? new Set<string>())
    return ranked([...alike].filter((at) => together([appearing(at), appearing(target)])))[0] ?? target
  }
  const pick = (
    { keys, plain, named: mains }: Pending,
    scoped: boolean,
    within: (work: string) => boolean,
  ): string | null | undefined => {
    const levels = new Map<number, Map<string, string[]>>()
    for (const [key, level] of keys) {
      const body = key.slice(key.indexOf('|') + 1)
      if (level >= KIN_LEVEL && [...mains].some((main) => main !== key && main.includes(body) && !holders.has(main)))
        continue
      const named = [...(holders.get(key) ?? [])].filter((at) => !scoped || [...appearing(at)].some(within))
      if (named.length === 0) continue
      const found = levels.get(level) ?? new Map<string, string[]>()
      levels.set(level, found)
      const target = chosen(key, named, scoped, plain && !scoped && level >= 2)
      if (target === undefined) continue
      const kin = scoped && level >= KIN_LEVEL ? kinOf(key, target) : target
      found.set(kin, [...(found.get(kin) ?? []), key])
    }
    if (levels.size === 0) return null
    const top = [...levels].sort((a, b) => b[0] - a[0])[0]?.[1] ?? new Map<string, string[]>()
    const targets = [...top.keys()]
    if (targets.length > 1 && !together(targets.map(appearing))) return undefined
    const narrower = (key: string, at: string) =>
      targets.some(
        (other) =>
          other !== at &&
          top.get(other)?.some((long) => long !== key && long.includes(key.slice(key.indexOf('|') + 1))),
      )
    return ranked(targets.filter((at) => top.get(at)?.some((key) => !narrower(key, at))))[0]
  }
  const place = (root: string, found: Pending, target: string | null | undefined) => {
    if (!target) return
    if (found.copyrights.some((a) => (held.get(target) ?? []).some((b) => apart(a, b)))) {
      separate++
      return
    }
    if (union.union(target, root)) {
      attached++
      hold(target, found.copyrights)
    }
  }
  const direct = new Map<string, Set<string>>()
  const reached = new Map<string, Set<string>>()
  const worksOf = (tag: string) => {
    let found = direct.get(tag)
    if (!found) {
      found = new Set(families.get(`${DANBOORU}${tag}`)?.works ?? [])
      direct.set(tag, found)
    }
    return found
  }
  const reachOf = (tag: string) => {
    let found = reached.get(tag)
    if (!found) {
      const family = families.get(`${DANBOORU}${tag}`)
      found = new Set(family ? [...family.works, ...family.reached] : [])
      reached.set(tag, found)
    }
    return found
  }
  const inAny = (sets: readonly ReadonlySet<string>[]) => (work: string) => sets.some((set) => set.has(work))
  const majors = (found: Pending) => [...new Set(found.copyrights.flatMap(majorsOf))]
  const inherited = (found: Pending): string | null | undefined => {
    const tags = majors(found)
    for (const tag of found.tags) {
      const parts = /^(.+?)((?:_\([^)]*\))+)$/.exec(tag)
      if (!parts) continue
      const quals = (parts[2] ?? '').match(/_\([^)]*\)/g) ?? []
      const base = `${parts[1]}${quals.length >= 2 ? quals.slice(1).join('') : ''}`
      const key = node('character', `${DANBOORU}${base}`)
      if (!union.has(key) || !union.anchored(key)) continue
      const drawn = copyrights.characters.get(base)
      if (quals.length < 2 && !(drawn && majorsOf(drawn).some((at) => tags.includes(at)))) continue
      const known = pending.get(key)?.keys
      const keys = new Map([...found.keys].filter(([name]) => !known?.has(name)))
      const own = keys.size > 0 ? pick({ ...found, keys }, true, inAny(tags.map(reachOf))) : null
      return own === null ? union.find(key) : own
    }
    return null
  }
  for (const [root, found] of inOrder) {
    if (union.anchored(root)) continue
    const parent = inherited(found)
    if (parent !== null) {
      place(root, found, parent)
      continue
    }
    const tags = majors(found)
    let target = tags.length > 0 ? pick(found, true, inAny(tags.map(worksOf))) : null
    if (target === null && found.scope.size > 0) target = pick(found, true, (work) => found.scope.has(work))
    if (target === null && tags.length > 0) target = pick(found, true, inAny(tags.map(reachOf)))
    if (target === null && found.scope.size === 0 && (!found.known || found.drawn)) {
      target = pick(found, false, () => true)
    }
    place(root, found, target)
  }
  const learned = learnedReach(held, appears)
  const people = new Map<string, Set<string>>()
  for (const [person, works] of appears) for (const work of works) remember(people, work, person)
  const words = new Map<string, string[][]>()
  for (const [key, at] of holders) {
    if (!key.startsWith('latin|')) continue
    for (const person of at) words.set(person, [...(words.get(person) ?? []), key.slice('latin|'.length).split(' ')])
  }
  const among = (mine: readonly string[], theirs: readonly string[]) => mine.every((word) => theirs.includes(word))
  const partly = ({ keys }: Pending, sets: readonly ReadonlySet<string>[]) => {
    const mine = [...keys.keys()].filter((key) => key.startsWith('latin|')).map((key) => key.slice(6).split(' '))
    const named = new Set<string>()
    for (const set of sets) {
      if (set.size > PART_WORKS) continue
      for (const work of set) {
        for (const person of people.get(work) ?? []) {
          if (words.get(person)?.some((theirs) => mine.some((each) => each.length >= 2 && among(each, theirs)))) {
            named.add(person)
          }
        }
      }
    }
    return named.size === 1 ? [...named][0] : undefined
  }
  for (const [root, found] of inOrder) {
    if (union.anchored(root)) continue
    const parent = inherited(found)
    if (parent !== null) {
      place(root, found, parent)
      continue
    }
    const tags = majors(found)
    const sets = tags.flatMap((tag) => {
      const votes = reachOf(tag).size > 0 ? undefined : learned.get(tag)
      return votes ? [new Set(votes.keys())] : []
    })
    const target = sets.length > 0 ? pick(found, true, inAny(sets)) : null
    if (target) {
      place(root, found, target)
      continue
    }
    const all = [...tags.map(reachOf), ...sets].filter((set) => set.size > 0)
    if (target === null && all.length > 0) place(root, found, partly(found, all))
  }
  headsOf(union, graph, learned, staged)
  console.log(`build: kept ${separate} tags off a character whose other tags are drawn in other works`)
  return attached
}

function learnedReach(
  held: ReadonlyMap<string, readonly Drawn[]>,
  appears: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Map<string, number>> {
  const votes = new Map<string, Map<string, number>>()
  const members = new Map<string, number>()
  for (const [person, drawn] of held) {
    const tags = new Set(drawn.flatMap((each) => ownersOf(each)))
    for (const tag of tags) {
      members.set(tag, (members.get(tag) ?? 0) + 1)
      const works = votes.get(tag) ?? new Map<string, number>()
      for (const work of appears.get(person) ?? []) works.set(work, (works.get(work) ?? 0) + 1)
      votes.set(tag, works)
    }
  }
  const out = new Map<string, Map<string, number>>()
  for (const [tag, works] of votes) {
    const least = Math.max(LEARNED_VOTES, LEARNED_SHARE * (members.get(tag) ?? 0))
    const kept = [...works].filter(([, count]) => count >= least)
    if (kept.length > 0) out.set(tag, new Map(kept))
  }
  return out
}

function headsOf(
  union: Union,
  graph: WorkGraph,
  learned: ReadonlyMap<string, ReadonlyMap<string, number>>,
  staged: Staged[],
): void {
  const media = new Map<string, Medium>()
  const titled = new Map<string, string[]>()
  const links = new Map<string, readonly string[]>()
  for (const s of staged) {
    if (s.entry.family) links.set(s.entry.id, s.entry.link ?? [])
    if (s.source !== BANGUMI || s.entry.kind !== 'work' || s.entry.attach) continue
    const at = union.find(node('work', s.entry.id))
    const found = mediaOf(s)[0]
    if (found) media.set(at, MATCHED_AS[found] ?? found)
    titled.set(
      at,
      s.entry.names.filter((name) => name.kind !== 'reading').map((name) => flat(name.text)),
    )
  }
  const year = (work: string) => graph.years.get(work) ?? Number.POSITIVE_INFINITY
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const earliest = (works: readonly string[]) => works.toSorted((a, b) => year(a) - year(b) || byName(a, b))[0]
  for (const [id, family] of graph.families) {
    const votes = learned.get(id.slice(DANBOORU.length))
    if (family.works.length > 0 || !votes?.size) continue
    const counts = new Map<Medium, number>()
    for (const work of votes.keys()) {
      const medium = media.get(work)
      if (medium) counts.set(medium, (counts.get(medium) ?? 0) + 1)
    }
    const [usual] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
    const words = (links.get(id) ?? [])
      .map((text) => flat(text))
      .filter((word) => [...word].length >= (japanese(word) ? 2 : LATIN_TITLE))
    const named = [...votes.keys()].filter((work) =>
      titled.get(work)?.some((title) => words.some((word) => title.includes(word))),
    )
    const exact = graph.named.get(id) ?? []
    const head =
      earliest(exact.filter((work) => votes.has(work))) ??
      earliest(exact.filter((work) => media.get(work) === usual)) ??
      named.toSorted((a, b) => (votes.get(b) ?? 0) - (votes.get(a) ?? 0) || year(a) - year(b) || byName(a, b))[0]
    family.reached = new Set(votes.keys())
    if (!head) continue
    family.works = [head]
    family.head = head
    for (const work of closure(graph.links, [head])) family.reached.add(work)
    family.reached.delete(head)
  }
}

export function link(
  staged: Staged[],
  hide = false,
  copyrights: Copyrights = NO_COPYRIGHTS,
): { union: Union; graph: WorkGraph } {
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
  const graph = workGraph(union, staged, workTitles(union, staged), workNames(union, staged))
  const characters = attachCharacters(union, staged, graph, copyrights)
  console.log(`build: attached ${characters} characters by a name only one Bangumi character in reach has`)
  return { union, graph }
}
