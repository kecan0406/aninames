import { join } from 'node:path'
import { type Entry, type Ref, ref, type Source } from '../model.ts'
import { download, fresh } from '../net.ts'

const URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json'

const FILE = 'anime-list-full.json'

interface Row {
  anilist_id?: number
  mal_id?: number
  anidb_id?: number
  themoviedb_id?: { tv?: number; movie?: number }
}

function tmdbOf(row: Row): Ref | undefined {
  const { tv, movie } = row.themoviedb_id ?? {}
  return tv ? ref('tmdb', `tv/${tv}`) : movie ? ref('tmdb', `movie/${movie}`) : undefined
}

export function entryOf(row: Row): Entry | undefined {
  const id = tmdbOf(row)
  if (!id) return undefined
  const refs = [
    ...(row.anilist_id ? [ref('anilist', row.anilist_id)] : []),
    ...(row.mal_id ? [ref('mal', row.mal_id)] : []),
    ...(row.anidb_id ? [ref('anidb', row.anidb_id)] : []),
  ]
  return refs.length > 0 ? { id, kind: 'work', attach: true, refs, names: [] } : undefined
}

const source: Source = {
  name: 'fribb',
  layer: 'unlicensed',
  license: 'unstated (Fribb/anime-lists)',
  async fetch(raw) {
    const path = join(raw, FILE)
    if (await fresh(path, 7)) return
    await download(URL, path)
  },
  async *stage(raw) {
    const file = Bun.file(join(raw, FILE))
    if (!(await file.exists())) throw new Error(`aninames: ${join(raw, FILE)} is missing; run fetch fribb first`)
    for (const row of (await file.json()) as Row[]) {
      const entry = entryOf(row)
      if (entry) yield entry
    }
  },
}

export default source
