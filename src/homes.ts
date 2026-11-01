import { ROLES } from './model.ts'

export const FLOOR = 0.8

const WEIGHTS = [3, 2, 1]

const UNKNOWN = 2

const HEAD = 3

export interface Appearance {
  weight: number
  tags: ReadonlyMap<string, number>
}

export interface Choice {
  tag: string
  most: boolean
}

export function weightOf(role: number | undefined): number {
  return role === undefined ? UNKNOWN : (WEIGHTS[role] ?? 1)
}

export function chosenOf(
  appearances: readonly Appearance[],
  fits: (tag: string) => boolean,
  posts: (tag: string) => number,
): Choice | undefined {
  const tagged = appearances.filter((appearance) => appearance.tags.size > 0)
  const total = tagged.reduce((sum, appearance) => sum + appearance.weight, 0)
  if (total === 0) return undefined
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const cover = new Map<string, { weight: number; count: number; level: number }>()
  for (const { weight, tags } of tagged) {
    for (const [tag, level] of tags) {
      const known = cover.get(tag)
      if (known) {
        known.weight += weight
        known.count++
        known.level = Math.min(known.level, level)
      } else cover.set(tag, { weight, count: 1, level })
    }
  }
  const found = [...cover]
  const most = found
    .filter(([tag, { weight }]) => weight * 2 > total && fits(tag))
    .sort(([a, x], [b, y]) => x.level - y.level || posts(b) - posts(a) || byName(a, b))[0]
  if (most) return { tag: most[0], most: true }
  const plural = found.sort(
    ([a, x], [b, y]) =>
      y.count - x.count ||
      Number(fits(b)) - Number(fits(a)) ||
      posts(b) - posts(a) ||
      x.level - y.level ||
      byName(a, b),
  )[0]
  return plural ? { tag: plural[0], most: false } : undefined
}

export function homeOf(
  choice: Choice | undefined,
  named: string | undefined,
  learned: string | undefined,
): string | undefined {
  if (choice?.most) return choice.tag
  return named ?? choice?.tag ?? learned
}

export function tierOf(
  roles: ReadonlyMap<string, number>,
  size: (work: string) => number | undefined,
  head: number,
): number {
  let best = ROLES.length - 1
  for (const [work, role] of roles) {
    const count = size(work)
    if (count === undefined) continue
    best = Math.min(best, role === 0 && count * HEAD < head ? 1 : role)
  }
  return best
}

export function learnedOf(votes: ReadonlyMap<string, ReadonlyMap<string, number>>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [qual, tags] of votes) {
    const total = [...tags.values()].reduce((sum, count) => sum + count, 0)
    const [tag, count] = [...tags].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? ['', 0]
    if (count >= 2 && count * 3 >= total * 2) out.set(qual, tag)
  }
  return out
}
