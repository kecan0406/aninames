export interface Pair {
  page: string
  ko: string
  ja: string
  kana: string
}

const HANGUL = /[가-힣]/

const JAPANESE = /[぀-ヿ㐀-鿿]/

const KANA = /[぀-ヿ]/

const DEFINITION = /^;\s*(.+?)\s*[(（](.+?)[)）]/

const BOLD = /'''(\[\[[^\]]+\]\]|[^']{1,40})'''\s*[(（]([^)）]{1,80})[)）]/g

const TEMPLATE = /\{\{\s*일본어 표기\s*\|([\s\S]*?)\}\}/g

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)))
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

function clean(text: string): string {
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replaceAll("'''", '')
    .replaceAll("''", '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^[\s:;*#]+|[\s:;*#]+$/g, '')
}

function japanesePart(text: string): string {
  const unwrapped = text
    .replace(/\{\{\s*(?:llang|lang|ja|일본어)\s*\|\s*(?:ja\s*\|)?([^|}]*)[^}]*\}\}/gi, '$1')
    .replace(/<[^>]+>/g, '')
  return (unwrapped.split(/[,，、;/]|성우|CV|일본어/)[0] ?? '').replace(/^[\s:]+|[\s:]+$/g, '')
}

function* pairsOf(page: string, text: string): Iterable<Pair> {
  const seen = new Set<string>()
  for (const match of text.matchAll(TEMPLATE)) {
    const fields: Record<string, string> = {}
    for (const part of (match[1] ?? '').split('|')) {
      const at = part.indexOf('=')
      if (at > 0) fields[part.slice(0, at).trim()] = clean(part.slice(at + 1))
    }
    const ko = fields.이름 ?? fields.title ?? ''
    const ja = fields.일본한자 ?? fields.kanji ?? ''
    const kana = fields.가나 ?? fields.kana ?? ''
    if (!HANGUL.test(ko) || !(ja || kana) || seen.has(ko)) continue
    seen.add(ko)
    yield { page, ko, ja, kana }
  }
  for (const line of text.split('\n')) {
    const found: [string, string][] = []
    const definition = DEFINITION.exec(line)
    if (definition) found.push([definition[1] ?? '', definition[2] ?? ''])
    for (const bold of line.matchAll(BOLD)) found.push([bold[1] ?? '', bold[2] ?? ''])
    for (const [left, right] of found) {
      const ko = clean(left)
      const ja = japanesePart(right)
      if (!HANGUL.test(ko) || !JAPANESE.test(ja) || ko.length > 30 || seen.has(ko)) continue
      seen.add(ko)
      yield { page, ko, ja, kana: '' }
    }
  }
}

export async function* castPairs(path: string): AsyncIterable<Pair> {
  const unzip = Bun.spawn(['bzip2', '-dc', path], { stdout: 'pipe', stderr: 'pipe' })
  const decoder = new TextDecoder()
  let rest = ''
  let title = ''
  let namespace = ''
  let body: string[] | undefined
  const finish = function* (text: string): Iterable<Pair> {
    if (namespace !== '0') return
    const page = decodeEntities(text)
    if (KANA.test(page)) yield* pairsOf(title, page)
  }
  for await (const chunk of unzip.stdout) {
    rest += decoder.decode(chunk, { stream: true })
    let at = rest.indexOf('\n')
    while (at >= 0) {
      const line = rest.slice(0, at)
      rest = rest.slice(at + 1)
      at = rest.indexOf('\n')
      if (body) {
        const end = line.indexOf('</text>')
        if (end >= 0) {
          body.push(line.slice(0, end))
          yield* finish(body.join('\n'))
          body = undefined
        } else body.push(line)
        continue
      }
      const named = /<title>(.*?)<\/title>/.exec(line)
      if (named) {
        title = decodeEntities(named[1] ?? '')
        continue
      }
      const space = /<ns>(\d+)<\/ns>/.exec(line)
      if (space) {
        namespace = space[1] ?? ''
        continue
      }
      const open = line.indexOf('<text')
      if (open < 0 || /<text[^>]*\/>/.test(line)) continue
      const after = line.slice(line.indexOf('>', open) + 1)
      const end = after.indexOf('</text>')
      if (end >= 0) yield* finish(after.slice(0, end))
      else body = [after]
    }
  }
  if ((await unzip.exited) !== 0) {
    throw new Error(`aninames: bzip2 -dc ${path} failed: ${(await new Response(unzip.stderr).text()).trim()}`)
  }
}
