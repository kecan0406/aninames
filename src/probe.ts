import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { convertHangulToQwerty, getChoseong } from 'es-hangul'
import type { Kind, Layer } from './model.ts'
import { type Card, Index } from './search.ts'
import { flat, hasHangul, hasKanji, isKana, kanaToRomaji } from './text.ts'

interface Tally {
  first: number
  five: number
  reciprocal: number
  total: number
  misses: string[]
}

interface Band {
  name: string
  low: number
  high: number
}

export const BANDS: Band[] = [
  { name: 'popular', low: 0.95, high: 1.01 },
  { name: 'middle', low: 0.7, high: 0.95 },
  { name: 'long tail', low: 0, high: 0.7 },
]

const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

function shuffled<T>(items: T[], key: (item: T) => string): T[] {
  return items
    .map((item) => [Bun.hash(key(item)), item] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, item]) => item)
}

function ranksOf(dir: string, layers: Layer[]): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const layer of layers) {
    const path = join(dir, `${layer}.sqlite`)
    if (!existsSync(path)) continue
    const db = new Database(path, { readonly: true })
    for (const row of db.query('SELECT entity, rank FROM ranks').all() as { entity: string; rank: number }[]) {
      ranks.set(row.entity, Math.max(ranks.get(row.entity) ?? 0, row.rank))
    }
    db.close()
  }
  return ranks
}

function sample(ranks: Map<string, number>, kind: Kind, band: Band, size: number, index: Index): string[] {
  const prefix = kind === 'work' ? 'w/' : 'c/'
  const pool = [...ranks].filter(([id, rank]) => id.startsWith(prefix) && rank >= band.low && rank < band.high)
  const out: string[] = []
  for (const [id] of shuffled(pool, ([id]) => id)) {
    const card = index.card(id)
    if (!card) continue
    if (new Set(card.refs.map((ref) => ref.slice(0, ref.indexOf(':')))).size < 2) continue
    if (kind === 'work' && card.medium !== 'anime') continue
    out.push(id)
    if (out.length >= size) break
  }
  return out
}

function pick(card: Card, test: (name: Card['names'][number]) => boolean): string | undefined {
  return card.names.find((name) => name.kind !== 'generated' && name.kind !== 'section' && test(name))?.text
}

function deleteMiddle(text: string): string | undefined {
  const letters = [...text]
  if (letters.filter((ch) => /[a-z]/i.test(ch)).length < 6) return undefined
  const at = Math.floor(letters.length / 2)
  return /[a-z]/i.test(letters[at] ?? '') ? [...letters.slice(0, at), ...letters.slice(at + 1)].join('') : undefined
}

