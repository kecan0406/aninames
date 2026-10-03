import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Entry, Source } from './model.ts'

export const CACHE = join(import.meta.dirname, '..', '.cache')

export function rawDir(source: Source): string {
  return join(CACHE, 'raw', source.name)
}

export function stagePath(name: string): string {
  return join(CACHE, 'stage', `${name}.jsonl`)
}

export async function writeStage(source: Source): Promise<number> {
  await mkdir(join(CACHE, 'stage'), { recursive: true })
  const path = stagePath(source.name)
  const sink = Bun.file(`${path}.part`).writer()
  let count = 0
  for await (const entry of source.stage(rawDir(source))) {
    sink.write(`${JSON.stringify(entry)}\n`)
    count++
  }
  await sink.end()
  await Bun.write(path, Bun.file(`${path}.part`))
  await Bun.file(`${path}.part`).delete()
  return count
}

export async function* readStage(name: string): AsyncIterable<Entry> {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of Bun.file(stagePath(name)).stream()) {
    rest += decoder.decode(chunk, { stream: true })
    let at = rest.indexOf('\n')
    while (at >= 0) {
      const line = rest.slice(0, at)
      rest = rest.slice(at + 1)
      if (line) {
        yield JSON.parse(line) as Entry
      }
      at = rest.indexOf('\n')
    }
  }
  if (rest.trim()) {
    yield JSON.parse(rest) as Entry
  }
}
