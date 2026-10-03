import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type Entry, type Name, type NameKind, type Ref, ref, type Source } from '../model.ts'
import { download, json } from '../net.ts'
import { hasHangul, hasKanji, isKana } from '../text.ts'

const LATEST = 'https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json'

const SUBJECTS = 'subject.jsonlines'

const CHARACTERS = 'character.jsonlines'

const CASTS = 'subject-characters.jsonlines'

const FILES = [SUBJECTS, CHARACTERS, CASTS]

const ANIME: Record<number, string> = { 1: 'TV', 2: 'OVA', 3: 'MOVIE', 4: 'SPECIAL', 5: 'ONA', 2006: 'ONA' }

const CHINESE = ['中国', '香港', '台湾']

type Region = 'zh' | 'ja' | undefined

const HINTS: Record<string, string> = {
  中文名: 'zh-Hans',
  简体中文名: 'zh-Hans',
  中文别名: 'zh-Hans',
  cn: 'zh-Hans',
  第二中文名: 'zh',
  繁体中文名: 'zh-Hant',
  繁体中文: 'zh-Hant',
  繁中: 'zh-Hant',
  繁中名: 'zh-Hant',
  繁体昵称: 'zh-Hant',
  台版: 'zh-Hant',
  港版: 'zh-Hant',
  台湾: 'zh-Hant',
  香港: 'zh-Hant',
  日文名: 'ja',
  日文: 'ja',
  日版: 'ja',
  jp: 'ja',
  第二日文名: 'ja',
  英文名: 'en',
  英文: 'en',
  英文别名: 'en',
  英文标题: 'en',
  第二英文名: 'en',
  美版: 'en',
  英版: 'en',
  en: 'en',
  罗马字: 'ja-Latn',
  罗马音: 'ja-Latn',
  韩文名: 'ko',
  韩文: 'ko',
  韩版: 'ko',
  法文名: 'fr',
  德文名: 'de',
  俄文名: 'ru',
  西班牙文名: 'es',
  意大利文名: 'it',
  泰文名: 'th',
}

const READINGS = new Set(['纯假名', '假名', '平假名', '片假名'])

const NAMED = new Set([...Object.keys(HINTS), ...READINGS, '别名', '本名', '全名', '昵称', '又名', '原名'])

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

const SEPARATORS = /[、，,／/;；]/

interface Asset {
  name: string
  browser_download_url: string
  size: number
  digest?: string
}

interface Subject {
  id: number
  type: number
  name: string
  name_cn: string
  infobox: string
  platform: number
  date?: string
  series?: boolean
  tags?: { name: string }[]
  meta_tags?: string[]
  favorite?: Record<string, number>
}

interface Character {
  id: number
  role: number
  name: string
  infobox: string
  collects: number
}

interface Cast {
  character_id: number
  subject_id: number
  type: number
}

interface Work {
  rank: number
  region: Region
}

type Field = [list: string | undefined, key: string, value: string]

async function* records<T>(path: string): AsyncIterable<T> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`aninames: ${path} is missing; run fetch bangumi first`)
  }
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of file.stream()) {
    rest += decoder.decode(chunk, { stream: true })
    let start = 0
    let at = rest.indexOf('\n')
    while (at >= 0) {
      if (at > start) yield JSON.parse(rest.slice(start, at)) as T
      start = at + 1
      at = rest.indexOf('\n', start)
    }
    rest = rest.slice(start)
  }
  rest += decoder.decode()
  if (rest.trim()) yield JSON.parse(rest) as T
}

