import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const FILE = join(import.meta.dirname, '..', 'data', 'copyrights.json.gz')

const SURE_POSTS = 5

const OWNED = 0.8

const MAJOR = 0.5

const CONFIDENCE = 1.96

export interface Drawn {
  posts: number
  works: readonly (readonly [tag: string, posts: number])[]
}

export interface Copyrights {
  characters: ReadonlyMap<string, Drawn>
  sizes: ReadonlyMap<string, number>
}

export const NO_COPYRIGHTS: Copyrights = { characters: new Map(), sizes: new Map() }

export async function readCopyrights(path = FILE): Promise<Copyrights> {
  const raw = gunzipSync(new Uint8Array(await Bun.file(path).arrayBuffer()))
  const { characters, copyrights } = JSON.parse(new TextDecoder().decode(raw)) as {
    characters: Record<string, [number, [string, number][]]>
    copyrights: Record<string, number>
  }
  return {
    characters: new Map(Object.entries(characters).map(([tag, [posts, works]]) => [tag, { posts, works }])),
    sizes: new Map(Object.entries(copyrights)),
  }
}

export function drawnOf(tags: Iterable<string>, copyrights: Copyrights): Drawn | undefined {
  for (const tag of tags) {
    const drawn = copyrights.characters.get(tag)
    if (drawn) return drawn
  }
  return undefined
}

export function surely(count: number, posts: number, share: number): boolean {
  if (posts <= 0) return false
  const p = count / posts
  const z = CONFIDENCE
  const low =
    (p + (z * z) / (2 * posts) - z * Math.sqrt((p * (1 - p)) / posts + (z * z) / (4 * posts * posts))) /
    (1 + (z * z) / posts)
  return low >= share
}

export function majorsOf(drawn: Drawn): string[] {
  return drawn.works.flatMap(([tag, count]) => (surely(count, drawn.posts, MAJOR) ? [tag] : []))
}

export function closestWork(drawn: Drawn, sizes: ReadonlyMap<string, number>): string | undefined {
  if (majorsOf(drawn).length === 0) return undefined
  const cosine = (tag: string, count: number) => count / Math.sqrt(drawn.posts * Math.max(sizes.get(tag) ?? 0, count))
  return [...drawn.works].sort(([a, x], [b, y]) => cosine(b, y) - cosine(a, x) || (a < b ? -1 : a > b ? 1 : 0))[0]?.[0]
}

export function ownersOf(drawn: Drawn, home?: string): string[] {
  return drawn.works.flatMap(([tag, count]) => (tag !== home && surely(count, drawn.posts, OWNED) ? [tag] : []))
}

export function apart(a: Drawn, b: Drawn): boolean {
  if (a.posts < SURE_POSTS || b.posts < SURE_POSTS) return false
  const works = new Set(a.works.map(([tag]) => tag))
  return !b.works.some(([tag]) => works.has(tag))
}
