import { mkdir } from 'node:fs/promises'
import { build, DIST } from './build.ts'
import { evaluate } from './eval.ts'
import { LAYERS, type Layer } from './model.ts'
import { Index } from './search.ts'
import { slice } from './slice.ts'
import { pick } from './sources/index.ts'
import { rawDir, writeStage } from './stage.ts'

async function main(argv: string[]): Promise<void> {
  const [verb, ...rest] = argv
  switch (verb) {
    case 'fetch':
      for (const source of await pick(rest)) {
        const started = performance.now()
        await mkdir(rawDir(source), { recursive: true })
        await source.fetch(rawDir(source))
        console.log(`fetched ${source.name} in ${((performance.now() - started) / 1000).toFixed(1)} s`)
      }
      return
    case 'stage':
      for (const source of await pick(rest)) {
        const started = performance.now()
        const count = await writeStage(source)
        console.log(`staged ${source.name}: ${count} entries in ${((performance.now() - started) / 1000).toFixed(1)} s`)
      }
      return
    case 'build':
      await build()
      await slice(DIST)
      return
    case 'slice':
      await slice(DIST)
      return
    case 'search': {
      const index = new Index(DIST, layersFrom())
      for (const hit of index.search(rest.join(' '), { limit: 10 })) {
        const works = index
          .card(hit.id)
          ?.works.map((w) => index.label(w))
          .join(' · ')
        console.log(
          `${hit.score.toFixed(1).padStart(6)} ${hit.kind.padEnd(9)} ${index.label(hit.id)}  [${hit.id}] ${hit.how} "${hit.matched}"${works ? `  — ${works}` : ''}`,
        )
      }
      index.close()
      return
    }
    case 'eval': {
      const failed = await evaluate(DIST, layersFrom())
      process.exitCode = failed > 0 ? 1 : 0
      return
    }
    default:
      throw new Error(`aninames: unknown verb ${verb ?? '(none)'}; use fetch, stage, build, search or eval`)
  }
}

function layersFrom(): Layer[] {
  const wanted = process.env.ANINAMES_LAYERS?.split(',').filter(Boolean)
  return (wanted ?? LAYERS).filter((layer): layer is Layer => (LAYERS as readonly string[]).includes(layer))
}

await main(process.argv.slice(2))
