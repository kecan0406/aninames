import { convertHangulToQwerty, convertQwertyToHangul } from 'es-hangul'
import type { NameKind } from './model.ts'

export const TOP = '\u{10FFFF}'

const NAME_WEIGHT: Record<NameKind, number> = {
  main: 1,
  official: 1,
  reading: 1,
  synonym: 0.95,
  short: 0.95,
  redirect: 0.92,
  section: 0.6,
  generated: 0.85,
}

const WEAK: ReadonlySet<NameKind> = new Set(['synonym', 'short', 'redirect', 'section'])

export function weightOf(row: { kind: NameKind; variant: number; support: number }): number {
  return NAME_WEIGHT[row.kind] * (row.variant ? 0.9 : 1) * (row.support <= 1 && WEAK.has(row.kind) ? 0.93 : 1)
}

const INITIAL_JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

export function typing(q: string): [string, string][] {
  const ranges: [string, string][] = [[q, `${q}${TOP}`]]
  const chars = [...q]
  const last = chars.at(-1) ?? ''
  const head = chars.slice(0, -1).join('')
  const code = (last.codePointAt(0) ?? 0) - 0xac00
  if (code >= 0 && code < 11172 && code % 28 === 0) {
    ranges.push([
      `${head}${String.fromCodePoint(0xac00 + code + 1)}`,
      `${head}${String.fromCodePoint(0xac00 + code + 27)}${TOP}`,
    ])
  }
  const conjoined = (last.codePointAt(0) ?? 0) - 0x1100
  const initial = conjoined >= 0 && conjoined < 19 ? conjoined : INITIAL_JAMO.indexOf(last)
  if (initial >= 0 && head) {
    ranges.push([
      `${head}${String.fromCodePoint(0xac00 + initial * 588)}`,
      `${head}${String.fromCodePoint(0xac00 + initial * 588 + 587)}${TOP}`,
    ])
  }
  const kana = /^([\p{Script=Hiragana}\p{Script=Katakana}ー]+)[a-z]+$/u.exec(q)?.[1]
  if (kana) ranges.push([kana, `${kana}${TOP}`])
  return ranges
}

export function swapLayout(query: string): string | undefined {
  const text = query.trim()
  try {
    if (/[a-z]/i.test(text) && !/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
      const hangul = text.replace(/[a-z]+/gi, (run) => convertQwertyToHangul(run))
      return /[ㄱ-ㅎㅏ-ㅣ]/.test(hangul) || !/\p{Script=Hangul}/u.test(hangul) ? undefined : hangul
    }
    if (/\p{Script=Hangul}/u.test(text) && !/[a-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/iu.test(text)) {
      return text.replace(/[\p{Script=Hangul}]+/gu, (run) => convertHangulToQwerty(run)).toLowerCase()
    }
  } catch {
    return undefined
  }
  return undefined
}
