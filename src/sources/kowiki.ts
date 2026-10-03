import { join } from 'node:path'
import { type Entry, type Name, ref, type Source } from '../model.ts'
import { download, fresh } from '../net.ts'
import { hasHangul, isKana } from '../text.ts'
import { castPairs } from './cast.ts'

const BASE = 'https://dumps.wikimedia.org/kowiki/latest'

const TABLES = ['page', 'redirect', 'page_props'] as const

type Table = (typeof TABLES)[number]

const FRESH_DAYS = 7

const MAX_HOPS = 4

const QUOTE = 0x27
const BACKSLASH = 0x5c
const COMMA = 0x2c
const OPEN = 0x28
const CLOSE = 0x29
const SEMICOLON = 0x3b
const SPACE = 0x20

const OUTSIDE = 0
const BETWEEN = 1
const FIELD = 2
const QUOTED = 3
const ESCAPED = 4
const CLOSED = 5
const BARE = 6

const UNESCAPE = Uint8Array.from({ length: 256 }, (_, byte) => byte)
for (const [from, to] of [
  ['0', 0x00],
  ['b', 0x08],
  ['n', 0x0a],
  ['r', 0x0d],
  ['t', 0x09],
  ['Z', 0x1a],
] as const) {
  UNESCAPE[from.charCodeAt(0)] = to
}

type Row<C extends readonly string[]> = { [K in keyof C]: string }

interface Scanner {
  feed(chunk: Uint8Array): void
  done(): number
}

function fileOf(raw: string, table: Table): string {
  return join(raw, `${table}.sql.gz`)
}

function columnsOf(statement: string): string[] {
  return [...statement.matchAll(/^\s*`([^`]+)`/gm)].map((match) => match[1] ?? '')
}

function scanner<C extends readonly string[]>(
  table: Table,
  wanted: C,
  where: Record<string, string>,
  emit: (row: Row<C>) => void,
): Scanner {
  const decoder = new TextDecoder()
  const insert = `INSERT INTO \`${table}\` VALUES`
  let mode = OUTSIDE
  let statement: number[] = []
  let slots: Int32Array | undefined
  let musts: (string | undefined)[] = []
  let width = 0
  let field = 0
  let keep = false
  let skip = false
  let values: string[] = []
  let bytes = new Uint8Array(4096)
  let size = 0
  let rows = 0

  const needed = (at: number): boolean => !skip && ((slots?.[at] ?? -1) >= 0 || musts[at] !== undefined)

  const put = (byte: number): void => {
    if (!keep) return
    if (size === bytes.length) {
      const grown = new Uint8Array(bytes.length * 2)
      grown.set(bytes)
      bytes = grown
    }
    bytes[size++] = byte
  }

  const begin = (): void => {
    if (!slots) {
      throw new Error(`aninames: the kowiki ${table} dump has rows before its CREATE TABLE`)
    }
    mode = FIELD
    field = 0
    skip = false
    keep = needed(0)
    values = new Array<string>(wanted.length).fill('')
    size = 0
  }

  const end = (bare: boolean): void => {
    if (keep) {
      const decoded = decoder.decode(bytes.subarray(0, size))
      const text = bare && decoded === 'NULL' ? '' : decoded
      const must = musts[field]
      if (must !== undefined && text !== must) skip = true
      const slot = slots?.[field] ?? -1
      if (slot >= 0) values[slot] = text
    }
    field++
    keep = needed(field)
    size = 0
    mode = FIELD
  }

  const finish = (): void => {
    if (field !== width) {
      throw new Error(`aninames: a kowiki ${table} row has ${field} fields where its CREATE TABLE has ${width}`)
    }
    if (!skip) {
      emit(values as unknown as Row<C>)
      rows++
    }
    mode = BETWEEN
  }

  const define = (text: string): void => {
    const names = columnsOf(text)
    const index = (column: string): number => {
      const at = names.indexOf(column)
      if (at < 0) {
        throw new Error(`aninames: the kowiki ${table} dump has no ${column} column (${names.join(', ')})`)
      }
      return at
    }
    width = names.length
    slots = new Int32Array(width).fill(-1)
    musts = new Array<string | undefined>(width).fill(undefined)
    for (const [slot, column] of wanted.entries()) slots[index(column)] = slot
    for (const [column, value] of Object.entries(where)) musts[index(column)] = value
  }

  const outside = (byte: number): void => {
    if (byte === OPEN && decoder.decode(Uint8Array.from(statement)).trimEnd().endsWith(insert)) {
      statement = []
      begin()
      return
    }
    statement.push(byte)
    if (byte !== SEMICOLON) return
    const text = decoder.decode(Uint8Array.from(statement))
    statement = []
    if (text.includes(`CREATE TABLE \`${table}\``)) define(text)
  }

  return {
    feed(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i] as number
        switch (mode) {
          case OUTSIDE:
            outside(byte)
            break
          case BETWEEN:
            if (byte === OPEN) begin()
            else if (byte === SEMICOLON) mode = OUTSIDE
            break
          case FIELD:
            if (byte === QUOTE) mode = QUOTED
            else if (byte === COMMA) end(true)
            else if (byte === CLOSE) {
              end(true)
              finish()
            } else if (byte > SPACE) {
              mode = BARE
              put(byte)
            }
            break
          case QUOTED:
            if (byte === BACKSLASH) mode = ESCAPED
            else if (byte === QUOTE) mode = CLOSED
            else put(byte)
            break
          case ESCAPED:
            put(UNESCAPE[byte] ?? byte)
            mode = QUOTED
            break
          case CLOSED:
            if (byte === QUOTE) {
              put(QUOTE)
              mode = QUOTED
            } else if (byte === COMMA) end(false)
            else if (byte === CLOSE) {
              end(false)
              finish()
            }
            break
          default:
            if (byte === COMMA) end(true)
            else if (byte === CLOSE) {
              end(true)
              finish()
            } else if (byte > SPACE) put(byte)
        }
      }
    },
    done() {
      if (!slots) {
        throw new Error(`aninames: the kowiki ${table} dump has no CREATE TABLE \`${table}\``)
      }
      if (mode !== OUTSIDE) {
        throw new Error(`aninames: the kowiki ${table} dump ends inside its rows`)
      }
      return rows
    },
  }
}

