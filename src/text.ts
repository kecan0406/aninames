const ROMAJI: Record<string, string> = {
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  ゐ: 'i',
  ゑ: 'e',
  を: 'o',
  ん: 'n',
  ゔ: 'vu',
  ぁ: 'a',
  ぃ: 'i',
  ぅ: 'u',
  ぇ: 'e',
  ぉ: 'o',
  ゎ: 'wa',
}

const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' }

const SMALL_V: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }

const VOWELS = 'aeiou'

export function toHiragana(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch
  }
  return out
}

export function isKana(text: string): boolean {
  return (
    /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(text) &&
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
  )
}

export function hasHangul(text: string): boolean {
  return /\p{Script=Hangul}/u.test(text)
}

export function hasKanji(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

function syllables(kana: string): string[] {
  const chars = [...toHiragana(kana)]
  const out: string[] = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? ''
    const next = chars[i + 1] ?? ''
    if (SMALL_Y[next] && ROMAJI[ch] && ch !== 'ん') {
      out.push(ch + next)
      i++
      continue
    }
    if (SMALL_V[next] && ROMAJI[ch] && 'うてでふゔしじちつ'.includes(ch)) {
      out.push(ch + next)
      i++
      continue
    }
    out.push(ch)
  }
  return out
}

function romajiOf(syllable: string): string | undefined {
  const [head = '', tail = ''] = [...syllable]
  if (!tail) {
    return ROMAJI[head]
  }
  const base = ROMAJI[head] ?? ''
  if (SMALL_Y[tail]) {
    const vowel = SMALL_Y[tail]
    if (base.startsWith('sh') || base.startsWith('ch') || base.startsWith('j')) {
      return base.slice(0, -1) + vowel
    }
    return `${base.slice(0, -1)}y${vowel}`
  }
  const vowel = SMALL_V[tail] ?? ''
  if (head === 'う') return `w${vowel}`
  if (head === 'て') return `t${vowel}`
  if (head === 'で') return `d${vowel}`
  if (head === 'ふ') return `f${vowel}`
  if (head === 'ゔ') return `v${vowel}`
  if (head === 'し') return `sh${vowel}`
  if (head === 'じ') return `j${vowel}`
  if (head === 'ち') return `ch${vowel}`
  if (head === 'つ') return `ts${vowel}`
  return base + vowel
}

export function kanaToRomaji(kana: string): string {
  const parts = syllables(kana)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (part === 'っ' || part === 'ッ') {
      const next = romajiOf(parts[i + 1] ?? '') ?? ''
      out += next.startsWith('ch') ? 't' : next.slice(0, 1).replace(/[aeiou]/, '')
      continue
    }
    if (part === 'ー') {
      const last = out.at(-1) ?? ''
      out += VOWELS.includes(last) ? last : ''
      continue
    }
    if (part === '・' || /\s/.test(part)) {
      out += ' '
      continue
    }
    const romaji = romajiOf(part)
    if (romaji === undefined) {
      out += part
      continue
    }
    if (part === 'ん' && /^[aeiouy]/.test(romajiOf(parts[i + 1] ?? '') ?? '')) {
      out += "n'"
      continue
    }
    out += romaji
  }
  return out.replace(/\s+/g, ' ').trim()
}

const INITIAL = ['k', 'k', 'n', 't', 't', 'r', 'm', 'b', 'b', 's', 's', '', 'ch', 'ch', 'ch', 'k', 't', 'p', 'h']

const MEDIAL = [
  'a',
  'e',
  'ya',
  'ye',
  'o',
  'e',
  'yo',
  'ye',
  'o',
  'wa',
  'we',
  'we',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'u',
  'ui',
  'i',
]

const FINAL: Record<number, string> = { 1: 'ku', 4: 'n', 8: 'ru', 16: 'mu', 19: 'q', 20: 'q', 21: 'n' }

export function hangulToLatin(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const code = (ch.codePointAt(0) ?? 0) - 0xac00
    if (code < 0 || code >= 11172) {
      out += ch
      continue
    }
    const initial = INITIAL[Math.floor(code / 588)] ?? ''
    const medial = Math.floor((code % 588) / 28)
    const final = code % 28
    let syllable = initial + (MEDIAL[medial] ?? '')
    if (medial === 18) {
      if (initial === 'ch') syllable = 'tsu'
      else if (initial === 's') syllable = 'su'
    }
    out += syllable + (FINAL[final] ?? '')
  }
  return out.replace(/q(?=[a-z])/g, (_, at: number, all: string) => all[at + 1] ?? '').replace(/q/g, '')
}

