import type { Staged } from './build.ts'
import { link, node, readAll, Union } from './build.ts'

const SOURCES = new Set(['wikidata', 'vndb', 'bangumi', 'danbooru'])

const CAP = 50

interface Unit {
  key: string
  source: string
}

function units(staged: Staged[]): { truth: Union; local: Union; members: Staged[] } {
  const truth = new Union()
  const local = new Union()
  const members = staged.filter((s) => s.entry.kind === 'character' && !s.entry.attach && SOURCES.has(s.source))
  for (const s of members) {
    const self = node('character', s.entry.id)
    const own = `${s.entry.id.slice(0, s.entry.id.indexOf(':'))}:`
    truth.add(self)
    local.add(self)
    for (const ref of s.entry.refs ?? []) {
      truth.union(self, node('character', ref))
      if (ref.startsWith(own)) local.union(self, node('character', ref))
    }
  }
  return { truth, local, members }
}

function groups(members: Staged[], local: Union, cluster: (key: string) => string): Map<string, Unit[]> {
  const out = new Map<string, Map<string, Unit>>()
  for (const s of members) {
    const key = local.find(node('character', s.entry.id))
    const at = cluster(node('character', s.entry.id))
    const list = out.get(at) ?? new Map<string, Unit>()
    list.set(key, { key, source: s.source })
    out.set(at, list)
  }
  return new Map([...out].map(([at, list]) => [at, [...list.values()]]))
}

export async function silver(): Promise<void> {
  const { all } = await readAll()
  const { truth, local, members } = units(all)
  const predicted = link(all, true)
  const truthSources = new Map<string, Set<string>>()
  for (const s of members) {
    const root = truth.find(node('character', s.entry.id))
    const set = truthSources.get(root) ?? new Set<string>()
    set.add(s.source)
    truthSources.set(root, set)
  }
  let positives = 0
  let found = 0
  for (const list of groups(members, local, (key) => truth.find(key)).values()) {
    const capped = list.slice(0, CAP)
    for (let i = 0; i < capped.length; i++)
      for (let j = i + 1; j < capped.length; j++) {
        const a = capped[i] as Unit
        const b = capped[j] as Unit
        if (a.source === b.source) continue
        positives++
        if (predicted.find(a.key) === predicted.find(b.key)) found++
      }
  }
  let right = 0
  let wrong = 0
  let unknown = 0
  const examples: string[] = []
  for (const list of groups(members, local, (key) => predicted.find(key)).values()) {
    const capped = list.slice(0, CAP)
    for (let i = 0; i < capped.length; i++)
      for (let j = i + 1; j < capped.length; j++) {
        const a = capped[i] as Unit
        const b = capped[j] as Unit
        if (a.source === b.source) continue
        const ta = truth.find(a.key)
        const tb = truth.find(b.key)
        if (ta === tb) right++
        else if (truthSources.get(ta)?.has(b.source) || truthSources.get(tb)?.has(a.source)) {
          wrong++
          if (examples.length < 15) examples.push(`${a.key.slice(10)} + ${b.key.slice(10)}`)
        } else unknown++
      }
  }
  console.log(`\nsilver: character pairs that external ids link across sources, with those ids hidden from the merge`)
  console.log(`  recall    ${((100 * found) / positives).toFixed(1)}% (${found} of ${positives})`)
  console.log(
    `  precision ${((100 * right) / (right + wrong)).toFixed(1)}% (${right} right, ${wrong} wrong, ${unknown} not judgeable)`,
  )
  if (process.env.ANINAMES_MISSES) for (const example of examples) console.log(`    ✗ ${example}`)
}
