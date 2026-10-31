import type { Kind, Ref } from '../src/model.ts'

export interface Golden {
  query: string
  kind: Kind
  expect: Ref[]
}

const BOCCHI: Ref[] = ['mal:47917', 'mal:61006']
const KAGUYA: Ref[] = ['mal:37999', 'mal:40591', 'mal:43608']
const REZERO: Ref[] = ['mal:31240', 'mal:39587', 'mal:42203', 'mal:54857', 'mal:61316']
const STEINSGATE: Ref[] = ['mal:9253', 'vndb:v2002']
const FRIEREN: Ref[] = ['mal:52991', 'mal:59978']
const MADOKA: Ref[] = ['mal:9756']

export const TITLES: Golden[] = [
  { query: 'ぼっち・ざ・ろっく', kind: 'work', expect: BOCCHI },
  { query: 'bocchi', kind: 'work', expect: BOCCHI },
  { query: '봇치 더 록', kind: 'work', expect: BOCCHI },
  { query: '孤独摇滚', kind: 'work', expect: BOCCHI },
  { query: 'Kaguya-sama', kind: 'work', expect: KAGUYA },
  { query: 'かぐや様', kind: 'work', expect: KAGUYA },
  { query: 're zero', kind: 'work', expect: REZERO },
  { query: 'リゼロ', kind: 'work', expect: REZERO },
  { query: 'Steins Gate', kind: 'work', expect: STEINSGATE },
  { query: 'シュタゲ', kind: 'work', expect: STEINSGATE },
  { query: 'Frieren', kind: 'work', expect: FRIEREN },
  { query: '葬送のフリーレン', kind: 'work', expect: FRIEREN },
  { query: '프리렌', kind: 'work', expect: FRIEREN },
  { query: 'madoka magica', kind: 'work', expect: MADOKA },
  { query: 'まどマギ', kind: 'work', expect: MADOKA },
]

const HITORI: Ref[] = ['wikidata:Q113317037', 'danbooru:gotoh_hitori']
const REM: Ref[] = ['danbooru:rem_(re:zero)']
const OKABE: Ref[] = ['danbooru:okabe_rintarou']
const KURISU: Ref[] = ['danbooru:makise_kurisu']
const MAMI: Ref[] = ['danbooru:tomoe_mami']

export const CHARACTERS: Golden[] = [
  { query: '後藤ひとり', kind: 'character', expect: HITORI },
  { query: 'gotou hitori', kind: 'character', expect: HITORI },
  { query: 'hitori gotoh', kind: 'character', expect: HITORI },
  { query: '고토 히토리', kind: 'character', expect: HITORI },
  { query: 'Rem re zero', kind: 'character', expect: REM },
  { query: 'レム', kind: 'character', expect: REM },
  { query: 'Okabe Rintarou', kind: 'character', expect: OKABE },
  { query: '鳳凰院凶真', kind: 'character', expect: OKABE },
  { query: 'Makise Kurisu', kind: 'character', expect: KURISU },
  { query: '牧瀬紅莉栖', kind: 'character', expect: KURISU },
  { query: '마키세 크리스', kind: 'character', expect: KURISU },
  { query: 'Tomoe Mami', kind: 'character', expect: MAMI },
  { query: '巴マミ', kind: 'character', expect: MAMI },
  { query: 'Ahri', kind: 'character', expect: ['danbooru:ahri_(league_of_legends)'] },
]

export const SAME: [Ref, Ref][] = [
  ['danbooru:d.va_(overwatch)', 'bangumi:42247'],
  ['danbooru:kitagawa_yusuke', 'bangumi:41231'],
  ['danbooru:lucy_(cyberpunk)', 'wikidata:Q114067612'],
  ['danbooru:sailor_mercury', 'wikidata:Q429403'],
]

export const APART: [Ref, Ref][] = [
  ['vndb:c151730', 'wikidata:Q109321740'],
  ['vndb:c151703', 'wikidata:Q130425850'],
  ['danbooru:goemon_(persona_5)', 'bangumi:41231'],
]

export const TYPOS: Golden[] = [
  { query: 'Steins Gat', kind: 'work', expect: STEINSGATE },
  { query: 'Frieran', kind: 'work', expect: FRIEREN },
  { query: 'madokka magica', kind: 'work', expect: MADOKA },
  { query: 'kaguya sama love is war', kind: 'work', expect: KAGUYA },
  { query: 'bocchi za rokku', kind: 'work', expect: BOCCHI },
  { query: 'Makise Kurisuu', kind: 'character', expect: KURISU },
  { query: 'Okabe Rintaro', kind: 'character', expect: OKABE },
  { query: 'Hitori Goto', kind: 'character', expect: HITORI },
  { query: 'Mami Tomoe', kind: 'character', expect: MAMI },
]
