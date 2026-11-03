import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const AUTHORITY_DIR = join(import.meta.dirname, '..', 'authority', 'works')

export interface AuthorityArt {
  tmdb?: string
  anilist?: number
  steam?: string
  igdb?: string
  bangumi?: number
  picture?: string
}

export interface AuthorityCharacter {
  id: string
  native?: string[]
  danbooru?: string
  also?: string[]
  sites?: Record<string, string[]>
  anilist?: number
  bangumi?: number
  person?: string
  picture?: string
}

export interface AuthorityWork {
  id: string
  name: string
  native?: string
  danbooru?: string
  lead?: string
  art?: AuthorityArt
  characters: AuthorityCharacter[]
}

const WORK_KEYS = new Set(['name', 'native', 'danbooru', 'lead', 'art', 'character'])

const ART_KEYS = new Set(['tmdb', 'anilist', 'steam', 'igdb', 'bangumi', 'picture'])

const CHARACTER_KEYS = new Set(['id', 'native', 'danbooru', 'also', 'sites', 'anilist', 'bangumi', 'person', 'picture'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const SLUG_MOST = 40

const TAG = /^\S{1,200}$/

const TMDB = /^(?:tv|movie)\/\d+$/

const STEAM = /^[1-9]\d*$/

const IGDB = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/

const HTTPS = /^https:\/\/[^\s"]+$/

function table(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function textOf(file: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`aninames: ${file}: ${field} must be text`)
  return value
}

function numberOf(file: string, field: string, value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`aninames: ${file}: ${field} must be a positive whole number`)
  }
  return value as number
}

function matching(file: string, field: string, value: unknown, shape: RegExp): string {
  const text = textOf(file, field, value)
  if (!shape.test(text)) throw new Error(`aninames: ${file}: ${field} is not in the form ${shape}`)
  return text
}

function slugOf(file: string, field: string, value: unknown): string {
  const slug = matching(file, field, value, SLUG)
  if (slug.length > SLUG_MOST) throw new Error(`aninames: ${file}: ${field} is longer than ${SLUG_MOST} characters`)
  return slug
}

function known(file: string, at: string, doc: Record<string, unknown>, keys: ReadonlySet<string>): void {
  for (const key of Object.keys(doc)) {
    if (!keys.has(key)) throw new Error(`aninames: ${file}: ${at}${key} is not a key this file takes`)
  }
}

function sitesOf(file: string, field: string, value: unknown): Record<string, string[]> {
  const sites: Record<string, string[]> = {}
  for (const [site, tags] of Object.entries(table(value))) {
    const list = typeof tags === 'string' ? [tags] : Array.isArray(tags) ? tags : undefined
    if (!list) throw new Error(`aninames: ${file}: ${field}.${site} must be one tag or a list of tags`)
    sites[site] = list.map((tag, at) => matching(file, `${field}.${site}[${at}]`, tag, TAG))
  }
  return sites
}

function artOf(file: string, value: unknown): AuthorityArt {
  const art = table(value)
  known(file, 'art.', art, ART_KEYS)
  return {
    ...(art.tmdb === undefined ? {} : { tmdb: matching(file, 'art.tmdb', art.tmdb, TMDB) }),
    ...(art.anilist === undefined ? {} : { anilist: numberOf(file, 'art.anilist', art.anilist) }),
    ...(art.steam === undefined ? {} : { steam: matching(file, 'art.steam', art.steam, STEAM) }),
    ...(art.igdb === undefined ? {} : { igdb: matching(file, 'art.igdb', art.igdb, IGDB) }),
    ...(art.bangumi === undefined ? {} : { bangumi: numberOf(file, 'art.bangumi', art.bangumi) }),
    ...(art.picture === undefined ? {} : { picture: matching(file, 'art.picture', art.picture, HTTPS) }),
  }
}

function characterOf(file: string, at: number, value: unknown): AuthorityCharacter {
  const c = table(value)
  const field = `character[${at}]`
  known(file, `${field}.`, c, CHARACTER_KEYS)
  const native = c.native === undefined ? undefined : c.native
  if (native !== undefined && (!Array.isArray(native) || native.length === 0)) {
    throw new Error(`aninames: ${file}: ${field}.native must be a list of names`)
  }
  return {
    id: slugOf(file, `${field}.id`, c.id),
    ...(native ? { native: (native as unknown[]).map((name, i) => textOf(file, `${field}.native[${i}]`, name)) } : {}),
    ...(c.danbooru === undefined ? {} : { danbooru: matching(file, `${field}.danbooru`, c.danbooru, TAG) }),
    ...(c.also === undefined
      ? {}
      : { also: (c.also as unknown[]).map((work, i) => slugOf(file, `${field}.also[${i}]`, work)) }),
    ...(c.sites === undefined ? {} : { sites: sitesOf(file, `${field}.sites`, c.sites) }),
    ...(c.anilist === undefined ? {} : { anilist: numberOf(file, `${field}.anilist`, c.anilist) }),
    ...(c.bangumi === undefined ? {} : { bangumi: numberOf(file, `${field}.bangumi`, c.bangumi) }),
    ...(c.person === undefined ? {} : { person: textOf(file, `${field}.person`, c.person) }),
    ...(c.picture === undefined ? {} : { picture: matching(file, `${field}.picture`, c.picture, HTTPS) }),
  }
}

export function readWork(file: string, source: string): AuthorityWork {
  const id = slugOf(file, 'its name', basename(file, '.toml'))
  const doc = table(Bun.TOML.parse(source))
  known(file, '', doc, WORK_KEYS)
  const list = doc.character === undefined ? [] : doc.character
  if (!Array.isArray(list)) throw new Error(`aninames: ${file}: character must be [[character]] tables`)
  const art = doc.art === undefined ? undefined : artOf(file, doc.art)
  return {
    id,
    name: textOf(file, 'name', doc.name),
    ...(doc.native === undefined ? {} : { native: textOf(file, 'native', doc.native) }),
    ...(doc.danbooru === undefined ? {} : { danbooru: matching(file, 'danbooru', doc.danbooru, TAG) }),
    ...(doc.lead === undefined ? {} : { lead: textOf(file, 'lead', doc.lead) }),
    ...(art ? { art } : {}),
    characters: list.map((raw, at) => characterOf(file, at, raw)),
  }
}

function withoutQualifiers(tag: string): string {
  return tag.replace(/_\([^)]*\)/g, '')
}