function fields(infobox: string): Field[] {
  const out: Field[] = []
  let list: string | undefined
  for (const raw of infobox.split('\n')) {
    const line = raw.trim()
    if (list !== undefined) {
      if (line === '}') {
        list = undefined
      } else if (line.startsWith('[') && line.endsWith(']')) {
        const inner = line.slice(1, -1)
        const bar = inner.indexOf('|')
        out.push(bar < 0 ? [list, list, inner] : [list, inner.slice(0, bar).trim() || list, inner.slice(bar + 1)])
      }
      continue
    }
    const eq = line.indexOf('=')
    if (!line.startsWith('|') || eq < 0) continue
    const key = line.slice(1, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (value === '{') list = key
    else out.push([undefined, key, value])
  }
  return out
}

function scriptOf(text: string): string | undefined {
  if (KANA.test(text)) return 'ja'
  if (hasHangul(text)) return 'ko'
  if (hasKanji(text)) return 'zh'
  return undefined
}

function langOf(hint: string | undefined, text: string): string | undefined {
  const script = scriptOf(text)
  if (hint === undefined) return script
  if (hint === 'ja') return script === 'zh' ? 'ja' : script
  if (hint.startsWith('zh')) return script === 'zh' ? hint : script
  if (hint === 'ko') return script
  return script ?? hint
}

function regionOf(tags: readonly string[]): Region {
  if (tags.includes('日本')) return 'ja'
  return CHINESE.some((tag) => tags.includes(tag)) ? 'zh' : undefined
}

function originOf(text: string, chinese: boolean): string | undefined {
  const script = scriptOf(text)
  return script === 'zh' && !chinese ? 'ja' : script
}

function name(text: string, kind: NameKind, lang: string | undefined): Name {
  return lang ? { text: text.trim(), lang, kind } : { text: text.trim(), kind }
}

function infoboxNames(found: readonly Field[], split?: RegExp): Name[] {
  const out: Name[] = []
  for (const [list, key, value] of found) {
    if (list !== '别名' && !(NAMED.has(key) && (list === undefined || key === list || key === '别名'))) continue
    const base = key.replace(/[\d一二三四五]+$/, '')
    for (const piece of split ? value.split(split) : [value]) {
      const text = piece.trim()
      if (!text) continue
      if (READINGS.has(base) && isKana(text)) out.push(name(text, 'reading', 'ja'))
      else out.push(name(text, base === '简体中文名' ? 'official' : 'synonym', langOf(HINTS[base], text)))
    }
  }
  return out
}

function unique(names: readonly Name[]): Name[] {
  const seen = new Set<string>()
  return names.filter((found) => {
    const key = found.kind === 'reading' ? `\u0000${found.text}` : found.text
    if (!found.text || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function own(text: string): Name[] {
  return isKana(text) ? [name(text, 'reading', 'ja')] : []
}

function refsOf(found: readonly Field[], list: string, pattern: RegExp): Ref[] {
  const out: Ref[] = []
  for (const [at, key, value] of found) {
    const id = at === list && key === 'VNDB' ? pattern.exec(value)?.[1] : undefined
    if (id) out.push(ref('vndb', id))
  }
  return [...new Set(out)]
}

function typeOf(subject: Subject): string | undefined {
  if (subject.type === 2) return ANIME[subject.platform] ?? 'UNKNOWN'
  if (subject.type === 4) return 'GAME'
  if (subject.type !== 1 || !subject.series) return undefined
  if (subject.platform === 1001) return 'MANGA'
  const tagged = subject.tags?.some((tag) => tag.name === '轻小说') || subject.meta_tags?.includes('轻小说')
  return subject.platform === 1002 && tagged ? 'LIGHT_NOVEL' : undefined
}

function workOf(subject: Subject, type: string, chinese: boolean): Entry {
  const found = fields(subject.infobox)
  const nameLang = originOf(subject.name, chinese)
  const entry: Entry = {
    id: ref('bangumi', subject.id),
    kind: 'work',
    names: unique([
      name(subject.name, 'official', nameLang === 'zh' && subject.name === subject.name_cn ? 'zh-Hans' : nameLang),
      name(subject.name_cn, 'official', langOf('zh-Hans', subject.name_cn)),
      ...infoboxNames(found),
      ...own(subject.name),
    ]),
    rank: Object.values(subject.favorite ?? {}).reduce((sum, count) => sum + count, 0),
    type,
  }
  const refs = refsOf(found, '链接', /vndb\.org\/(v\d+)/)
  if (refs.length > 0) entry.refs = refs
  const year = Number(subject.date?.slice(0, 4))
  if (year > 0) entry.year = year
  return entry
}

function characterOf(
  character: Character,
  casts: readonly Cast[],
  works: ReadonlyMap<number, Work>,
  top: number,
): Entry {
  const found = fields(character.infobox)
  const ordered = [...casts].sort(
    (a, b) => a.type - b.type || (works.get(b.subject_id)?.rank ?? 0) - (works.get(a.subject_id)?.rank ?? 0),
  )
  const regions = new Set(casts.map((cast) => works.get(cast.subject_id)?.region))
  const chinese = regions.has('zh') && !regions.has('ja')
  const best = Math.max(0, ...casts.map((cast) => works.get(cast.subject_id)?.rank ?? 0))
  const entry: Entry = {
    id: ref('bangumi', character.id),
    kind: 'character',
    names: unique([
      name(character.name, 'official', originOf(character.name, chinese)),
      ...infoboxNames(found, SEPARATORS),
      ...own(character.name),
    ]),
    works: [...new Set(ordered.map((cast) => ref('bangumi', cast.subject_id)))],
    rank: character.collects + best / (top + 1),
  }
  const refs = refsOf(found, '引用来源', /vndb\.org\/(c\d+)/)
  if (refs.length > 0) entry.refs = refs
  return entry
}

const source: Source = {
  name: 'bangumi',
  layer: 'unlicensed',
  license: 'unstated (Bangumi Archive)',
  async fetch(raw) {
    const asset = await json<Asset>(LATEST)
    const marker = Bun.file(join(raw, 'meta.json'))
    const known = (await marker.exists()) ? ((await marker.json()) as { asset: string }) : undefined
    const present = await Promise.all(FILES.map((file) => Bun.file(join(raw, file)).exists()))
    if (known?.asset === asset.name && present.every(Boolean)) return
    const zip = join(raw, asset.name)
    if (!(await Bun.file(zip).exists())) await download(asset.browser_download_url, zip)
    const unzip = Bun.spawn(['unzip', '-o', '-q', zip, ...FILES, '-d', raw], { stdout: 'ignore', stderr: 'pipe' })
    if ((await unzip.exited) !== 0) {
      throw new Error(`aninames: unzip ${zip} failed: ${(await new Response(unzip.stderr).text()).trim()}`)
    }
    await rm(zip)
    const meta = { asset: asset.name, size: asset.size, digest: asset.digest, downloaded: new Date().toISOString() }
    await Bun.write(marker, `${JSON.stringify(meta)}\n`)
  },
  async *stage(raw) {
    const works = new Map<number, Work>()
    for await (const subject of records<Subject>(join(raw, SUBJECTS))) {
      const type = typeOf(subject)
      if (!type) continue
      const region = regionOf(subject.meta_tags ?? [])
      const entry = workOf(subject, type, region === 'zh')
      works.set(subject.id, { rank: entry.rank ?? 0, region })
      yield entry
    }
    let top = 0
    for (const work of works.values()) top = Math.max(top, work.rank)
    const casts = new Map<number, Cast[]>()
    for await (const cast of records<Cast>(join(raw, CASTS))) {
      if (!works.has(cast.subject_id)) continue
      const known = casts.get(cast.character_id)
      if (known) known.push(cast)
      else casts.set(cast.character_id, [cast])
    }
    for await (const character of records<Character>(join(raw, CHARACTERS))) {
      const found = casts.get(character.id)
      if (character.role === 1 && found) yield characterOf(character, found, works, top)
    }
  },
}

export default source
