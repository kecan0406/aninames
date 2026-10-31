import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { download } from './net.ts'
import { CACHE } from './stage.ts'

const UNIHAN = 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip'

const SHINJITAI = 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/JPShinjitaiCharacters.txt'

const FIELDS = new Set(['kSemanticVariant', 'kSimplifiedVariant', 'kTraditionalVariant', 'kZVariant'])

const TABLE = join(import.meta.dirname, 'han.txt')

let folded: Map<string, string> | undefined

export function foldHan(text: string): string {
  folded ??= new Map(
    readFileSync(TABLE, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const [variant, canonical] = [...line]
        return variant && canonical ? [[variant, canonical] as const] : []
      }),
  )
  let out = ''
  for (const ch of text) out += folded.get(ch) ?? ch
  return out
}

export function hanPairs(unihan: string, shinjitai: string): [variant: string, canonical: string][] {
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let root = x
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root
    while ((parent.get(x) ?? x) !== root) {
      const next = parent.get(x) ?? x
      parent.set(x, root)
      x = next
    }
    return root
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
  }
  for (const line of unihan.split('\n')) {
    const [code, field, value] = line.split('\t')
    if (!code?.startsWith('U+') || !field || !FIELDS.has(field) || !value) continue
    for (const other of value.split(' ')) union(Number.parseInt(code.slice(2), 16), Number.parseInt(other.slice(2), 16))
  }
  for (const line of shinjitai.split('\n')) {
    const [key, values] = line.split('\t')
    if (!key || !values || line.startsWith('#') || [...key].length !== 1) continue
    for (const other of values.split(' ')) {
      if ([...other].length === 1) union(key.codePointAt(0) ?? 0, other.codePointAt(0) ?? 0)
    }
  }
  return [...parent.keys()]
    .filter((code) => find(code) !== code)
    .sort((a, b) => a - b)
    .map((code) => [String.fromCodePoint(code), String.fromCodePoint(find(code))])
}

export async function writeHan(): Promise<number> {
  const raw = join(CACHE, 'raw', 'han')
  const zip = join(raw, 'Unihan.zip')
  await download(UNIHAN, zip)
  const unzip = Bun.spawn(['unzip', '-o', '-q', zip, 'Unihan_Variants.txt', '-d', raw], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if ((await unzip.exited) !== 0) {
    throw new Error(`aninames: unzip ${zip} failed: ${(await new Response(unzip.stderr).text()).trim()}`)
  }
  await download(SHINJITAI, join(raw, 'JPShinjitaiCharacters.txt'))
  const pairs = hanPairs(
    await Bun.file(join(raw, 'Unihan_Variants.txt')).text(),
    await Bun.file(join(raw, 'JPShinjitaiCharacters.txt')).text(),
  )
  await Bun.write(TABLE, `${pairs.map(([variant, canonical]) => `${variant}${canonical}`).join('\n')}\n`)
  return pairs.length
}
