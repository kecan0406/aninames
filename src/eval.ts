import { join } from 'node:path'
import { CHARACTERS, type Golden, TITLES, TYPOS } from '../tests/golden.ts'
import type { Layer } from './model.ts'
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

async function ttheme(index: Index): Promise<number> {
  const tags = (await Bun.file(join(import.meta.dirname, '..', 'tests', 'ttheme.txt')).text())
    .split('\n')
    .filter(Boolean)
  const missing: string[] = []
  const nameless: string[] = []
  for (const tag of tags) {
    const id = index.resolve(`danbooru:${tag}`, 'character')
    if (!id) {
      missing.push(tag)
      continue
    }
    const names = index.card(id)?.names ?? []
    if (!names.some((n) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(n.text))) nameless.push(tag)
  }
  console.log(
    `\nttheme characters: ${tags.length - missing.length}/${tags.length} resolve, ${nameless.length} of them without a Japanese name`,
  )
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`)
  if (nameless.length) console.log(`  no Japanese name: ${nameless.join(', ')}`)
  return missing.length + nameless.length
}

export async function evaluate(dir: string, layers: Layer[]): Promise<number> {
  const index = new Index(dir, layers)
  console.log(`layers: ${index.layers.join(', ')}`)
  let failed = run(index, TITLES, 'titles') + run(index, CHARACTERS, 'characters')
  run(index, TYPOS, 'typos (not counted)')
  failed += await ttheme(index)
  index.close()
  return failed
}
