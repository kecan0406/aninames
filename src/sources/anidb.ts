import { join } from 'node:path'
import { type Entry, type Name, type NameKind, ref, type Source } from '../model.ts'
import { download, fresh } from '../net.ts'

const MIRROR = 'https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/animetitles.xml'

const FILE = 'animetitles.xml'

const KINDS: Record<string, NameKind> = {
  main: 'main',
  official: 'official',
  syn: 'synonym',
  card: 'synonym',
  short: 'short',
  kana: 'reading',
}

const LANGS: Record<string, string | undefined> = {
  'x-jat': 'ja-Latn',
  'x-zht': 'zh-Latn',
  'x-kot': 'ko-Latn',
  'x-other': undefined,
  'x-unk': undefined,
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return String.fromCodePoint(code)
    }
    return ENTITIES[name] ?? whole
  })
}

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, key = '', value = ''] of text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    out[key] = decode(value)
  }
  return out
}

function nameOf(attrs: Record<string, string>, body: string): Name | undefined {
  const text = decode(body).trim()
  let kind = KINDS[attrs.type ?? '']
  if (!text || !kind) {
    return undefined
  }
  if (kind === 'reading' && !KANA.test(text)) {
    kind = 'synonym'
  }
  const given = attrs['xml:lang']
  const lang = given !== undefined && Object.hasOwn(LANGS, given) ? LANGS[given] : given
  return lang === undefined ? { text, kind } : { text, lang, kind }
}

const source: Source = {
  name: 'anidb',
  layer: 'unlicensed',
  license: 'unstated (AniDB titles via Anime-Lists mirror)',
  async fetch(raw) {
    const path = join(raw, FILE)
    if (await fresh(path, 7)) {
      return
    }
    await download(MIRROR, path)
  },
  async *stage(raw) {
    const file = Bun.file(join(raw, FILE))
    if (!(await file.exists())) {
      throw new Error(`aninames: ${join(raw, FILE)} is missing; run fetch anidb first`)
    }
    const xml = await file.text()
    for (const [, head = '', body = ''] of xml.matchAll(/<anime\b([^>]*)>([\s\S]*?)<\/anime>/g)) {
      const aid = attributes(head).aid
      if (!aid) {
        continue
      }
      const names: Name[] = []
      for (const [, attrs = '', text = ''] of body.matchAll(/<title\b([^>]*)>([^<]*)<\/title>/g)) {
        const name = nameOf(attributes(attrs), text)
        if (name) {
          names.push(name)
        }
      }
      if (names.length > 0) {
        yield { id: ref('anidb', aid), kind: 'work', names } satisfies Entry
      }
    }
  },
}

export default source
