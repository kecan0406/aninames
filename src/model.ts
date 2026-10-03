export type Kind = 'work' | 'character'

export type Layer = 'core' | 'kowiki' | 'unlicensed'

export const LAYERS: readonly Layer[] = ['core', 'kowiki', 'unlicensed']

export type NameKind = 'main' | 'official' | 'synonym' | 'short' | 'reading' | 'redirect' | 'section' | 'generated'

export type Namespace =
  | 'wikidata'
  | 'mal'
  | 'anilist'
  | 'anidb'
  | 'kitsu'
  | 'ann'
  | 'animeplanet'
  | 'anisearch'
  | 'livechart'
  | 'simkl'
  | 'animecountdown'
  | 'vndb'
  | 'bangumi'
  | 'danbooru'
  | 'kowiki'
  | 'anissia'

export type Ref = `${Namespace}:${string}`

export interface Name {
  text: string
  lang?: string
  kind: NameKind
}

export interface Entry {
  id: Ref
  kind?: Kind
  attach?: boolean
  refs?: Ref[]
  names: Name[]
  works?: Ref[]
  related?: Ref[]
  link?: string[]
  rank?: number
  adult?: boolean
  type?: string
  year?: number
}

export interface Source {
  name: string
  layer: Layer
  license: string
  fetch(raw: string): Promise<void>
  stage(raw: string): AsyncIterable<Entry> | Iterable<Entry>
}

export function ref(ns: Namespace, id: string | number): Ref {
  return `${ns}:${id}`
}
