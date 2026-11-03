import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Entry, Kind, Name, Namespace, Nature, Ref, Source } from '../model.ts'
import { ref, USER_AGENT } from '../model.ts'
import { sleep } from '../net.ts'

const MOST_WAIT = 120

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
  finds?: false
  to(value: string): Ref | undefined
}

function numeric(ns: Namespace, prefix = ''): (value: string) => Ref | undefined {
  return (value) => (/^[1-9]\d*$/.test(value) ? ref(ns, `${prefix}${value}`) : undefined)
}

function vndb(letter: string): (value: string) => Ref | undefined {
  return (value) => (new RegExp(`^${letter}[1-9]\\d*$`).test(value) ? ref('vndb', value) : undefined)
}

function danbooru(value: string): Ref | undefined {
  return value.trim() ? ref('danbooru', value.trim()) : undefined
}

function igdb(value: string): Ref | undefined {
  return /^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(value) ? ref('igdb', value) : undefined
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
    { property: 'P4983', finds: false, to: numeric('tmdb', 'tv/') },
    { property: 'P4947', finds: false, to: numeric('tmdb', 'movie/') },
    { property: 'P13236', finds: false, to: danbooru },
    { property: 'P5794', finds: false, to: igdb },
    { property: 'P1733', finds: false, to: numeric('steam') },
  ],
  character: [
    { property: 'P4085', to: numeric('mal') },
    { property: 'P11736', to: numeric('anilist') },
    { property: 'P5648', to: numeric('anidb') },
    { property: 'P6296', to: numeric('bangumi') },
    { property: 'P3180', only: 'c', to: vndb('c') },
    { property: 'P13236', gate: 'wdt:P31/wdt:P279* wd:Q95074', to: danbooru },
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

const NATURES: Record<string, Nature> = {
  Q11338907: 'software',
  Q1897589: 'software',
  Q15618491: 'software',
  Q7397: 'software',
  Q137396449: 'software',
  Q193564: 'software',
  Q11446438: 'group',
  Q11578153: 'group',
  Q641066: 'group',
  Q138304223: 'group',
  Q126480223: 'group',
  Q14635346: 'group',
  Q105416259: 'group',
  Q14514600: 'group',
  Q2088357: 'group',
  Q11664239: 'group',
  Q891723: 'organization',
  Q4830453: 'organization',
  Q6881511: 'organization',
  Q210167: 'organization',
  Q1137109: 'organization',
  Q1107679: 'organization',
  Q18127: 'organization',
  Q20739124: 'organization',
  Q1114515: 'organization',
  Q1320047: 'organization',
  Q43229: 'organization',
  Q334453: 'organization',
  Q11396960: 'organization',
  Q1762059: 'organization',
  Q1916382: 'organization',
  Q21980538: 'organization',
  Q167037: 'organization',
  Q18388277: 'organization',
  Q1058914: 'organization',
  Q18509232: 'organization',
  Q18654742: 'organization',
  Q18534542: 'organization',
  Q76213979: 'organization',
  Q76212517: 'organization',
  Q1485500: 'organization',
  Q114392939: 'organization',
  Q35127: 'organization',
  Q559856: 'organization',
  Q6576792: 'organization',
  Q59152282: 'organization',
  Q102336293: 'organization',
  Q122759350: 'organization',
  Q81989119: 'organization',
  Q2721136: 'organization',
  Q16465919: 'organization',
  Q133797182: 'organization',
  Q984179: 'organization',
  Q561068: 'organization',
  Q1787375: 'organization',
  Q15296520: 'organization',
  Q41298: 'organization',
  Q21886169: 'organization',
  Q163740: 'organization',
  Q1478443: 'organization',
  Q8102: 'term',
  Q12355361: 'term',
  Q1142315: 'term',
  Q27020041: 'term',
  Q500834: 'term',
  Q1478437: 'term',
  Q34542827: 'term',
}

const SAYS_NOTHING = new Set(['Q167270', 'Q431289', 'Q21484471', 'Q14946528'])

const NATURE_ORDER: readonly Nature[] = ['software', 'group', 'organization', 'term']

export function natureOf(types: readonly string[]): Nature | undefined {
  const said = types.filter((type) => !SAYS_NOTHING.has(type))
  if (said.length === 0 || !said.every((type) => NATURES[type])) return undefined
  return NATURE_ORDER.find((nature) => said.some((type) => NATURES[type] === nature))
}

type Group = Kind | 'linked' | 'natures'

type Facet = 'ids' | 'label' | 'alias' | 'sitelinks' | 'date' | 'origin' | 'kana' | 'native' | 'works'

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

const LINKS: { file: string; pattern: string; to: (value: string) => Ref | undefined }[] = [
  { file: 'links-steam', pattern: '?item wdt:P1733 ?v', to: numeric('steam') },
  { file: 'links-igdb', pattern: '?item wdt:P5794 ?v', to: igdb },
  { file: 'links-tmdb-tv', pattern: '?item wdt:P4983 ?v ; wdt:P31/wdt:P279* wd:Q581714', to: numeric('tmdb', 'tv/') },
  {
    file: 'links-tmdb-movie',
    pattern: '?item wdt:P4947 ?v ; wdt:P31/wdt:P279* wd:Q202866',
    to: numeric('tmdb', 'movie/'),
  },
]

const SITELINKS = '?item wikibase:sitelinks ?v'

const ORIGIN = '?item wdt:P495/wdt:P297 ?v'

const NATURES_FILE = 'tag-natures'

const QUERIES: Query[] = [
  { file: 'work-ids', group: 'work', facet: 'ids', pattern: idPattern(IDS.work) },
  { file: 'work-labels', group: 'work', facet: 'label', pattern: names('rdfs:label') },
  { file: 'work-aliases', group: 'work', facet: 'alias', pattern: names('skos:altLabel') },
  { file: 'work-sitelinks', group: 'work', facet: 'sitelinks', pattern: SITELINKS },
  { file: 'work-published', group: 'work', facet: 'date', pattern: '?item wdt:P577 ?v' },
  { file: 'work-started', group: 'work', facet: 'date', pattern: '?item wdt:P580 ?v' },
  { file: 'work-origin', group: 'work', facet: 'origin', pattern: ORIGIN },
  { file: 'character-ids', group: 'character', facet: 'ids', pattern: idPattern(IDS.character) },
  { file: 'character-labels', group: 'character', facet: 'label', pattern: names('rdfs:label') },
  { file: 'character-aliases', group: 'character', facet: 'alias', pattern: names('skos:altLabel') },
  { file: 'character-sitelinks', group: 'character', facet: 'sitelinks', pattern: SITELINKS },
  { file: 'character-kana', group: 'character', facet: 'kana', pattern: '?item wdt:P1814 ?v' },
  { file: 'character-native', group: 'character', facet: 'native', pattern: '?item wdt:P1559 ?v' },
  { file: 'character-works', group: 'character', facet: 'works', pattern: '?item wdt:P1441 ?v' },
  { file: 'linked-ids', group: 'linked', facet: 'ids', pattern: idPattern(IDS.work) },
  { file: 'linked-labels', group: 'linked', facet: 'label', pattern: names('rdfs:label') },
  { file: 'linked-aliases', group: 'linked', facet: 'alias', pattern: names('skos:altLabel') },
  { file: 'linked-sitelinks', group: 'linked', facet: 'sitelinks', pattern: SITELINKS },
  { file: 'linked-published', group: 'linked', facet: 'date', pattern: '?item wdt:P577 ?v' },
  { file: 'linked-started', group: 'linked', facet: 'date', pattern: '?item wdt:P580 ?v' },
  { file: 'linked-origin', group: 'linked', facet: 'origin', pattern: ORIGIN },
  { file: NATURES_FILE, group: 'natures', facet: 'ids', pattern: '' },
]

function kindOf(group: Group): Kind {
  return group === 'character' ? 'character' : 'work'
}

function itemSet(ids: Id[], endpoint: Endpoint): string {
  const branches = ids.flatMap((id, at) => {
    if (id.finds === false) return []
    const only = id.only ? ` FILTER(STRSTARTS(?id${at}, '${id.only}'))` : ''
    const gate = id.gate ? ` . ?item ${id.gate}${endpoint.forward}` : ''
    return [`{ ?item wdt:${id.property} ?id${at}${only}${gate} }`]
  })
  return `{ SELECT DISTINCT ?item WHERE { ${branches.join(' UNION ')} } }`
}

function naturesQuery(endpoint: Endpoint): string {
  const flags = Object.keys(NATURES)
    .map((q) => `wd:${q}`)
    .join(' ')
  return `${PREFIXES}SELECT DISTINCT ?v ?type WHERE { ${endpoint.hint} ?item wdt:P13236 ?v . VALUES ?flag { ${flags} } ?item wdt:P31 ?flag . ?item wdt:P31 ?type }`
}

function sparql(query: Query, endpoint: Endpoint, linked: string[]): string {
  if (query.group === 'natures') return naturesQuery(endpoint)
  const vars = query.facet === 'ids' ? '?item ?p ?v' : '?item ?v'
  const set =
    query.group === 'linked'
      ? `VALUES ?item { ${linked.map((q) => `wd:${q}`).join(' ')} }`
      : itemSet(IDS[query.group], endpoint)
  return `${PREFIXES}SELECT ${vars} WHERE { ${endpoint.hint} ${set} ${query.pattern} }`
}

export interface Term {
  type: string
  value: string
  'xml:lang'?: string
}

interface Results {
  results: { bindings: Record<string, Term>[] }
}

async function ask(endpoint: Endpoint, query: string, again = true): Promise<{ text: string; rows: number }> {
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
  const wait = Number(res.headers.get('retry-after'))
  if (res.status === 429 && again && wait > 0 && wait <= MOST_WAIT) {
    await res.body?.cancel()
    console.log(`wikidata: ${endpoint.name} asks to wait ${wait} s`)
    await sleep(wait * 1000)
    return ask(endpoint, query, false)
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`answered ${res.status}`)
  }
  const text = await res.text()
  let rows: number | undefined
  try {
    rows = (JSON.parse(text) as Results).results?.bindings?.length
  } catch (error) {
    if (!again) throw error
    console.log(`wikidata: ${endpoint.name} sent an answer cut short; asking again`)
    return ask(endpoint, query, false)
  }
  if (rows === undefined) {
    throw new Error('answered without results')
  }
  return { text, rows }
}

