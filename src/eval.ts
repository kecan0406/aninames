import { join } from 'node:path'
import { APART, CHARACTERS, type Golden, SAME, TITLES, TYPOS } from '../tests/golden.ts'
import type { Layer, Ref } from './model.ts'
import { Index } from './search.ts'

function run(index: Index, set: Golden[], title: string): number {
  let passed = 0
  console.log(`\n${title}`)
  for (const golden of set) {
    const [top] = index.search(golden.query, { kind: golden.kind, limit: 1 })
    const refs = top ? index.refs(top.id) : []
    const ok = golden.expect.some((ref) => refs.includes(ref))
    if (ok) passed++
    const shown = top ? `${index.label(top.id)} [${top.id}] via ${top.how} "${top.matched}"` : '(nothing)'
    console.log(`  ${ok ? '✓' : '✗'} ${golden.query.padEnd(24)} → ${shown}`)
  }
  console.log(`  ${passed}/${set.length}`)
  return set.length - passed
}

interface Cast {
  tag: string
  natives: string[]
  group: string
}

async function cast(): Promise<Cast[]> {
  const text = await Bun.file(join(import.meta.dirname, '..', 'tests', 'ttheme.tsv')).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [tag = '', natives = '', group = ''] = line.split('\t')
      return { tag, natives: natives.split('|').filter(Boolean), group }
    })
}

function romaji(tag: string): string {
  return tag
    .replace(/_\([^)]*\)$/, '')
    .replace(/_/g, ' ')
    .trim()
}

function forms(member: Cast): [string, string][] {
  const name = romaji(member.tag)
  const tokens = name.split(' ')
  const out: [string, string][] = member.natives.map((native) => ['japanese', native])
  out.push(['romaji', name])
  if (tokens.length === 2) {
    out.push(['romaji reversed', [...tokens].reverse().join(' ')])
    out.push(['given name + series', `${tokens[1]} ${member.group}`])
  }
  return out
}

async function ttheme(index: Index): Promise<number> {
  const members = await cast()
  const missing: string[] = []
  const nameless: string[] = []
  const tally = new Map<string, { hit: number; total: number; misses: string[] }>()
  for (const member of members) {
    const id = index.resolve(`danbooru:${member.tag}`, 'character')
    if (!id) {
      missing.push(member.tag)
      continue
    }
    const names = index.card(id)?.names ?? []
    if (!names.some((n) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(n.text)))
      nameless.push(member.tag)
    for (const [form, query] of forms(member)) {
      const [top] = index.search(query, { kind: 'character', limit: 1 })
      const row = tally.get(form) ?? { hit: 0, total: 0, misses: [] }
      row.total++
      if (top?.id === id) row.hit++
      else row.misses.push(`${query} → ${top ? index.label(top.id) : '(nothing)'}`)
      tally.set(form, row)
    }
  }
  console.log(
    `\nttheme characters: ${members.length - missing.length}/${members.length} resolve, ${nameless.length} of them without a Japanese name`,
  )
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`)
  if (nameless.length) console.log(`  no Japanese name: ${nameless.join(', ')}`)
  console.log('\nttheme characters found first (not counted)')
  for (const [form, row] of tally) {
    console.log(`  ${form.padEnd(20)} ${row.hit}/${row.total}`)
    if (process.env.ANINAMES_MISSES) for (const miss of row.misses) console.log(`    ✗ ${miss}`)
  }
  return missing.length + nameless.length
}

function pairs(index: Index, set: [Ref, Ref][], same: boolean, title: string): number {
  let failed = 0
  console.log(`\n${title}`)
  for (const [a, b] of set) {
    const x = index.resolve(a, 'character')
    const y = index.resolve(b, 'character')
    if (!x || !y) {
      console.log(`  - ${a} ${b}: not in these layers`)
      continue
    }
    const ok = (x === y) === same
    if (!ok) failed++
    console.log(`  ${ok ? '✓' : '✗'} ${a} ${same ? '=' : '≠'} ${b}${x === y ? ` (${x})` : ` (${x}, ${y})`}`)
  }
  return failed
}

async function homes(index: Index): Promise<void> {
  const text = await Bun.file(join(import.meta.dirname, '..', 'tests', 'homes.tsv')).text()
  const tally = { right: 0, wrong: 0, none: 0, unresolved: 0 }
  const misses: string[] = []
  for (const line of text.split('\n').filter(Boolean)) {
    const [tag = '', want = ''] = line.split('\t')
    const id = index.resolve(`danbooru:${tag}`, 'character')
    const found = id ? index.home(id) : undefined
    if (!id) tally.unresolved++
    else if (found === want) tally.right++
    else if (found) tally.wrong++
    else tally.none++
    if (found !== want) misses.push(`${tag}: ${id ? (found ?? 'no home') : 'not found'} (want ${want})`)
  }
  console.log(
    `\nhomes of ttheme's commons characters (not counted): ${tally.right} right, ${tally.wrong} wrong, ${tally.none} without one, ${tally.unresolved} not found`,
  )
  if (process.env.ANINAMES_MISSES) for (const miss of misses) console.log(`    ✗ ${miss}`)
}

export async function evaluate(dir: string, layers: Layer[]): Promise<number> {
  const index = new Index(dir, layers)
  console.log(`layers: ${index.layers.join(', ')}`)
  let failed = run(index, TITLES, 'titles') + run(index, CHARACTERS, 'characters')
  run(index, TYPOS, 'typos (not counted)')
  failed += pairs(index, SAME, true, 'one character') + pairs(index, APART, false, 'two characters')
  failed += await ttheme(index)
  await homes(index)
  index.close()
  return failed
}
