import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { type Entry, type Name, ref, type Source } from '../model.ts'
import { fresh, json, sleep } from '../net.ts'
import { hasHangul, hasKanji, qualifiers } from '../text.ts'

const HOST = (process.env.ANINAMES_DANBOORU ?? 'https://danbooru.donmai.us').replace(/\/+$/, '')

const MIN_POSTS = 5

const CHARACTER = 4

const PAGE = 1000

const PACE = 1000

const TRIES = 4

const DAYS = 7

const FILES = { tags: 'tags.json', aliases: 'aliases.json', wiki: 'wiki.json' } as const

type Part = keyof typeof FILES

interface Tag {
  name: string
  post_count: number
  is_deprecated: boolean
}

interface Meta {
  host: string
  date: string
  threshold: number
  counts: Record<Part, number>
  requests: number
}

interface Row {
  id: number
}

interface TagRow extends Row, Tag {}

interface AliasRow extends Row {
  antecedent_name: string
  consequent_name: string
}

interface WikiRow extends Row {
  title: string
  other_names: string[]
}

const QUERIES: Record<Part, { path: string; search: Record<string, string>; only: string }> = {
  tags: {
    path: '/tags.json',
    search: { 'search[category]': `${CHARACTER}`, 'search[post_count]': `>=${MIN_POSTS}` },
    only: 'id,name,post_count,is_deprecated',
  },
  aliases: {
    path: '/tag_aliases.json',
    search: {
      'search[status]': 'active',
      'search[consequent_tag][category]': `${CHARACTER}`,
      'search[consequent_tag][post_count]': `>=${MIN_POSTS}`,
    },
    only: 'id,antecedent_name,consequent_name',
  },
  wiki: {
    path: '/wiki_pages.json',
    search: {
      'search[is_deleted]': 'false',
      'search[other_names_present]': 'true',
      'search[tag][category]': `${CHARACTER}`,
      'search[tag][post_count]': `>=${MIN_POSTS}`,
    },
    only: 'id,title,other_names',
  },
}

let requests = 0

let last = 0

async function get<T>(url: string): Promise<T> {
  let failure: unknown
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const wait = last + PACE * attempt ** 2 - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    requests++
    try {
      return await json<T>(url)
    } catch (error) {
      failure = error
    }
  }
  const reason = failure instanceof Error ? failure.message.replace(/^aninames: /, '') : String(failure)
  throw new Error(
    `aninames: ${url} failed ${TRIES} times (${reason}); ANINAMES_DANBOORU can name another Danbooru host`,
  )
}

async function* pages<T extends Row>(part: Part): AsyncIterable<T[]> {
  const query = QUERIES[part]
  let after = 0
  for (;;) {
    const params = new URLSearchParams({ ...query.search, only: query.only, limit: `${PAGE}`, page: `a${after}` })
    const rows = await get<T[]>(`${HOST}${query.path}?${params}`)
    if (rows.length === 0) return
    yield rows
    if (rows.length < PAGE) return
    after = Math.max(...rows.map((row) => row.id))
  }
}

async function save(path: string, value: unknown): Promise<void> {
  await Bun.write(`${path}.part`, `${JSON.stringify(value)}\n`)
  await rename(`${path}.part`, path)
}

async function collect<T extends Row>(part: Part, keep: (row: T) => void): Promise<void> {
  let count = 0
  let page = 0
  for await (const rows of pages<T>(part)) {
    for (const row of rows) keep(row)
    count += rows.length
    page++
    if (page % 10 === 0) console.log(`danbooru ${part}: ${count} after ${page} pages`)
  }
  console.log(`danbooru ${part}: ${count} in ${page} pages`)
}

const FETCHERS: Record<Part, () => Promise<unknown>> = {
  async tags() {
    const tags: Tag[] = []
    await collect<TagRow>('tags', (row) =>
      tags.push({ name: row.name, post_count: row.post_count, is_deprecated: row.is_deprecated }),
    )
    return tags.sort((a, b) => b.post_count - a.post_count || a.name.localeCompare(b.name))
  },
  async aliases() {
    const aliases = new Map<string, string>()
    await collect<AliasRow>('aliases', (row) => aliases.set(row.antecedent_name, row.consequent_name))
    return Object.fromEntries([...aliases].sort(([a], [b]) => a.localeCompare(b)))
  },
  async wiki() {
    const wiki = new Map<string, string[]>()
    await collect<WikiRow>('wiki', (row) => wiki.set(row.title, row.other_names))
    return Object.fromEntries([...wiki].sort(([a], [b]) => a.localeCompare(b)))
  },
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : Object.keys(value as object).length
}