async function scan<const C extends readonly string[]>(
  raw: string,
  table: Table,
  wanted: C,
  where: Record<string, string>,
  emit: (row: Row<C>) => void,
): Promise<number> {
  const path = fileOf(raw, table)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`aninames: ${path} is missing; run fetch kowiki first`)
  }
  const parser = scanner(table, wanted, where, emit)
  for await (const chunk of file.stream().pipeThrough(new DecompressionStream('gzip'))) {
    parser.feed(chunk)
  }
  return parser.done()
}

function resolve(title: string, targets: Map<string, string>, articles: Map<string, string>): string | undefined {
  let at = title
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (articles.has(at)) return at
    const next = targets.get(at)
    if (next === undefined) return undefined
    at = next
  }
  return undefined
}

const ARTICLES = 'pages-articles.xml.bz2'

function underscored(title: string): string {
  return title.replaceAll(' ', '_')
}

function subjectOf(page: string): string {
  return page
    .replace(/의 등장인물( 목록)?$/, '')
    .replace(/ 등장인물( 목록)?$/, '')
    .replace(/^(.+) \(등장인물\)$/, '$1')
}

function textOf(title: string): string {
  return title.replaceAll('_', ' ')
}

function langOf(text: string): string | undefined {
  if (hasHangul(text)) return 'ko'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'ja'
  return undefined
}

function nameOf(text: string, kind: Name['kind']): Name {
  const lang = langOf(text)
  return lang ? { text, lang, kind } : { text, kind }
}

export default {
  name: 'kowiki',
  layer: 'kowiki',
  license: 'CC BY-SA 4.0',
  async fetch(raw) {
    for (const table of TABLES) {
      const path = fileOf(raw, table)
      if (await fresh(path, FRESH_DAYS)) continue
      await download(`${BASE}/kowiki-latest-${table}.sql.gz`, path)
    }
    if (!(await fresh(join(raw, ARTICLES), FRESH_DAYS))) {
      await download(`${BASE}/kowiki-latest-pages-articles.xml.bz2`, join(raw, ARTICLES))
    }
  },
  async *stage(raw) {
    const items = new Map<number, string>()
    await scan(raw, 'page_props', ['pp_page', 'pp_value'], { pp_propname: 'wikibase_item' }, ([page, value]) => {
      if (/^Q\d+$/.test(value)) items.set(Number(page), value)
    })
    const articles = new Map<string, string>()
    const sources = new Map<number, string>()
    await scan(
      raw,
      'page',
      ['page_id', 'page_title', 'page_is_redirect'],
      { page_namespace: '0' },
      ([id, title, redirect]) => {
        if (redirect === '1') {
          sources.set(Number(id), title)
          return
        }
        const item = items.get(Number(id))
        if (item) articles.set(title, item)
      },
    )
    items.clear()
    const targets = new Map<string, string>()
    const sections = new Set<string>()
    await scan(
      raw,
      'redirect',
      ['rd_from', 'rd_title', 'rd_interwiki', 'rd_fragment'],
      { rd_namespace: '0' },
      ([from, title, interwiki, fragment]) => {
        const source = sources.get(Number(from))
        if (source === undefined || interwiki) return
        targets.set(source, title)
        if (fragment) sections.add(source)
      },
    )
    sources.clear()
    const incoming = new Map<string, string[]>()
    for (const [source, target] of targets) {
      const article = resolve(target, targets, articles)
      if (article === undefined) continue
      const list = incoming.get(article)
      if (list) list.push(source)
      else incoming.set(article, [source])
    }
    targets.clear()
    for (const [title, item] of articles) {
      const text = textOf(title)
      const names = [nameOf(text, 'official')]
      const seen = new Set([text])
      for (const source of incoming.get(title) ?? []) {
        const alias = textOf(source)
        if (seen.has(alias)) continue
        seen.add(alias)
        names.push(nameOf(alias, sections.has(source) ? 'section' : 'redirect'))
      }
      const entry: Entry = { id: ref('kowiki', text), attach: true, refs: [ref('wikidata', item)], names }
      yield entry
    }
    const pages = join(raw, ARTICLES)
    if (!(await Bun.file(pages).exists())) return
    for await (const pair of castPairs(pages)) {
      const item = articles.get(underscored(subjectOf(pair.page)))
      if (!item) continue
      const link = [pair.ja, pair.kana].filter(Boolean)
      const names: Name[] = [{ text: pair.ko, lang: 'ko', kind: 'official' }]
      if (pair.ja) names.push({ text: pair.ja, lang: 'ja', kind: 'synonym' })
      if (pair.kana && isKana(pair.kana)) names.push({ text: pair.kana, lang: 'ja', kind: 'reading' })
      yield {
        id: ref('kowiki', `${pair.page}#${pair.ko}`),
        kind: 'character',
        attach: true,
        link,
        works: [ref('wikidata', item)],
        names,
      }
    }
  },
} satisfies Source
