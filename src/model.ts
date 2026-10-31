export type Kind = 'work' | 'character'

export type Layer = 'core' | 'kowiki' | 'unlicensed'

export const LAYERS: readonly Layer[] = ['core', 'kowiki', 'unlicensed']

export const USER_AGENT = 'aninames/0.1 (+https://github.com/kecan0406/aninames)'

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
  | 'tmdb'
  | 'igdb'
  | 'steam'
  | 'vndb'
  | 'bangumi'
  | 'danbooru'
  | 'kowiki'
  | 'anissia'

export type Ref = `${Namespace}:${string}`

export type Role = 'lead' | 'support' | 'minor'

export const ROLES: readonly Role[] = ['lead', 'support', 'minor']

export interface Name {
  text: string
  lang?: string
  kind: NameKind
}

export interface Entry {
  id: Ref
  kind?: Kind
  attach?: boolean
  family?: boolean
  refs?: Ref[]
  names: Name[]
  works?: Ref[]
  roles?: [work: Ref, role: Role][]
  series?: Ref[]
  within?: Ref[]
  basis?: Ref[]
  related?: Ref[]
  near?: Ref[]
  link?: string[]
  rank?: number
  adult?: boolean
  type?: string
  year?: number
  origin?: string[]
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