async function read<T>(raw: string, part: Part): Promise<T> {
  const file = Bun.file(join(raw, FILES[part]))
  if (!(await file.exists())) {
    throw new Error(`aninames: ${join(raw, FILES[part])} is missing; run fetch danbooru first`)
  }
  return (await file.json()) as T
}

function display(text: string): string {
  return text.replace(/_+/g, ' ').trim()
}

function hasKana(text: string): boolean {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
}

function langOf(text: string): string | undefined {
  if (hasHangul(text)) return 'ko'
  if (hasKana(text)) return 'ja'
  return undefined
}

const JOINED =
  /[×✕✖⨯]|users入り|\d+users|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]x[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\/|^www\.|\.(com|net|org|jp|cn|kr)(\/|$)/i

function usable(text: string): boolean {
  return text.length > 0 && !JOINED.test(qualifiers(text).base) && !ADDRESS.test(text)
}

function baseOf(tag: string): string {
  return qualifiers(display(tag)).base.toLowerCase()
}

function ownersOf(wiki: Map<string, string[]>): Map<string, string[]> {
  const owners = new Map<string, string[]>()
  for (const [title, others] of wiki) {
    for (const text of new Set(others.map(display))) {
      const list = owners.get(text)
      if (list) list.push(title)
      else owners.set(text, [title])
    }
  }
  return owners
}

function entryOf(tag: Tag, synonyms: string[], others: string[], owners: Map<string, string[]>): Entry {
  const seen = new Set<string>()
  const names: Name[] = []
  const add = (text: string, kind: Name['kind']) => {
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    const lang = langOf(text)
    names.push(lang ? { text, lang, kind } : { text, kind })
  }
  add(display(tag.name), 'main')
  for (const synonym of synonyms) add(display(synonym), 'synonym')
  const base = baseOf(tag.name)
  const link: string[] = []
  for (const other of others) {
    const text = display(other)
    const shared = owners.get(text) ?? []
    if (!usable(text) || shared.some((owner) => baseOf(owner) !== base)) continue
    add(text, 'synonym')
    if (shared.length <= 1 && (hasKana(text) || hasKanji(text)) && !link.includes(text)) link.push(text)
  }
  const entry: Entry = { id: ref('danbooru', tag.name), kind: 'character', names, rank: tag.post_count }
  if (synonyms.length > 0) entry.refs = synonyms.map((synonym) => ref('danbooru', synonym))
  if (link.length > 0) entry.link = link
  return entry
}

export default {
  name: 'danbooru',
  layer: 'unlicensed',
  license: 'unstated (Danbooru API)',
  async fetch(raw) {
    const meta = Bun.file(join(raw, 'meta.json'))
    const known = (await meta.exists()) ? ((await meta.json()) as Meta) : undefined
    const stale: Part[] = []
    for (const part of Object.keys(FILES) as Part[]) {
      if (known?.threshold !== MIN_POSTS || !(await fresh(join(raw, FILES[part]), DAYS))) stale.push(part)
    }
    if (stale.length === 0) {
      console.log(`danbooru: raw files are under ${DAYS} days old; delete them to fetch again`)
      return
    }
    requests = 0
    const counts = { ...known?.counts } as Record<Part, number>
    for (const part of stale) {
      const value = await FETCHERS[part]()
      await save(join(raw, FILES[part]), value)
      counts[part] = countOf(value)
    }
    const next: Meta = { host: HOST, date: new Date().toISOString(), threshold: MIN_POSTS, counts, requests }
    await save(join(raw, 'meta.json'), next)
    console.log(
      `danbooru: ${counts.tags} character tags with ${MIN_POSTS}+ posts, ${counts.aliases} aliases, ${counts.wiki} wiki pages with other names; ${requests} requests to ${HOST}`,
    )
  },
  async *stage(raw) {
    const tags = await read<Tag[]>(raw, 'tags')
    const aliases = await read<Record<string, string>>(raw, 'aliases')
    const wiki = new Map(Object.entries(await read<Record<string, string[]>>(raw, 'wiki')))
    const synonyms = new Map<string, string[]>()
    for (const [antecedent, consequent] of Object.entries(aliases)) {
      const list = synonyms.get(consequent)
      if (list) list.push(antecedent)
      else synonyms.set(consequent, [antecedent])
    }
    const owners = ownersOf(wiki)
    for (const tag of tags) {
      if (tag.is_deprecated) continue
      yield entryOf(tag, (synonyms.get(tag.name) ?? []).sort(), wiki.get(tag.name) ?? [], owners)
    }
  },
} satisfies Source
