import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const LEVEL = 6

export async function pack(dir: string): Promise<void> {
  const target = join(dir, 'release')
  await mkdir(target, { recursive: true })
  let before = 0
  let after = 0
  for (const name of (await readdir(dir)).filter((file) => /\.(sqlite|json)$/.test(file)).sort()) {
    const data = await Bun.file(join(dir, name)).bytes()
    const packed = Bun.zstdCompressSync(data, { level: LEVEL })
    await Bun.write(join(target, `${name}.zst`), packed)
    before += data.byteLength
    after += packed.byteLength
    console.log(`pack: ${name} ${(data.byteLength / 1e6).toFixed(1)} MB → ${(packed.byteLength / 1e6).toFixed(1)} MB`)
  }
  console.log(`pack: ${(before / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB in ${target}`)
}
