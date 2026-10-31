import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
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
  await Bun.write(join(target, 'NOTICE.md'), await notice())
  console.log(`pack: ${(before / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB in ${target}`)
}

export async function unpack(dir: string): Promise<void> {
  const source = join(dir, 'release')
  for (const name of (await readdir(source)).filter((file) => file.endsWith('.sqlite.zst')).sort()) {
    const data = Bun.zstdDecompressSync(await Bun.file(join(source, name)).bytes())
    await Bun.write(join(dir, name.slice(0, -'.zst'.length)), data)
    console.log(`unpack: ${name} → ${(data.byteLength / 1e6).toFixed(1)} MB`)
  }
}
