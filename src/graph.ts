import type { Entry } from './model.ts'
import { titleKey } from './text.ts'

export function tiesOf(entry: Entry): string[] {
  return [...(entry.within ?? []), ...(entry.basis ?? []), ...(entry.related ?? [])]
}

export function upward(entry: Entry): string[] {
  return [...(entry.within ?? []), ...(entry.basis ?? [])]
}

export function levelsOf(
  parents: ReadonlyMap<string, ReadonlySet<string>>,
  root: string,
  hops = 8,
): Map<string, number> {
  const levels = new Map([[root, 0]])
  let frontier = [root]
  for (let level = 1; level <= hops && frontier.length > 0; level++) {
    const next: string[] = []
    for (const at of frontier) {
      for (const up of parents.get(at) ?? []) {
        if (levels.has(up)) continue
        levels.set(up, level)
        next.push(up)
      }
    }
    frontier = next
  }
  return levels
}

const FILLER = new Set([
  'a',
  'an',
  'and',
  'animation',
  'chapter',
  'film',
  'final',
  'ga',
  'gekijouban',
  'movie',
  'new',
  'no',
  'of',
  'ona',
  'ova',
  'part',
  'recap',
  'season',
  'series',
  'special',
  'the',
  'to',
  'tv',
  'wa',
])

export function wordsOf(text: string): Set<string> {
  return new Set(
    titleKey(text)
      .split(' ')
      .filter((word) => word.length > 1 && !FILLER.has(word) && !/^(\d+|[ivx]+)$/.test(word)),
  )
}

export function alike(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const shorter = Math.min(a.size, b.size)
  if (shorter === 0) return false
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared * 2 >= shorter
}
