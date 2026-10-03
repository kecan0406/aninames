import { createReadStream } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createZstdDecompress } from 'node:zlib'
import { type Entry, type Name, type NameKind, type Ref, ref, type Source } from '../model.ts'
import { download, USER_AGENT } from '../net.ts'
import { hasHangul, hasKanji } from '../text.ts'

const BASE = 'https://dl.vndb.org/dump/'

const TABLES = [
  'vn',
  'vn_titles',
  'vn_extlinks',
  'extlinks',
  'releases',
  'releases_vn',
  'chars',
  'chars_names',
  'chars_alias',
  'chars_vns',
] as const

type Table = (typeof TABLES)[number]

const FILES = [
  'README.txt',
  'TIMESTAMP',
  'LICENSE-ODBL.txt',
  'LICENSE-DBCL.txt',
  ...TABLES.flatMap((table) => [`db/${table}`, `db/${table}.header`]),
]

const BLOCK = 512

const ROLE_WEIGHT: Record<string, number> = { primary: 1, main: 0.6, side: 0.2, appears: 0.05 }

const ESCAPES: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }

const LANGS: Record<string, string> = { 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', ta: 'tl', ck: 'chr' }

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

const INTERNED = new Map<string, string>()

interface Meta {
  dump: string
  timestamp: string
  files: string[]
  fetched: string
}

interface Title {
  lang: string
  official: boolean
  title: string
  latin: string
}

interface Spelling {
  lang: string
  name: string
  latin: string
}

interface Work {
  olang: string
  votes: number
  released: number
}

type Row<C extends readonly string[]> = { [K in keyof C]: string }

async function latest(): Promise<string> {
  const res = await fetch(BASE, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) {
    throw new Error(`aninames: ${BASE} answered ${res.status}`)
  }
  const dumps = [...(await res.text()).matchAll(/vndb-db-\d{4}-\d{2}-\d{2}\.tar\.zst/g)].map((match) => match[0]).sort()
  const dump = dumps.at(-1)
  if (!dump) {
    throw new Error(`aninames: ${BASE} lists no vndb-db-<date>.tar.zst dump`)
  }
  return dump
}

async function readMeta(raw: string): Promise<Meta | undefined> {
  const file = Bun.file(join(raw, 'meta.json'))
  return (await file.exists()) ? ((await file.json()) as Meta) : undefined
}

function text(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end))
}

function memberOf(header: Buffer): { name: string; size: number; file: boolean } {
  const name = text(header.subarray(0, 100))
  const prefix = text(header.subarray(257, 262)) === 'ustar' ? text(header.subarray(345, 500)) : ''
  const size = Number.parseInt(text(header.subarray(124, 136)).trim() || '0', 8)
  if (Number.isNaN(size)) {
    throw new Error(`aninames: the VNDB dump has a tar member ${name} with an unreadable size`)
  }
  const type = header[156]
  return {
    name: (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, ''),
    size,
    file: type === 0 || type === 0x30,
  }
}

async function extract(archive: string, into: string, wanted: ReadonlySet<string>): Promise<Set<string>> {
  const found = new Set<string>()
  let header = Buffer.alloc(0)
  let left = 0
  let pad = 0
  let target: string | undefined
  let parts: Buffer[] = []
  const finish = async (): Promise<void> => {
    if (target === undefined) return
    await mkdir(dirname(target), { recursive: true })
    await Bun.write(target, Buffer.concat(parts))
    target = undefined
    parts = []
  }
  for await (const chunk of createReadStream(archive).pipe(createZstdDecompress()) as AsyncIterable<Buffer>) {
    let at = 0
    while (at < chunk.length) {
      if (left > 0) {
        const take = Math.min(left, chunk.length - at)
        if (target !== undefined) parts.push(Buffer.from(chunk.subarray(at, at + take)))
        at += take
        left -= take
        if (left === 0) await finish()
        continue
      }
      if (pad > 0) {
        const take = Math.min(pad, chunk.length - at)
        at += take
        pad -= take
        continue
      }
      const take = Math.min(BLOCK - header.length, chunk.length - at)
      header = Buffer.concat([header, chunk.subarray(at, at + take)])
      at += take
      if (header.length < BLOCK) continue
      const block = header
      header = Buffer.alloc(0)
      if (block.every((byte) => byte === 0)) continue
      const member = memberOf(block)
      left = member.size
      pad = (BLOCK - (member.size % BLOCK)) % BLOCK
      if (member.file && wanted.has(member.name)) {
        found.add(member.name)
        target = join(into, member.name)
        if (left === 0) await finish()
      }
    }
  }
  return found
}

