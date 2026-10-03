import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Entry, Kind, Name, Namespace, Ref, Source } from '../model.ts'
import { ref } from '../model.ts'
import { USER_AGENT } from '../net.ts'

interface Endpoint {
  name: string
  url: string
  timeout: number
  hint: string
  forward: string
}

const ENDPOINTS: Endpoint[] = [
  {
    name: 'wdqs',
    url: 'https://query.wikidata.org/sparql',
    timeout: 120_000,
    hint: "hint:Query hint:optimizer 'None' .",
    forward: " . hint:Prior hint:gearing 'forward'",
  },
  { name: 'qlever', url: 'https://qlever.dev/api/wikidata', timeout: 300_000, hint: '', forward: '' },
]

const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
`

interface Id {
  property: string
  only?: string
  gate?: string
  to(value: string): Ref | undefined
}

function numeric(ns: Namespace, prefix = ''): (value: string) => Ref | undefined {
  return (value) => (/^[1-9]\d*$/.test(value) ? ref(ns, `${prefix}${value}`) : undefined)
}

function vndb(letter: string): (value: string) => Ref | undefined {
  return (value) => (new RegExp(`^${letter}[1-9]\\d*$`).test(value) ? ref('vndb', value) : undefined)
}

const IDS: Record<Kind, Id[]> = {
  work: [
    { property: 'P4086', to: numeric('mal') },
    { property: 'P8729', to: numeric('anilist') },
    { property: 'P5646', to: numeric('anidb') },
    { property: 'P11495', to: numeric('kitsu') },
    { property: 'P1985', to: numeric('ann') },
    { property: 'P5732', to: numeric('bangumi') },
    { property: 'P4087', to: numeric('mal', 'manga/') },
    { property: 'P8731', to: numeric('anilist', 'manga/') },
    { property: 'P3180', only: 'v', to: vndb('v') },
  ],
  character: [
    { property: 'P4085', to: numeric('mal') },
    { property: 'P11736', to: numeric('anilist') },
    { property: 'P5648', to: numeric('anidb') },
    { property: 'P6296', to: numeric('bangumi') },
    { property: 'P3180', only: 'c', to: vndb('c') },
    {
      property: 'P13236',
      gate: 'wdt:P31/wdt:P279* wd:Q95074',
      to: (value) => (value.trim() ? ref('danbooru', value.trim()) : undefined),
    },
  ],
}

const LANGS: Record<string, string | undefined> = {
  ja: 'ja',
  'ja-hani': 'ja',
  'ja-kana': 'ja',
  'ja-hira': 'ja',
  'ja-hrkt': 'ja',
  ko: 'ko',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  mul: undefined,
  zh: 'zh',
  'zh-hans': 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-my': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
}

const LABEL_LANGS = [
  'ja',
  'ko',
  'en',
  'mul',
  'zh',
  'zh-hans',
  'zh-hant',
  'zh-cn',
  'zh-tw',
  'zh-hk',
  'zh-sg',
  'zh-mo',
  'zh-my',
]

type Group = Kind | 'linked'

type Facet = 'ids' | 'label' | 'alias' | 'sitelinks' | 'date' | 'kana' | 'native' | 'works' | 'related'

interface Query {
  file: string
  group: Group
  facet: Facet
  pattern: string
}

function idPattern(ids: Id[]): string {
  return ids
    .map((id) => {
      const only = id.only ? ` FILTER(STRSTARTS(?v, '${id.only}'))` : ''
      return `{ ?item wdt:${id.property} ?v BIND('${id.property}' AS ?p)${only} }`
    })
    .join(' UNION ')
}

function names(predicate: string): string {
  const langs = LABEL_LANGS.map((lang) => `?l = '${lang}'`).join(' || ')
  return `?item ${predicate} ?v BIND(LANG(?v) AS ?l) FILTER(${langs})`
}

const SITELINKS = '?item wikibase:sitelinks ?v'

const RELATIONS = ['P144', 'P4969', 'P179', 'P361', 'P527', 'P8345', 'P155', 'P156']

const QUERIES: Query[] = [
  { file: 'work-ids', group: 'work', facet: 'ids', pattern: idPattern(IDS.work) },
  { file: 'work-labels', group: 'work', facet: 'label', pattern: names('rdfs:label') },
  { file: 'work-aliases', group: 'work', facet: 'alias', pattern: names('skos:altLabel') },
  { file: 'work-sitelinks', group: 'work', facet: 'sitelinks', pattern: SITELINKS },
  { file: 'work-published', group: 'work', facet: 'date', pattern: '?item wdt:P577 ?v' },
  { file: 'work-started', group: 'work', facet: 'date', pattern: '?item wdt:P580 ?v' },
  { file: 'character-ids', group: 'character', facet: 'ids', pattern: idPattern(IDS.character) },
  { file: 'character-labels', group: 'character', facet: 'label', pattern: names('rdfs:label') },
  { file: 'character-aliases', group: 'character', facet: 'alias', pattern: names('skos:altLabel') },
  { file: 'character-sitelinks', group: 'character', facet: 'sitelinks', pattern: SITELINKS },
  { file: 'character-kana', group: 'character', facet: 'kana', pattern: '?item wdt:P1814 ?v' },
  { file: 'character-native', group: 'character', facet: 'native', pattern: '?item wdt:P1559 ?v' },
  { file: 'character-works', group: 'character', facet: 'works', pattern: '?item wdt:P1441 ?v' },
  { file: 'linked-labels', group: 'linked', facet: 'label', pattern: names('rdfs:label') },
  { file: 'linked-aliases', group: 'linked', facet: 'alias', pattern: names('skos:altLabel') },
  { file: 'linked-sitelinks', group: 'linked', facet: 'sitelinks', pattern: SITELINKS },
  { file: 'linked-published', group: 'linked', facet: 'date', pattern: '?item wdt:P577 ?v' },
  { file: 'linked-started', group: 'linked', facet: 'date', pattern: '?item wdt:P580 ?v' },
  ...(['work', 'linked'] as const).flatMap((group) =>
    RELATIONS.map((property) => ({
      file: `${group}-related-${property}`,
      group,
      facet: 'related' as const,
      pattern: `?item wdt:${property} ?v`,
    })),
  ),
]

function kindOf(group: Group): Kind {
  return group === 'character' ? 'character' : 'work'
}

function itemSet(ids: Id[], endpoint: Endpoint): string {
  const branches = ids.map((id, at) => {
    const only = id.only ? ` FILTER(STRSTARTS(?id${at}, '${id.only}'))` : ''
    const gate = id.gate ? ` . ?item ${id.gate}${endpoint.forward}` : ''
    return `{ ?item wdt:${id.property} ?id${at}${only}${gate} }`
  })
  return `{ SELECT DISTINCT ?item WHERE { ${branches.join(' UNION ')} } }`
}

function sparql(query: Query, endpoint: Endpoint, linked: string[]): string {
  const vars = query.facet === 'ids' ? '?item ?p ?v' : '?item ?v'
  const set =
    query.group === 'linked'
      ? `VALUES ?item { ${linked.map((q) => `wd:${q}`).join(' ')} }`
      : itemSet(IDS[query.group], endpoint)
  return `${PREFIXES}SELECT ${vars} WHERE { ${endpoint.hint} ${set} ${query.pattern} }`
}

interface Term {
  type: string
  value: string
  'xml:lang'?: string
}

interface Results {
  results: { bindings: Record<string, Term>[] }
}

async function ask(endpoint: Endpoint, query: string): Promise<{ text: string; rows: number }> {
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ query }),
    signal: AbortSignal.timeout(endpoint.timeout),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`answered ${res.status}`)
  }
  const text = await res.text()
  const rows = (JSON.parse(text) as Results).results?.bindings?.length
  if (rows === undefined) {
    throw new Error('answered without results')
  }
  return { text, rows }
}

function qid(term: Term | undefined): string | undefined {
  return term?.value.match(/\/entity\/(Q\d+)$/)?.[1]
}

async function rowsOf(raw: string, file: string): Promise<Record<string, Term>[]> {
  const path = join(raw, `${file}.json`)
  const data = Bun.file(path)
  if (!(await data.exists())) {
    throw new Error(`aninames: wikidata has no ${file}.json; run fetch wikidata first`)
  }
  return ((await data.json()) as Results).results.bindings
}

async function linkedItems(raw: string): Promise<string[]> {
  const known = new Set<string>()
  for (const file of ['work-ids', 'character-ids']) {
    for (const row of await rowsOf(raw, file)) known.add(qid(row.item) ?? '')
  }
  const out = new Set<string>()
  for (const row of await rowsOf(raw, 'character-works')) {
    const q = qid(row.v)
    if (q && !known.has(q)) out.add(q)
  }
  return [...out].sort()
}

interface Answer {
  file: string
  endpoint: string
  url: string
  at: string
  seconds: number
  rows: number
}

interface Miss {
  file: string
  endpoint: string
  at: string
  error: string
}

async function save(raw: string, query: string, file: string, endpoint: Endpoint, at: string): Promise<Answer> {
  const started = performance.now()
  const { text, rows } = await ask(endpoint, query)
  const path = join(raw, `${file}.json`)
  await Bun.write(`${path}.part`, text)
  await rename(`${path}.part`, path)
  const seconds = Math.round(performance.now() - started) / 1000
  console.log(`wikidata ${file}: ${rows} rows from ${endpoint.name} in ${seconds.toFixed(1)} s`)
  return { file, endpoint: endpoint.name, url: endpoint.url, at, seconds, rows }
}

async function fetchAll(raw: string): Promise<void> {
  const answers: Answer[] = []
  const misses: Miss[] = []
  let endpoints = ENDPOINTS
  let linked: string[] | undefined
  try {
    for (const query of QUERIES) {
      if (query.group === 'linked') linked ??= await linkedItems(raw)
      let answer: Answer | undefined
      for (const endpoint of endpoints) {
        const at = new Date().toISOString()
        answer = await save(raw, sparql(query, endpoint, linked ?? []), query.file, endpoint, at).catch(
          (error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error)
            console.log(`wikidata ${query.file}: ${endpoint.name} ${reason}`)
            misses.push({ file: query.file, endpoint: endpoint.name, at, error: reason })
            return undefined
          },
        )
        if (answer) break
      }
      if (!answer) {
        const tried = misses.filter((miss) => miss.file === query.file)
        const reasons = tried.map((miss) => `${miss.endpoint} ${miss.error}`).join(', ')
        throw new Error(`aninames: wikidata ${query.file} failed on every endpoint (${reasons})`)
      }
      answers.push(answer)
      endpoints = endpoints.filter(
        (endpoint) => endpoint === ENDPOINTS.at(-1) || !misses.some((miss) => miss.endpoint === endpoint.name),
      )
    }
  } finally {
    await Bun.write(join(raw, 'meta.json'), `${JSON.stringify({ answers, misses, linked: linked?.length }, null, 2)}\n`)
  }
}

interface Item {
  refs: Ref[]
  labels: Name[]
  native: Name[]
  aliases: Name[]
  readings: Name[]
  works: Ref[]
  related: Ref[]
  rank?: number
  year?: number
}

function named(term: Term, kind: Name['kind']): Name | undefined {
  const code = (term['xml:lang'] ?? '').toLowerCase()
  const text = term.value.normalize('NFC').trim()
  if (!text || !(code in LANGS)) {
    return undefined
  }
  const lang = LANGS[code]
  return lang ? { text, lang, kind } : { text, kind }
}

function gather(items: Map<string, Item>, query: Query, rows: Record<string, Term>[]): void {
  const ids = IDS[kindOf(query.group)]
  for (const row of rows) {
    const q = qid(row.item)
    const value = row.v
    if (!q || !value) {
      continue
    }
    let item = items.get(q)
    if (!item) {
      item = { refs: [], labels: [], native: [], aliases: [], readings: [], works: [], related: [] }
      items.set(q, item)
    }
    switch (query.facet) {
      case 'ids': {
        const found = ids.find((id) => id.property === row.p?.value)?.to(value.value)
        if (found) item.refs.push(found)
        break
      }
      case 'label': {
        const name = named(value, 'official')
        if (name) item.labels.push(name)
        break
      }
      case 'native': {
        const name = named(value, 'official')
        if (name) item.native.push(name)
        break
      }
      case 'alias': {
        const name = named(value, 'synonym')
        if (name) item.aliases.push(name)
        break
      }
      case 'kana': {
        const text = value.value.normalize('NFC').trim()
        if (text) item.readings.push({ text, lang: 'ja', kind: 'reading' })
        break
      }
      case 'sitelinks': {
        const count = Number(value.value)
        if (Number.isFinite(count)) item.rank = count
        break
      }
      case 'date': {
        const year = Number(value.value.match(/^(-?\d{1,4})(?:-|$)/)?.[1])
        if (Number.isInteger(year) && year > 0) item.year = Math.min(item.year ?? year, year)
        break
      }
      case 'works': {
        const work = qid(value)
        if (work) item.works.push(ref('wikidata', work))
        break
      }
      case 'related': {
        const other = qid(value)
        if (other && other !== q) item.related.push(ref('wikidata', other))
        break
      }
    }
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function namesOf(item: Item): Name[] {
  const out: Name[] = []
  const seen = new Set<string>()
  const texts = new Set<string>()
  for (const name of [...item.labels, ...item.native, ...item.aliases].filter((each) => each.lang)) {
    const key = `${name.lang}\u0000${name.text}`
    if (seen.has(key)) continue
    seen.add(key)
    texts.add(name.text)
    out.push(name)
  }
  for (const name of [...item.labels, ...item.aliases].filter((each) => !each.lang)) {
    if (texts.has(name.text)) continue
    texts.add(name.text)
    out.push(name)
  }
  for (const text of unique(item.readings.map((name) => name.text))) {
    out.push({ text, lang: 'ja', kind: 'reading' })
  }
  return out
}

function entryOf(q: string, kind: Kind, item: Item, known?: Map<string, Item>): Entry {
  const entry: Entry = { id: ref('wikidata', q), kind, names: namesOf(item) }
  const refs = unique(item.refs)
  if (refs.length > 0) entry.refs = refs
  const works = unique(item.works)
  if (works.length > 0) entry.works = works
  const related = unique(item.related).filter((other) => known?.has(other.slice('wikidata:'.length)))
  if (related.length > 0) entry.related = related
  if (item.rank !== undefined) entry.rank = item.rank
  if (item.year !== undefined) entry.year = item.year
  return entry
}

async function* stage(raw: string): AsyncIterable<Entry> {
  const items: Record<Kind, Map<string, Item>> = { work: new Map(), character: new Map() }
  for (const query of QUERIES) {
    gather(items[kindOf(query.group)], query, await rowsOf(raw, query.file))
  }
  for (const [q, item] of items.character) {
    yield entryOf(q, 'character', item)
  }
  for (const [q, item] of items.work) {
    if (!items.character.has(q)) {
      yield entryOf(q, 'work', item, items.work)
    }
  }
}

const wikidata: Source = {
  name: 'wikidata',
  layer: 'core',
  license: 'CC0-1.0',
  fetch: fetchAll,
  stage,
}

export default wikidata