function linksQuery(pattern: string): string {
  return `${PREFIXES}SELECT ?v ?label ?date WHERE { ${pattern} ; rdfs:label ?label . FILTER(LANG(?label) = 'en') OPTIONAL { ?item wdt:P577|wdt:P580 ?date } }`
}

async function fetchLinks(raw: string): Promise<void> {
  const endpoint = ENDPOINTS.at(-1) as Endpoint
  for (const { file, pattern } of LINKS) {
    await save(raw, linksQuery(pattern), file, endpoint, new Date().toISOString()).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.log(`::warning::wikidata ${file} failed on ${endpoint.name} (${reason}); staging its last answer`)
    })
  }
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
        if (!(await Bun.file(join(raw, `${query.file}.json`)).exists())) {
          throw new Error(`aninames: wikidata ${query.file} failed on every endpoint (${reasons})`)
        }
        console.log(`::warning::wikidata ${query.file} failed on every endpoint (${reasons}); staging its last answer`)
      } else {
        answers.push(answer)
      }
      endpoints = endpoints.filter(
        (endpoint) => endpoint === ENDPOINTS.at(-1) || !misses.some((miss) => miss.endpoint === endpoint.name),
      )
    }
  } finally {
    await Bun.write(join(raw, 'meta.json'), `${JSON.stringify({ answers, misses, linked: linked?.length }, null, 2)}\n`)
  }
  await fetchLinks(raw)
}