async function* lines(path: string): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of Bun.file(path).stream()) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split('\n')
    rest = parts.pop() ?? ''
    yield* parts
  }
  rest += decoder.decode()
  if (rest) yield rest
}

function value(field: string): string {
  if (field === '\\N') return ''
  return field.includes('\\') ? field.replace(/\\(.)/g, (_, code: string) => ESCAPES[code] ?? code) : field
}

async function* rows<const C extends readonly string[]>(raw: string, table: Table, columns: C): AsyncIterable<Row<C>> {
  const header = (await Bun.file(join(raw, 'db', `${table}.header`)).text()).trimEnd().split('\t')
  const at = columns.map((column) => {
    const index = header.indexOf(column)
    if (index < 0) {
      throw new Error(`aninames: VNDB table ${table} has no column ${column}; the dump's schema changed`)
    }
    return index
  })
  const last = Math.max(...at) + 1
  for await (const line of lines(join(raw, 'db', table))) {
    if (!line) continue
    const fields = line.split('\t', last)
    yield at.map((index) => value(fields[index] ?? '\\N')) as Row<C>
  }
}

function num(id: string): number {
  return Number(/^[a-z]/.test(id) ? id.slice(1) : id)
}

function interned(text: string): string {
  const known = INTERNED.get(text)
  if (known !== undefined) return known
  const flat = [...text].join('')
  INTERNED.set(flat, flat)
  return flat
}

async function group<T>(
  raw: string,
  table: Table,
  columns: readonly string[],
  read: (row: readonly string[]) => T | undefined,
): Promise<Map<number, T[]>> {
  const out = new Map<number, T[]>()
  for await (const row of rows(raw, table, columns)) {
    const item = read(row)
    if (item === undefined) continue
    const id = num(row[0] ?? '')
    const list = out.get(id)
    if (list) list.push(item)
    else out.set(id, [item])
  }
  return out
}

async function firstReleases(raw: string): Promise<{ first: Map<number, number>; youngest: Map<number, number> }> {
  const dates = new Map<number, number>()
  const ages = new Map<number, number>()
  for await (const [id, released, official, minage] of rows(raw, 'releases', [
    'id',
    'released',
    'official',
    'minage',
  ])) {
    if (official !== 't') continue
    if (released !== '0') dates.set(num(id), Number(released))
    if (minage && /^\d+$/.test(minage)) ages.set(num(id), Number(minage))
  }
  const first = new Map<number, number>()
  const youngest = new Map<number, number>()
  for await (const [id, vid, rtype] of rows(raw, 'releases_vn', ['id', 'vid', 'rtype'])) {
    if (rtype === 'trial') continue
    const age = ages.get(num(id))
    if (age !== undefined) youngest.set(num(vid), Math.min(youngest.get(num(vid)) ?? age, age))
    const date = dates.get(num(id))
    if (date === undefined) continue
    const known = first.get(num(vid))
    if (known === undefined || date < known) first.set(num(vid), date)
  }
  return { first, youngest }
}

async function wikidataLinks(raw: string): Promise<Map<number, Ref[]>> {
  const items = new Map<number, Ref>()
  for await (const [id, site, link] of rows(raw, 'extlinks', ['id', 'site', 'value'])) {
    const item = site === 'wikidata' ? /^Q?(\d+)$/.exec(link)?.[1] : undefined
    if (item) items.set(num(id), ref('wikidata', `Q${item}`))
  }
  return group(raw, 'vn_extlinks', ['id', 'link'], ([, link]) => items.get(num(link ?? '')))
}