function fullName(tag: string): string {
  return withoutQualifiers(tag)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MOST)
    .replace(/^-+|-+$/g, '')
}

export function authorityProblems(works: readonly AuthorityWork[]): string[] {
  const ids = new Set(works.map((work) => work.id))
  const tags = new Map<string, string>()
  const problems: string[] = []
  const hold = (tag: string | undefined, subject: string) => {
    if (tag === undefined) return
    const held = tags.get(tag)
    if (held !== undefined) problems.push(`${subject}: danbooru "${tag}" is ${held} already`)
    else tags.set(tag, subject)
  }
  for (const work of works) {
    hold(work.danbooru, work.id)
    const cast = new Set<string>()
    for (const character of work.characters) {
      const subject = `${work.id}/${character.id}`
      if (cast.has(character.id)) problems.push(`${subject}: listed twice`)
      cast.add(character.id)
      if (character.danbooru !== undefined && fullName(character.danbooru) !== character.id) {
        problems.push(`${subject}: its id must be its danbooru tag's full name, "${fullName(character.danbooru)}"`)
      }
      for (const other of character.also ?? []) {
        if (other === work.id || !ids.has(other)) problems.push(`${subject}: also names "${other}", no other work`)
      }
      hold(character.danbooru, subject)
    }
    if (work.lead !== undefined) {
      const [owner, character] = work.lead.split('/')
      if (owner !== work.id || (character !== undefined && !cast.has(character))) {
        problems.push(`${work.id}: lead "${work.lead}" names neither it nor one of its characters`)
      }
    }
  }
  return problems
}

export function readAuthority(dir = AUTHORITY_DIR): AuthorityWork[] {
  const works = readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => {
      if (!name.endsWith('.toml')) throw new Error(`aninames: authority/works/ holds only <work>.toml files: ${name}`)
      return readWork(name, readFileSync(join(dir, name), 'utf8'))
    })
  const problems = authorityProblems(works)
  if (problems.length > 0) {
    throw new Error(`aninames: the authority does not hold together:\n  ${problems.join('\n  ')}`)
  }
  return works
}

export function writeAuthority(path: string, dir = AUTHORITY_DIR): number {
  const works = readAuthority(dir)
  writeFileSync(path, `${JSON.stringify({ works })}\n`)
  return works.length
}
