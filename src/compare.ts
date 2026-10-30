import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Names, trace } from './client/names.ts'
import { fileSource, type Source } from './client/source.ts'
import type { Layer } from './model.ts'
import { BANDS, FROZEN, type Frozen, forms } from './probe.ts'
import { Index } from './search.ts'

interface Tally {
  base: number
  files: number
  total: number
}

interface Cost {
  rounds: number
  labels: number
  files: number
  kb: number
  ms: number
}

function quantiles(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
  return `median ${f(at(0.5))} · p90 ${f(at(0.9))} · p99 ${f(at(0.99))} · max ${f(sorted.at(-1) ?? 0)}`
}

const pct = (part: number, total: number) => `${String(Math.round((100 * part) / total)).padStart(3)}%`

export async function compare(dir: string, layers: Layer[], limit: number): Promise<boolean> {
  if (!existsSync(FROZEN)) throw new Error(`aninames: ${FROZEN} is missing; run mise run probe first`)
  const files = fileSource(join(dir, 'site'))
  const text = await files.manifest()
  const source: Source = { manifest: async () => text, file: (path, signal) => files.file(path, signal) }
  const frozen = (await Bun.file(FROZEN).json()) as Frozen
  const index = new Index(dir, layers)
  const rows = new Map<string, Tally>()
  const costs: Cost[] = []
  const sqlite: number[] = []
  const changed: string[] = []
  for (const kind of ['work', 'character'] as const) {
    for (const band of BANDS) {
      for (const id of (frozen[kind][band.name] ?? []).slice(0, limit)) {
        const card = index.card(id)
        if (!card) continue
        for (const [shape, query] of forms(card)) {
          const form = `${kind}s ${index.homonyms(query, kind) > 1 ? `${shape} (shared)` : shape}`
          let started = performance.now()
          const base = index.search(query, { kind, limit: 10 }).findIndex((hit) => hit.id === id)
          sqlite.push(performance.now() - started)
          const names = new Names(source, { layers })
          started = performance.now()
          const found = await names.search(query, { kind, limit: 10 })
          const ms = performance.now() - started
          const t = trace(names)
          costs.push({ rounds: t.rounds, labels: t.labels, files: t.files, kb: t.bytes / 1024, ms })
          const at = found.findIndex((hit) => hit.id === id)
          const row = rows.get(form) ?? { base: 0, files: 0, total: 0 }
          row.total++
          if (base === 0) row.base++
          if (at === 0) row.files++
          rows.set(form, row)
          if (base === 0 && at !== 0)
            changed.push(`${form}: ${query} → ${found[0]?.label ?? '(nothing)'} (${at < 0 ? 'lost' : `#${at + 1}`})`)
        }
      }
    }
  }
  index.close()
  console.log(`queries: ${costs.length}; first % SQLite → files`)
  for (const [form, row] of rows)
    console.log(`  ${form.padEnd(40)} ${pct(row.base, row.total)} → ${pct(row.files, row.total)}  n=${row.total}`)
  const all = [...rows.values()].reduce(
    (sum, row) => ({ base: sum.base + row.base, files: sum.files + row.files, total: sum.total + row.total }),
    { base: 0, files: 0, total: 0 },
  )
  console.log(
    `  ${'all'.padEnd(40)} ${pct(all.base, all.total)} → ${pct(all.files, all.total)}  (${all.base} → ${all.files} of ${all.total})`,
  )
  console.log('\ncold, per query (nothing cached):')
  console.log(`  rounds to results  ${quantiles(costs.map((c) => c.rounds))}`)
  console.log(`  rounds for labels  ${quantiles(costs.map((c) => c.labels))}`)
  console.log(`  rounds in all      ${quantiles(costs.map((c) => c.rounds + c.labels))}`)
  console.log(`  files              ${quantiles(costs.map((c) => c.files))}`)
  console.log(`  KB (gz)            ${quantiles(costs.map((c) => c.kb))}`)
  console.log(`  local ms           ${quantiles(costs.map((c) => c.ms))}`)
  console.log(`  SQLite ms          ${quantiles(sqlite)}`)
  if (process.env.ANINAMES_MISSES) for (const line of changed) console.log(`  ✗ ${line}`)
  const failed = all.files < all.base
  if (failed) console.log(`\ncompare: the files find fewer entities first than SQLite (${all.files} < ${all.base})`)
  return failed
}
