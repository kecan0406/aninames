import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LAYERS, type Layer } from './model.ts'

const LANGS = ['ja', 'ko', 'en', 'zh'] as const

type Lang = (typeof LANGS)[number]

interface Card {
  tag?: string
  danbooru?: string[]
  names?: Partial<Record<Lang, string[]>>
  generated?: string[]
  rank?: number
  weight?: number
}

function langOf(lang: string | null): Lang | undefined {
  if (!lang) return undefined
  if (lang === 'ja' || lang === 'ko' || lang === 'en') return lang
  if (lang.startsWith('zh') && lang !== 'zh-Latn') return 'zh'
  return undefined
}

function characters(dir: string): Set<string> {
  const tagged = new Set<string>()
  for (const layer of LAYERS) {
    const path = join(dir, `${layer}.sqlite`)
    if (!existsSync(path)) continue
    const db = new Database(path, { readonly: true })
    for (const row of db
      .query("SELECT DISTINCT entity FROM refs WHERE ref LIKE 'danbooru:%' AND entity LIKE 'c/%'")
      .all() as {
      entity: string
    }[]) {
      tagged.add(row.entity)
    }
    db.close()
  }
  return tagged
}

function sliceOf(path: string, tagged: Set<string>): Record<string, Card> {
  const db = new Database(path, { readonly: true })
  const out: Record<string, Card> = {}
  const card = (entity: string) => {
    let found = out[entity]
    if (!found) {
      found = {}
      out[entity] = found
    }
    return found
  }
  for (const row of db
    .query("SELECT entity, ref FROM refs WHERE ref LIKE 'danbooru:%' AND entity LIKE 'c/%'")
    .all() as {
    entity: string
    ref: string
  }[]) {
    const entry = card(row.entity)
    entry.danbooru = [...(entry.danbooru ?? []), row.ref.slice('danbooru:'.length)]
  }
  for (const row of db
    .query(
      "SELECT entity, text FROM names WHERE ekind = 'character' AND source = 'danbooru' AND kind = 'main' AND qual IS NULL ORDER BY rowid",
    )
    .all() as { entity: string; text: string }[]) {
    if (!tagged.has(row.entity)) continue
    const entry = card(row.entity)
    entry.tag ??= row.text.replaceAll(' ', '_')
  }
  for (const row of db.query("SELECT entity, rank, weight FROM ranks WHERE entity LIKE 'c/%'").all() as {
    entity: string
    rank: number
    weight: number
  }[]) {
    if (!tagged.has(row.entity)) continue
    const entry = card(row.entity)
    entry.rank = Math.round(row.rank * 1000) / 1000
    entry.weight = row.weight
  }
  for (const row of db
    .query("SELECT entity, text, lang, kind, variant FROM names WHERE ekind = 'character' AND qual IS NULL")
    .all() as { entity: string; text: string; lang: string | null; kind: string; variant: number }[]) {
    if (!tagged.has(row.entity)) continue
    if (row.kind === 'generated') {
      if (row.lang !== 'ko' || row.variant) continue
      const entry = card(row.entity)
      entry.generated = [...new Set([...(entry.generated ?? []), row.text])]
      continue
    }
    if (row.kind === 'reading' || row.kind === 'section') continue
    const lang = langOf(row.lang)
    if (!lang) continue
    const entry = card(row.entity)
    const names = entry.names ?? {}
    names[lang] = [...new Set([...(names[lang] ?? []), row.text])]
    entry.names = names
  }
  db.close()
  return out
}

export async function slice(dir: string): Promise<void> {
  const tagged = characters(dir)
  for (const layer of LAYERS as readonly Layer[]) {
    const path = join(dir, `${layer}.sqlite`)
    if (!existsSync(path)) continue
    const data = sliceOf(path, tagged)
    const target = join(dir, `ttheme-${layer}.json`)
    await Bun.write(target, JSON.stringify(data))
    console.log(
      `slice: ${target} ${Object.keys(data).length} characters, ${(Bun.file(target).size / 1e6).toFixed(1)} MB`,
    )
  }
}