interface Item {
  refs: Ref[]
  labels: Name[]
  native: Name[]
  aliases: Name[]
  readings: Name[]
  works: Ref[]
  origin: string[]
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
      item = {
        refs: [],
        labels: [],
        native: [],
        aliases: [],
        readings: [],
        works: [],
        origin: [],
      }
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
      case 'origin': {
        const code = value.value.trim().toUpperCase()
        if (/^[A-Z]{2}$/.test(code)) item.origin.push(code)
        break
      }
      case 'works': {
        const work = qid(value)
        if (work) item.works.push(ref('wikidata', work))
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

function entryOf(q: string, kind: Kind, item: Item): Entry {
  const entry: Entry = { id: ref('wikidata', q), kind, names: namesOf(item) }
  const refs = unique(item.refs)
  if (refs.length > 0) entry.refs = refs
  const works = unique(item.works)
  if (works.length > 0) entry.works = works
  if (item.rank !== undefined) entry.rank = item.rank
  if (item.year !== undefined) entry.year = item.year
  const origin = unique(item.origin)
  if (origin.length > 0) entry.origin = origin
  return entry
}

export function linkEntries(
  rows: readonly Record<string, Term>[],
  to: (value: string) => Ref | undefined,
  held: ReadonlySet<Ref>,
): Entry[] {
  const found = new Map<Ref, { titles: Set<string>; year: number }>()
  for (const row of rows) {
    const id = row.v ? to(row.v.value) : undefined
    const title = row.label?.value.normalize('NFC').trim()
    const year = Number(row.date?.value.match(/^(\d{4})-/)?.[1])
    if (!id || !title || !year || held.has(id)) continue
    const known = found.get(id)
    if (known) {
      known.titles.add(title)
      known.year = Math.min(known.year, year)
    } else found.set(id, { titles: new Set([title]), year })
  }
  return [...found].map(([id, { titles, year }]) => ({
    id,
    kind: 'work',
    attach: true,
    link: [...titles],
    year,
    names: [],
  }))
}

async function* stage(raw: string): AsyncIterable<Entry> {
  const items: Record<Kind, Map<string, Item>> = { work: new Map(), character: new Map() }
  for (const query of QUERIES) {
    if (query.group !== 'natures') gather(items[kindOf(query.group)], query, await rowsOf(raw, query.file))
  }
  for (const [q, item] of items.character) {
    yield entryOf(q, 'character', item)
  }
  for (const [q, item] of items.work) {
    if (!items.character.has(q)) {
      yield entryOf(q, 'work', item)
    }
  }
  const held = new Set([...items.work.values()].flatMap((item) => item.refs))
  for (const { file, to } of LINKS) {
    if (!(await Bun.file(join(raw, `${file}.json`)).exists())) continue
    yield* linkEntries(await rowsOf(raw, file), to, held)
  }
  const types = new Map<string, string[]>()
  for (const row of await rowsOf(raw, NATURES_FILE)) {
    const tag = row.v?.value
    const type = qid(row.type)
    if (!tag || !type) continue
    const known = types.get(tag)
    if (known) known.push(type)
    else types.set(tag, [type])
  }
  for (const [tag, kinds] of types) {
    const nature = natureOf(kinds)
    if (nature) yield { id: ref('danbooru', tag), attach: true, nature, names: [] }
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
