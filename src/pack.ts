import { createHash } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { LAYERS, type Layer } from './model.ts'
import { pick } from './sources/index.ts'

const LEVEL = 6

export const TERMS =
  'Each layer is its own file and keeps the terms of the sources it was built from; combine them on your own machine.'

export async function licenses(): Promise<[Layer, string[]][]> {
  const sources = await pick([])
  return LAYERS.map((layer) => [
    layer,
    sources.filter((source) => source.layer === layer).map((source) => `${source.name}: ${source.license}`),
  ])
}

export async function notice(): Promise<string> {
  return [
    '# aninames data',
    '',
    TERMS,
    '',
    ...(await licenses()).flatMap(([layer, lines]) => [`## ${layer}`, '', ...lines.map((line) => `- ${line}`), '']),
  ].join('\n')
}

export async function pack(dir: string): Promise<void> {
  const target = join(dir, 'release')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  let before = 0
  let after = 0
  const note = (name: string, from: number, to: number) => {
    before += from
    after += to
    console.log(`pack: ${name} ${(from / 1e6).toFixed(1)} MB → ${(to / 1e6).toFixed(1)} MB`)
  }
  for (const name of (await readdir(dir)).filter((file) => file.endsWith('.sqlite')).sort()) {
    const data = await Bun.file(join(dir, name)).bytes()
    const packed = Bun.zstdCompressSync(data, { level: LEVEL })
    await Bun.write(join(target, `${name}.zst`), packed)
    note(name, data.byteLength, packed.byteLength)
  }
  const layers: Record<string, { file: string; sha256: string; bytes: number }> = {}
  for (const layer of LAYERS) {
    const name = `ttheme-${layer}.json`
    const file = Bun.file(join(dir, name))
    if (!(await file.exists())) continue
    const data = await file.bytes()
    const packed = gzipSync(data, { level: 9 })
    await Bun.write(join(target, `${name}.gz`), packed)
    layers[layer] = {
      file: `${name}.gz`,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.byteLength,
    }
    note(name, data.byteLength, packed.byteLength)
  }
  await Bun.write(
    join(target, 'ttheme.json'),
    `${JSON.stringify({ built: new Date().toISOString(), layers }, null, 2)}\n`,
  )
  await Bun.write(join(target, 'NOTICE.md'), await notice())
  console.log(`pack: ${(before / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB in ${target}`)
}