export function forms(card: Card): [string, string][] {
  const out: [string, string][] = []
  const add = (form: string, query: string | undefined) => {
    if (query?.trim()) out.push([form, query.trim()])
  }
  const official = (name: Card['names'][number]) => name.kind === 'official' || name.kind === 'main'
  const japanese = pick(card, (n) => official(n) && JAPANESE.test(n.text) && (hasKanji(n.text) || isKana(n.text)))
  const reading = pick(card, (n) => n.kind === 'reading' && isKana(n.text))
  const romaji = pick(
    card,
    (n) => official(n) && (n.lang === 'en' || n.lang === 'ja-Latn') && /^[\p{Script=Latin}\s'.-]+$/u.test(n.text),
  )
  const korean = pick(card, (n) => n.lang === 'ko' && hasHangul(n.text) && n.kind !== 'redirect')
  const short = pick(card, (n) => n.kind === 'short')
  add('japanese', japanese)
  add('kana reading', reading)
  add('romaji', romaji)
  if (card.kind === 'character' && romaji && romaji.split(' ').length === 2) {
    add('romaji swapped', romaji.split(' ').reverse().join(' '))
    add('given name', romaji.split(' ')[0])
  }
  if (reading) {
    const plain = kanaToRomaji(reading).replace(/ou/g, 'o').replace(/uu/g, 'u')
    if (plain !== romaji?.toLowerCase()) add('romaji short vowels', plain)
  }
  add('romaji typo', romaji ? deleteMiddle(romaji) : undefined)
  add('korean', korean)
  add('korean initials', korean ? getChoseong(korean) : undefined)
  add('korean on qwerty', korean ? convertHangulToQwerty(korean) : undefined)
  if (card.kind === 'work') add('short title', short)
  return out
}

function score(index: Index, query: string, kind: Kind | undefined, want: string, row: Tally): void {
  const hits = index.search(query, { kind, limit: 10 })
  const at = hits.findIndex((hit) => hit.id === want)
  row.total++
  if (at === 0) row.first++
  if (at >= 0 && at < 5) row.five++
  if (at >= 0) row.reciprocal += 1 / (at + 1)
  else if (row.misses.length < 10)
    row.misses.push(`${query} → ${hits[0] ? index.label(hits[0].id) : '(nothing)'} (wanted ${index.label(want)})`)
}

function blank(): Tally {
  return { first: 0, five: 0, reciprocal: 0, total: 0, misses: [] }
}

function cell(row: Tally | undefined): string {
  if (!row || row.total === 0) return '-'.padStart(17)
  const pct = Math.round((100 * row.first) / row.total)
  return `${String(pct).padStart(3)}% ${(row.reciprocal / row.total).toFixed(2)} n=${String(row.total).padEnd(4)}`
}

function heldOut(dir: string, layers: Layer[], size: number): void {
  const path = join(dir, 'kowiki.sqlite')
  if (!existsSync(path)) return
  const others = layers.filter((layer) => layer !== 'kowiki')
  const index = new Index(dir, others)
  const kowiki = new Database(path, { readonly: true })
  const known = others.map((layer) => new Database(join(dir, `${layer}.sqlite`), { readonly: true }))
  const rows = kowiki
    .query(
      "SELECT entity, text, kind FROM names WHERE lang = 'ko' AND kind IN ('redirect', 'official') AND qual IS NULL",
    )
    .all() as { entity: string; text: string; kind: string }[]
  const tally = new Map<string, Tally>()
  let taken = 0
  for (const row of shuffled(rows, (r) => `${r.entity}\u0000${r.text}`)) {
    if (taken >= size) break
    const key = flat(row.text)
    if ([...key].length < 2) continue
    const seen = known.some((db) =>
      db.query('SELECT 1 FROM names WHERE entity = ? AND flat = ? LIMIT 1').get(row.entity, key),
    )
    const kind: Kind = row.entity.startsWith('w/') ? 'work' : 'character'
    const label = `${kind}s, ${seen ? 'also in other layers' : 'only in kowiki'}`
    const entry = tally.get(label) ?? blank()
    score(index, row.text, kind, row.entity, entry)
    tally.set(label, entry)
    taken++
  }
  console.log(`\nKorean Wikipedia titles and redirects searched without the kowiki layer (first %, MRR)`)
  for (const [label, row] of tally) {
    console.log(`  ${label.padEnd(36)} ${cell(row)}`)
    if (process.env.ANINAMES_MISSES) for (const miss of row.misses) console.log(`      ✗ ${miss}`)
  }
  for (const db of known) db.close()
  kowiki.close()
  index.close()
}

export const FROZEN = join(import.meta.dirname, '..', 'tests', 'probe.json')

export type Frozen = Record<Kind, Record<string, string[]>>

async function frozen(dir: string, index: Index, size: number): Promise<Frozen> {
  const file = Bun.file(FROZEN)
  if (await file.exists()) return (await file.json()) as Frozen
  const ranks = ranksOf(dir, index.layers)
  const out: Frozen = { work: {}, character: {} }
  for (const kind of ['work', 'character'] as const)
    for (const band of BANDS) out[kind][band.name] = sample(ranks, kind, band, size, index)
  await Bun.write(file, `${JSON.stringify(out, null, 1)}\n`)
  return out
}

export async function probe(dir: string, layers: Layer[], size: number): Promise<void> {
  const index = new Index(dir, layers)
  const chosen = await frozen(dir, index, size)
  console.log(
    `layers: ${index.layers.join(', ')}; sample in tests/probe.json; cells are first %, MRR, queries; (shared) = several entities carry that exact name`,
  )
  for (const kind of ['work', 'character'] as const) {
    const tallies = new Map<string, Map<string, Tally>>()
    for (const band of BANDS) {
      for (const id of chosen[kind][band.name] ?? []) {
        const card = index.card(id)
        if (!card) continue
        for (const [shape, query] of forms(card)) {
          const form = index.homonyms(query, kind) > 1 ? `${shape} (shared)` : shape
          const byBand = tallies.get(form) ?? new Map<string, Tally>()
          const row = byBand.get(band.name) ?? blank()
          score(index, query, kind, id, row)
          byBand.set(band.name, row)
          tallies.set(form, byBand)
        }
      }
    }
    console.log(`\n${kind}s`)
    console.log(`  ${'form'.padEnd(20)} ${BANDS.map((band) => band.name.padEnd(18)).join('')}`)
    for (const [form, byBand] of tallies) {
      console.log(`  ${form.padEnd(20)} ${BANDS.map((band) => `${cell(byBand.get(band.name))} `).join('')}`)
      if (process.env.ANINAMES_MISSES)
        for (const band of BANDS)
          for (const miss of byBand.get(band.name)?.misses ?? []) console.log(`      ✗ [${band.name}] ${miss}`)
    }
  }
  index.close()
  heldOut(dir, layers, size * 3)
}
