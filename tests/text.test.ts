import { expect, test } from 'bun:test'
import { flat, hangulVariants, kanaToHangul, kanaToRomaji, latinKey, qualifiers, soundKeys } from '../src/text.ts'

test('kana becomes Hepburn romaji', () => {
  expect(kanaToRomaji('ごとう ひとり')).toBe('gotou hitori')
  expect(kanaToRomaji('シュタインズ・ゲート')).toBe('shutainzu geeto')
  expect(kanaToRomaji('ぼっち')).toBe('botchi')
  expect(kanaToRomaji('じゅんいちろう')).toBe("jun'ichirou")
})

test('the national standard writes plain initials, つ as 쓰 and drops long vowels', () => {
  expect(kanaToHangul('かまど たんじろう', 'standard')).toBe('가마도 단지로')
  expect(kanaToHangul('はつね みく', 'standard')).toBe('하쓰네 미쿠')
  expect(kanaToHangul('ながと', 'standard')).toBe('나가토')
  expect(kanaToHangul('ちゃちゃまる', 'standard')).toBe('자차마루')
})

test('fan spelling writes aspirated initials and 츠, with and without long vowels', () => {
  expect(hangulVariants('ごじょう さとる')).toEqual(['고조 사토루', '고죠 사토루', '고죠우 사토루'])
  expect(kanaToHangul('はつね みく', 'fan')).toBe('하츠네 미쿠')
})

test('sound keys meet across kana, Hangul and romaji spellings and name order', () => {
  const same = (a: string, b: string) => expect(soundKeys(a).some((k) => soundKeys(b).includes(k))).toBe(true)
  same('ごとう ひとり', '고토 히토리')
  same('ごとう ひとり', 'hitori gotoh')
  same('まきせ くりす', '마키세 크리스')
  same('れむ', '렘')
  same('Hitori Gotō', 'ゴトウ・ヒトリ')
  expect(soundKeys('後藤ひとり')).toEqual([])
})

test('flat keeps voiced kana and drops punctuation', () => {
  expect(flat('シュタゲ')).toBe('しゅたげ')
  expect(flat('Steins;Gate')).toBe('steinsgate')
  expect(flat('봇치 더 록!')).toBe('봇치더록')
})

test('latin keys ignore name order and long-vowel spelling', () => {
  expect(latinKey('Hitori Gotoh')).toBe(latinKey('gotou_hitori'))
  expect(latinKey('Tōsaka Rin')).toBe(latinKey('rin tohsaka'))
})

test('qualifiers split off a trailing series in parentheses', () => {
  expect(qualifiers('rem (re:zero)')).toEqual({ base: 'rem', quals: ['re:zero'] })
  expect(qualifiers('봇치 더 록! (애니메이션 1기)')).toEqual({ base: '봇치 더 록!', quals: ['애니메이션 1기'] })
})