export function foldLatin(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/([aeiou])[\u0304\u0302]/g, '$1$1')
    .replace(/(?<=[a-z])\p{M}+/gu, '')
    .normalize('NFC')
}

function coarse(latin: string): string {
  let r = foldLatin(latin).replace(/[^a-z]/g, '')
  r = r.replace(/ts/g, 's').replace(/sh/g, 's').replace(/f/g, 'h').replace(/j/g, 'ch').replace(/z/g, 'ch')
  r = r.replace(/chy/g, 'ch').replace(/sy/g, 's').replace(/g/g, 'k').replace(/d/g, 't').replace(/v/g, 'b')
  r = r.replace(/([aeiou])h(?![aeiouy])/g, '$1')
  r = r.replace(/([kstpcbmnrhw])\1+/g, '$1').replace(/tch/g, 'ch')
  r = r.replace(/m(?=[bp])/g, 'n')
  r = r.replace(/ou|oo/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e')
  return r.replace(/chu/g, 'su')
}

function latinOf(token: string): string {
  if (isKana(token)) return kanaToRomaji(token)
  if (hasHangul(token)) return hangulToLatin(token)
  return /^[\p{Script=Latin}\p{N}\p{P}\p{M}]+$/u.test(token.normalize('NFKD')) ? token : ''
}

export function soundKeys(text: string): string[] {
  const tokens = text
    .normalize('NFKC')
    .split(/[\s・·_]+/)
    .map((token) => token.replace(/[\p{P}\p{S}]+/gu, ''))
    .filter(Boolean)
    .map((token) => coarse(latinOf(token)))
  if (tokens.length === 0 || tokens.some((token) => !token)) {
    return []
  }
  const keys = new Set([tokens.join(''), [...tokens].sort().join('')])
  return [...keys].filter((key) => key.length >= 2)
}

const PUNCT = /[\s\p{P}\p{S}]+/gu

export function flat(text: string): string {
  return toHiragana(foldLatin(text.normalize('NFKC'))).replace(PUNCT, '')
}

export function latinKey(text: string): string {
  const tokens = foldLatin(text.normalize('NFKC'))
    .replace(/[_\-.,:;!?'"’・/]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) =>
      token
        .replace(/([aeiou])h(?![aeiouy])/g, '$1')
        .replace(/ou|oo/g, 'o')
        .replace(/uu/g, 'u')
        .replace(/aa/g, 'a')
        .replace(/ii/g, 'i')
        .replace(/ee/g, 'e')
        .replace(/nn/g, 'n'),
    )
  return tokens.sort().join(' ')
}

export function qualifiers(text: string): { base: string; quals: string[] } {
  const quals: string[] = []
  const base = text
    .normalize('NFKC')
    .replace(/[\s_]*\(([^)]*)\)/g, (_, inner: string) => {
      quals.push(inner)
      return ''
    })
    .trim()
  return { base, quals }
}

type HangulStyle = 'standard' | 'fan' | 'fan-long'

const FAN: Record<string, string> = {
  あ: '아',
  い: '이',
  う: '우',
  え: '에',
  お: '오',
  か: '카',
  き: '키',
  く: '쿠',
  け: '케',
  こ: '코',
  が: '가',
  ぎ: '기',
  ぐ: '구',
  げ: '게',
  ご: '고',
  さ: '사',
  し: '시',
  す: '스',
  せ: '세',
  そ: '소',
  ざ: '자',
  じ: '지',
  ず: '즈',
  ぜ: '제',
  ぞ: '조',
  た: '타',
  ち: '치',
  つ: '츠',
  て: '테',
  と: '토',
  だ: '다',
  ぢ: '지',
  づ: '즈',
  で: '데',
  ど: '도',
  な: '나',
  に: '니',
  ぬ: '누',
  ね: '네',
  の: '노',
  は: '하',
  ひ: '히',
  ふ: '후',
  へ: '헤',
  ほ: '호',
  ば: '바',
  び: '비',
  ぶ: '부',
  べ: '베',
  ぼ: '보',
  ぱ: '파',
  ぴ: '피',
  ぷ: '푸',
  ぺ: '페',
  ぽ: '포',
  ま: '마',
  み: '미',
  む: '무',
  め: '메',
  も: '모',
  や: '야',
  ゆ: '유',
  よ: '요',
  ら: '라',
  り: '리',
  る: '루',
  れ: '레',
  ろ: '로',
  わ: '와',
  を: '오',
  ゔ: '부',
  きゃ: '캬',
  きゅ: '큐',
  きょ: '쿄',
  ぎゃ: '갸',
  ぎゅ: '규',
  ぎょ: '교',
  しゃ: '샤',
  しゅ: '슈',
  しょ: '쇼',
  じゃ: '쟈',
  じゅ: '쥬',
  じょ: '죠',
  ちゃ: '챠',
  ちゅ: '츄',
  ちょ: '쵸',
  にゃ: '냐',
  にゅ: '뉴',
  にょ: '뇨',
  ひゃ: '햐',
  ひゅ: '휴',
  ひょ: '효',
  びゃ: '뱌',
  びゅ: '뷰',
  びょ: '뵤',
  ぴゃ: '퍄',
  ぴゅ: '퓨',
  ぴょ: '표',
  みゃ: '먀',
  みゅ: '뮤',
  みょ: '묘',
  りゃ: '랴',
  りゅ: '류',
  りょ: '료',
  ふぁ: '파',
  ふぃ: '피',
  ふぇ: '페',
  ふぉ: '포',
  てぃ: '티',
  でぃ: '디',
  うぃ: '위',
  うぇ: '웨',
  うぉ: '워',
  しぇ: '셰',
  じぇ: '제',
  ちぇ: '체',
  ゔぁ: '바',
  ゔぃ: '비',
  ゔぇ: '베',
  ゔぉ: '보',
}

const STANDARD_INITIAL: Record<string, string> = {
  か: '가',
  き: '기',
  く: '구',
  け: '게',
  こ: '고',
  た: '다',
  ち: '지',
  つ: '쓰',
  て: '데',
  と: '도',
  きゃ: '갸',
  きゅ: '규',
  きょ: '교',
  ちゃ: '자',
  ちゅ: '주',
  ちょ: '조',
  じゃ: '자',
  じゅ: '주',
  じょ: '조',
}

const STANDARD_MEDIAL: Record<string, string> = {
  つ: '쓰',
  ちゃ: '차',
  ちゅ: '추',
  ちょ: '초',
  じゃ: '자',
  じゅ: '주',
  じょ: '조',
}

function addFinal(syllable: string, final: 'n' | 's'): string {
  const code = (syllable.codePointAt(0) ?? 0) - 0xac00
  if (code < 0 || code >= 11172 || code % 28 !== 0) {
    return syllable
  }
  return String.fromCodePoint(0xac00 + code + (final === 'n' ? 4 : 19))
}

function vowelOf(syllable: string): string {
  return romajiOf(syllable)?.at(-1) ?? ''
}

function isLong(previous: string, part: string): boolean {
  const vowel = vowelOf(previous)
  return (
    (vowel === 'o' && (part === 'う' || part === 'お')) ||
    (vowel === 'u' && part === 'う') ||
    (vowel === 'i' && part === 'い') ||
    (vowel === 'a' && part === 'あ') ||
    (vowel === 'e' && part === 'え')
  )
}

function hangulWord(word: string, style: HangulStyle): string {
  const out: string[] = []
  let previous = ''
  for (const part of syllables(word)) {
    if (part === 'ん' || part === 'っ') {
      const last = out.pop()
      if (last === undefined) return ''
      out.push(addFinal(last, part === 'ん' ? 'n' : 's'))
      previous = part
      continue
    }
    if (part === 'ー' || (previous && isLong(previous, part) && style !== 'fan-long')) {
      previous = part
      continue
    }
    const table = style === 'standard' ? (out.length === 0 ? STANDARD_INITIAL : STANDARD_MEDIAL) : {}
    const syllable = table[part] ?? FAN[part]
    if (!syllable) return ''
    out.push(syllable)
    previous = part
  }
  return out.join('')
}

export function kanaToHangul(kana: string, style: HangulStyle): string {
  const words = toHiragana(kana.normalize('NFKC'))
    .split(/[\s・·=＝]+/)
    .filter(Boolean)
  const converted = words.map((word) => hangulWord(word, style))
  return converted.length === 0 || converted.some((word) => !word) ? '' : converted.join(' ')
}

export function hangulVariants(kana: string): string[] {
  const out = new Set<string>()
  for (const style of ['standard', 'fan', 'fan-long'] as const) {
    const text = kanaToHangul(kana, style)
    if (text) out.add(text)
  }
  return [...out]
}
