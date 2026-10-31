import { join } from 'node:path'
import { type Entry, type Name, type NameKind, type Namespace, type Ref, ref, type Source } from '../model.ts'
import { download, json } from '../net.ts'
import { hasHangul } from '../text.ts'

const RELEASES = 'https://api.github.com/repos/cedya77/anime-offline-database/releases/latest'

const ASSET = 'anime-offline-database-minified.json'

const FILE = 'anime-offline-database.json'

const PATTERNS: readonly [Namespace, RegExp][] = [
  ['mal', /^https:\/\/myanimelist\.net\/anime\/(\d+)$/],
  ['anilist', /^https:\/\/anilist\.co\/anime\/(\d+)$/],
  ['anidb', /^https:\/\/anidb\.net\/anime\/(\d+)$/],
  ['kitsu', /^https:\/\/kitsu\.app\/anime\/(\d+)$/],
  ['ann', /^https:\/\/animenewsnetwork\.com\/encyclopedia\/anime\.php\?id=(\d+)$/],
  ['animeplanet', /^https:\/\/anime-planet\.com\/anime\/([^/?#]+)$/],
  ['anisearch', /^https:\/\/anisearch\.com\/anime\/(\d+)$/],
  ['livechart', /^https:\/\/livechart\.me\/anime\/(\d+)$/],
  ['simkl', /^https:\/\/simkl\.com\/anime\/(\d+)$/],
  ['animecountdown', /^https:\/\/animecountdown\.com\/(\d+)$/],
]

const STRONGEST: readonly Namespace[] = ['mal', 'anidb', 'anilist', 'kitsu']

const NEAR: readonly Namespace[] = [...STRONGEST, 'ann']

interface Release {
  tag_name: string
  assets: { name: string; browser_download_url: string }[]
}

interface Anime {
  sources: string[]
  title: string
  type: string
  synonyms: string[]
  relatedAnime?: string[]
  animeSeason?: { year?: number }
  score?: { arithmeticMean: number }
  tags?: string[]
}

function refOf(url: string): Ref | undefined {
  for (const [ns, pattern] of PATTERNS) {
    const id = pattern.exec(url)?.[1]
    if (id) return ref(ns, id)
  }
  return undefined
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function langOf(text: string): string | undefined {
  if (hasHangul(text)) return 'ko'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'ja'
  if (count(text, /\p{Script=Cyrillic}/gu) > count(text, /\p{Script=Latin}/gu)) return 'ru'
  if (/\p{Script=Thai}/u.test(text)) return 'th'
  return undefined
}

function namesOf(anime: Anime): Name[] {
  const seen = new Set<string>()
  const names: Name[] = []
  const all: [string, NameKind][] = [
    [anime.title, 'main'],
    ...anime.synonyms.map((text): [string, NameKind] => [text, 'synonym']),
  ]
  for (const [raw, kind] of all) {
    const text = raw.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    const lang = langOf(text)
    names.push(lang ? { text, lang, kind } : { text, kind })
  }
  return names
}

function entryOf(anime: Anime): Entry | undefined {
  const refs = [...new Set(anime.sources.map(refOf).filter((found) => found !== undefined))]
  const id = STRONGEST.map((ns) => refs.find((found) => found.startsWith(`${ns}:`))).find(Boolean) ?? refs[0]
  if (!id) return undefined
  const entry: Entry = {
    id,
    kind: 'work',
    refs,
    names: namesOf(anime),
    type: anime.type,
  }
  const own = new Set(refs)
  const near = [...new Set((anime.relatedAnime ?? []).map(refOf))].filter(
    (found): found is Ref => found !== undefined && !own.has(found) && NEAR.some((ns) => found.startsWith(`${ns}:`)),
  )
  if (near.length > 0) entry.near = near
  const year = anime.animeSeason?.year
  if (year) entry.year = year
  if (anime.tags?.includes('hentai')) entry.adult = true
  if (anime.tags?.length) entry.rank = anime.tags.length * (anime.score?.arithmeticMean ?? 6)
  return entry
}

export default {
  name: 'aod',
  layer: 'core',
  license: 'ODbL-1.0 AND DbCL-1.0',
  async fetch(raw) {
    const token = process.env.GITHUB_TOKEN
    const release = await json<Release>(RELEASES, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    const marker = Bun.file(join(raw, 'release.json'))
    const known = (await marker.exists()) ? ((await marker.json()) as { tag: string }) : undefined
    if (known?.tag === release.tag_name && (await Bun.file(join(raw, FILE)).exists())) return
    const asset = release.assets.find((candidate) => candidate.name === ASSET)
    if (!asset) {
      throw new Error(`aninames: anime-offline-database release ${release.tag_name} has no ${ASSET}`)
    }
    await download(asset.browser_download_url, join(raw, FILE))
    await Bun.write(marker, `${JSON.stringify({ tag: release.tag_name, downloaded: new Date().toISOString() })}\n`)
  },
  async *stage(raw) {
    const file = Bun.file(join(raw, FILE))
    if (!(await file.exists())) {
      throw new Error(`aninames: ${join(raw, FILE)} is missing; run fetch aod first`)
    }
    const { data } = (await file.json()) as { data: Anime[] }
    for (const anime of data) {
      const entry = entryOf(anime)
      if (entry) yield entry
    }
  },
} satisfies Source