function bcp(lang: string): string {
  return LANGS[lang] ?? lang
}

function spelled(text: string, lang: string): string {
  return lang === 'ja' && !JAPANESE.test(text) ? 'ja-Latn' : bcp(lang)
}

function scriptOf(text: string): string | undefined {
  if (hasHangul(text)) return 'ko'
  if (KANA.test(text)) return 'ja'
  return undefined
}

function namer(): { names: Name[]; add: (text: string, kind: NameKind, lang?: string) => void } {
  const names: Name[] = []
  const seen = new Set<string>()
  const texts = new Set<string>()
  return {
    names,
    add(raw, kind, lang) {
      const text = raw.trim()
      if (!text || seen.has(`${lang ?? ''}\t${text}`) || (lang === undefined && texts.has(text))) return
      seen.add(`${lang ?? ''}\t${text}`)
      texts.add(text)
      names.push(lang === undefined ? { text, kind } : { text, lang, kind })
    },
  }
}

function originalFirst<T extends { lang: string }>(list: readonly T[], lang: string): T[] {
  return [...list].sort((a, b) => Number(b.lang === lang) - Number(a.lang === lang))
}

function workNames(work: Work, titles: readonly Title[], alias: string): Name[] {
  const { names, add } = namer()
  for (const title of originalFirst(titles, work.olang)) {
    const latin = title.lang === 'ja' ? 'ja-Latn' : undefined
    if (title.lang === work.olang) {
      if (title.latin) add(title.latin, 'main', latin)
      add(title.title, 'main', spelled(title.title, title.lang))
      continue
    }
    add(title.title, title.official ? 'official' : 'synonym', spelled(title.title, title.lang))
    if (title.latin) add(title.latin, 'synonym', latin)
  }
  for (const text of alias.split('\n')) add(text, 'synonym', scriptOf(text))
  return names
}

function yearOf(released: number): number | undefined {
  const year = Math.floor(released / 10_000)
  return year > 0 && year < 9999 ? year : undefined
}

function workEntry(id: number, work: Work, titles: readonly Title[], alias: string, refs: readonly Ref[]): Entry {
  const entry: Entry = { id: ref('vndb', `v${id}`), kind: 'work', names: workNames(work, titles, alias) }
  if (refs.length > 0) entry.refs = [...new Set(refs)]
  entry.rank = work.votes
  entry.type = 'VN'
  const year = yearOf(work.released)
  if (year) entry.year = year
  return entry
}

function mainLang(spellings: readonly Spelling[], vids: readonly number[], works: ReadonlyMap<number, Work>): string {
  const ordered = vids
    .map((vid) => works.get(vid))
    .filter((work) => work !== undefined)
    .sort((a, b) => (a.released || Number.POSITIVE_INFINITY) - (b.released || Number.POSITIVE_INFINITY))
  const match = ordered.find((work) => spellings.some((spelling) => spelling.lang === work.olang))
  return match?.olang ?? spellings[0]?.lang ?? 'ja'
}

function characterNames(lang: string, spellings: readonly Spelling[], aliases: readonly Spelling[]): Name[] {
  const { names, add } = namer()
  for (const spelling of originalFirst(spellings, lang)) {
    const main = spelling.lang === lang
    if (spelling.latin) {
      add(spelling.latin, main ? 'main' : 'synonym', spelling.lang === 'ja' ? 'ja-Latn' : undefined)
      add(spelling.name, 'official', spelled(spelling.name, spelling.lang))
      continue
    }
    add(spelling.name, main ? 'main' : 'official', spelled(spelling.name, spelling.lang))
  }
  for (const alias of aliases) {
    add(alias.name, 'synonym', scriptOf(alias.name) ?? (lang === 'ja' && hasKanji(alias.name) ? 'ja' : undefined))
    if (alias.latin) add(alias.latin, 'synonym', lang === 'ja' ? 'ja-Latn' : undefined)
  }
  return names
}

