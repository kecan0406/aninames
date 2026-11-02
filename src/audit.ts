import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { manifestPaths, readManifest } from './client/format.ts'
import { Names } from './client/names.ts'
import { fileSource, type Source } from './client/source.ts'
import { LAYERS } from './model.ts'
import { FROZEN, type Frozen } from './probe.ts'
import { Index } from './search.ts'

const TABLES = ['entities', 'names', 'refs', 'works', 'related', 'homes', 'copyrights', 'ranks', 'adults'] as const

const MOST_LOST = 0.1

const LEAST_KEPT = 0.99

const LEAST_TAGS = 0.95

const MOST_WRONG_HOMES = 5

const LEADS_READ = 60

export type Stats = Record<string, number>

export function statsOf(dir: string): Stats {
  const stats: Stats = {}
  for (const layer of LAYERS) {
    const path = join(dir, `${layer}.sqlite`)
    if (!existsSync(path)) continue
    const db = new Database(path, { readonly: true })
    for (const table of TABLES) {
      const row = db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()
      stats[`${layer}.${table}`] = row?.count ?? 0
    }
    db.close()
  }
  return stats
}

export function lostFrom(before: Stats, after: Stats): string[] {
  return Object.entries(before).flatMap(([key, count]) => {
    const now = after[key] ?? 0
    return now < count * (1 - MOST_LOST) ? [`${key} fell from ${count} to ${now}`] : []
  })
}

function brokenFiles(site: string): string[] {
  const paths = manifestPaths(readManifest(readFileSync(join(site, 'manifest.json'), 'utf8')))
  return [...paths].flatMap((path) => {
    const file = join(site, path)
    if (!existsSync(file)) return [`${path} is missing`]
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    return hash.startsWith(path.slice(path.lastIndexOf('/') + 1, -'.json.gz'.length))
      ? []
      : [`${path} has other contents`]
  })
}

async function lostIds(dir: string): Promise<string[]> {
  const chosen = (await Bun.file(FROZEN).json()) as Frozen
  const ids = Object.values(chosen).flatMap((bands) => Object.values(bands).flat())
  const db = new Database(join(dir, 'unlicensed.sqlite'), { readonly: true })
  const has = db.query<{ id: string }, [string]>('SELECT id FROM entities WHERE id = ?')
  const lost = ids.filter((id) => !has.get(id))
  db.close()
  return lost.length > ids.length * (1 - LEAST_KEPT) ? [`${lost.length} of ${ids.length} sampled ids are gone`] : []
}

async function rows(file: string): Promise<string[][]> {
  const text = await Bun.file(join(import.meta.dirname, '..', 'tests', file)).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

async function lostTags(dir: string): Promise<string[]> {
  const index = new Index(dir)
  const tags = await rows('ttheme.tsv')
  const lost = tags.filter(([tag]) => !index.resolve(`danbooru:${tag}`, 'character'))
  const wrong = (await rows('homes.tsv')).filter(([tag, want]) => {
    const id = index.resolve(`danbooru:${tag}`, 'character')
    const home = id && index.home(id)
    return id && home && home !== want && !index.copyrights(id).includes(want as string)
  })
  index.close()
  return [
    ...(lost.length > tags.length * (1 - LEAST_TAGS)
      ? [`${lost.length} of ttheme's ${tags.length} tags attach nowhere`]
      : []),
    ...(wrong.length > MOST_WRONG_HOMES ? [`${wrong.length} of ttheme's homes are wrong`] : []),
  ]
}

async function lostLeads(names: Client): Promise<string[]> {
  const failed: string[] = []
  for (const [tag = '', wanted = ''] of await rows('leads.tsv')) {
    const cast = await names.cast(tag, { adult: false, limit: LEADS_READ })
    const leads = new Set(cast.flatMap((member) => (member.role === 'lead' ? member.danbooru : [])))
    const lost = wanted.split(' ').filter((want) => !leads.has(want))
    if (lost.length > 0) failed.push(`${tag} lost the leads ${lost.join(' ')}`)
  }
  return failed
}

interface Card {
  id: string
  label: string
  kind: string
  names: { text: string; lang: string | null; kind: string }[]
  danbooru: string[]
  works: string[]
  medium: string | null
  role?: string
}

interface Client {
  search(query: string, options: { kind?: string; limit?: number; adult?: boolean }): Promise<Card[]>
  lookup(ids: string[]): Promise<Card[]>
  tagged(tag: string, options: { kind?: string; adult?: boolean }): Promise<Card[]>
  cast(tag: string, options: { adult?: boolean; limit?: number }): Promise<Card[]>
}

const BOCCHI = 'w/bangumi:328609'

const HITORI = 'c/bangumi:87968'

export async function contract(names: Client): Promise<string[]> {
  const failed: string[] = []
  const expect = (what: string, ok: boolean) => {
    if (!ok) failed.push(what)
  }
  const [work] = await names.search('ぼっち・ざ・ろっく', { kind: 'work', limit: 5, adult: false })
  expect('search finds a work by its Japanese name', work?.id === BOCCHI && work.medium === 'anime')
  const [person] = await names.search('고토 히토리', { kind: 'character', limit: 5 })
  expect('search finds a character by a Korean name', person?.id === HITORI && person.works.includes(BOCCHI))
  const looked = await names.lookup([BOCCHI])
  expect('lookup returns a card with names', looked[0]?.id === BOCCHI && (looked[0]?.names.length ?? 0) > 0)
  const works = await names.tagged('bocchi_the_rock!', { kind: 'work', adult: false })
  expect(
    'tagged finds the works of a copyright tag',
    works.some((card) => card.id === BOCCHI),
  )
  const drawn = await names.tagged('gotoh_hitori', { kind: 'character' })
  expect(
    'tagged finds a character by its tag',
    drawn.some((card) => card.id === HITORI),
  )
  const cast = await names.cast('bocchi_the_rock!', { adult: false, limit: 5 })
  expect('cast lists a lead first', cast[0]?.id === HITORI && cast[0]?.role === 'lead')
  return failed
}

export async function audit(dir: string, previous?: string, published?: string): Promise<number> {
  const site = join(dir, 'site')
  const failed = brokenFiles(site)
  const stats = statsOf(dir)
  if (previous && existsSync(previous)) {
    failed.push(...lostFrom(JSON.parse(readFileSync(previous, 'utf8')) as Stats, stats))
  } else console.log('audit: no previous stats to compare with')
  failed.push(...(await lostIds(dir)), ...(await lostTags(dir)))
  const source: Source = fileSource(site)
  const names = new Names(source) as unknown as Client
  failed.push(...(await contract(names)).map((what) => `this client: ${what}`), ...(await lostLeads(names)))
  if (published) {
    const client = (await import(join(published, 'lib', 'client', 'index.js'))) as {
      Names: new (source: Source) => Client
      fileSource: (dir: string) => Source
    }
    const reader = new client.Names(client.fileSource(site))
    failed.push(...(await contract(reader)).map((what) => `the published client: ${what}`))
  }
  writeFileSync(join(dir, 'release', 'stats.json'), `${JSON.stringify(stats, null, 1)}\n`)
  for (const what of failed) console.log(`::error::audit: ${what}`)
  console.log(`audit: ${failed.length === 0 ? 'nothing wrong' : `${failed.length} wrong`}`)
  return failed.length
}