async function* characters(raw: string, works: ReadonlyMap<number, Work>): AsyncIterable<Entry> {
  const roles = await group(raw, 'chars_vns', ['id', 'vid', 'role'], ([, vid, role]) => ({
    vid: num(vid ?? ''),
    weight: ROLE_WEIGHT[role ?? ''] ?? 0.3,
  }))
  const instances = await group(raw, 'chars', ['id', 'main', 'main_spoil'], ([, main, spoil]) =>
    main && /^c?\d+$/.test(main) && spoil === '0' ? num(main) : undefined,
  )
  const aliases = await group(raw, 'chars_alias', ['id', 'spoil', 'name', 'latin'], ([, spoil, name, latin]) =>
    spoil === '0' ? { lang: '', name: name ?? '', latin: latin ?? '' } : undefined,
  )
  const spellings = await group(raw, 'chars_names', ['id', 'lang', 'name', 'latin'], ([, lang, name, latin]) => ({
    lang: interned(lang ?? ''),
    name: name ?? '',
    latin: latin ?? '',
  }))
  for (const [id, own] of spellings) {
    const cast = roles.get(id) ?? []
    const vids = [...new Set(cast.map((each) => each.vid))]
    const lang = mainLang(own, vids, works)
    const entry: Entry = {
      id: ref('vndb', `c${id}`),
      kind: 'character',
      names: characterNames(lang, own, aliases.get(id) ?? []),
    }
    if (vids.length > 0) entry.works = vids.map((vid) => ref('vndb', `v${vid}`))
    const main = instances.get(id)?.[0]
    if (main !== undefined) entry.refs = [ref('vndb', `c${main}`)]
    entry.rank = Math.max(0, ...cast.map((each) => (works.get(each.vid)?.votes ?? 0) * each.weight))
    yield entry
  }
}

export default {
  name: 'vndb',
  layer: 'core',
  license: 'ODbL-1.0 AND DbCL-1.0',
  async fetch(raw) {
    const dump = await latest()
    const known = await readMeta(raw)
    if (known?.dump === dump && FILES.every((file) => known.files.includes(file))) return
    for (const stale of await readdir(raw)) {
      if (/^vndb-db-.*\.tar\.zst(\.part)?$/.test(stale) && stale !== dump) await rm(join(raw, stale))
    }
    const archive = join(raw, dump)
    if (!(await Bun.file(archive).exists())) await download(`${BASE}${dump}`, archive)
    const found = await extract(archive, raw, new Set(FILES))
    const missing = FILES.filter((file) => !found.has(file))
    if (missing.length > 0) {
      throw new Error(`aninames: ${dump} has no ${missing.join(', ')}; the dump's layout changed`)
    }
    const timestamp = (await Bun.file(join(raw, 'TIMESTAMP')).text()).trim()
    const meta: Meta = { dump, timestamp, files: FILES, fetched: new Date().toISOString() }
    await Bun.write(join(raw, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
    await rm(archive)
  },
  async *stage(raw) {
    if (!(await readMeta(raw))) {
      throw new Error(`aninames: ${join(raw, 'meta.json')} is missing; run fetch vndb first`)
    }
    const { first: released, youngest } = await firstReleases(raw)
    const wikidata = await wikidataLinks(raw)
    const titles = await group(raw, 'vn_titles', ['id', 'lang', 'official', 'title', 'latin'], (row) => {
      const [, lang = '', official, title = '', latin = ''] = row
      return { lang: interned(lang), official: official === 't', title, latin }
    })
    const works = new Map<number, Work>()
    for await (const [vid, olang, votes, alias] of rows(raw, 'vn', ['id', 'olang', 'c_votecount', 'alias'])) {
      const id = num(vid)
      const work: Work = { olang: interned(olang), votes: Number(votes), released: released.get(id) ?? 0 }
      works.set(id, work)
      const entry = workEntry(id, work, titles.get(id) ?? [], alias, wikidata.get(id) ?? [])
      if ((youngest.get(id) ?? 0) >= 18) entry.adult = true
      yield entry
    }
    yield* characters(raw, works)
  },
} satisfies Source
