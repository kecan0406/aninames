import { expect, test } from 'bun:test'
import type { Staged } from '../src/build.ts'
import type { Entry } from '../src/model.ts'
import { characterKey, link } from '../src/spine.ts'
import { node } from '../src/union.ts'

test('a name key ranks a full Japanese name over a long kana one, a two-word Latin one, a given name and one word', () => {
  expect(characterKey('我妻善逸')).toEqual({ key: 'ja|我妻善逸', level: 4 })
  expect(characterKey('ユーフェミア・リ・ブリタニア')?.level).toBe(4)
  expect(characterKey('セーラーマーキュリー')?.level).toBe(3)
  expect(characterKey('Zenitsu Agatsuma')).toEqual({ key: 'latin|agatsuma zenitsu', level: 2 })
  expect(characterKey('ジェリー')).toEqual({ key: 'ja|じぇりー', level: 1 })
  expect(characterKey('レム')?.level).toBe(0)
  expect(characterKey('D.Va')).toEqual({ key: 'latin|dva', level: 0 })
  expect(characterKey('rem (re:zero)')?.key).toBe(characterKey('Rem')?.key)
})

const staged = (source: string, entry: Entry): Staged => ({
  source,
  layer: source === 'bangumi' || source === 'danbooru' ? 'unlicensed' : 'core',
  entry,
  popularity: 0,
})

test('only Bangumi makes entities; others join one by an id, a title or a name no other Bangumi entry in reach has', () => {
  const union = link([
    staged('bangumi', {
      id: 'bangumi:247',
      kind: 'work',
      names: [{ text: '銀魂', kind: 'official' }],
      type: 'TV',
      year: 2006,
    }),
    staged('bangumi', {
      id: 'bangumi:11834',
      kind: 'work',
      names: [{ text: '銀魂', kind: 'official' }],
      type: 'TV',
      year: 2011,
    }),
    staged('bangumi', {
      id: 'bangumi:140001',
      kind: 'work',
      names: [
        { text: 'Re:ゼロから始める異世界生活', kind: 'official' },
        { text: 'Re:Zero', lang: 'en', kind: 'synonym' },
      ],
      type: 'TV',
      year: 2016,
    }),
    staged('bangumi', { id: 'bangumi:9', kind: 'work', names: [{ text: '別の作品', kind: 'official' }], type: 'TV' }),
    staged('bangumi', {
      id: 'bangumi:1',
      kind: 'character',
      names: [{ text: 'レム', kind: 'official' }],
      works: ['bangumi:140001'],
    }),
    staged('bangumi', {
      id: 'bangumi:2',
      kind: 'character',
      names: [{ text: 'レム', kind: 'official' }],
      works: ['bangumi:9'],
    }),
    staged('bangumi', {
      id: 'bangumi:3',
      kind: 'character',
      names: [{ text: '後藤ひとり', kind: 'official' }],
      works: ['bangumi:9'],
    }),
    staged('wikidata', {
      id: 'wikidata:Q1',
      kind: 'work',
      names: [],
      refs: ['bangumi:247', 'bangumi:11834', 'mal:918'],
    }),
    staged('aod', { id: 'mal:918', kind: 'work', names: [{ text: '銀魂', kind: 'main' }], year: 2006 }),
    staged('aod', { id: 'mal:28977', kind: 'work', names: [{ text: '銀魂', kind: 'main' }], year: 2011 }),
    staged('anidb', { id: 'anidb:1', kind: 'work', names: [{ text: '銀魂', kind: 'main' }] }),
    staged('danbooru', {
      id: 'danbooru:rem_(re:zero)',
      kind: 'character',
      names: [{ text: 'レム', lang: 'ja', kind: 'synonym' }],
    }),
    staged('danbooru', {
      id: 'danbooru:gotoh_hitori',
      kind: 'character',
      names: [{ text: '後藤ひとり', lang: 'ja', kind: 'synonym' }],
    }),
    staged('danbooru', {
      id: 'danbooru:rem_(cosplay)',
      kind: 'character',
      names: [{ text: 'レム', lang: 'ja', kind: 'synonym' }],
    }),
  ])
  const anchor = (kind: 'work' | 'character', id: string) => union.anchorOf(node(kind, id))
  expect(anchor('work', 'wikidata:Q1')).toBe('work|bangumi:247')
  expect(anchor('work', 'bangumi:11834')).toBe('work|bangumi:11834')
  expect(union.refused).toBe(1)
  expect(anchor('work', 'mal:918')).toBe('work|bangumi:247')
  expect(anchor('work', 'mal:28977')).toBe('work|bangumi:11834')
  expect(anchor('work', 'anidb:1')).toBeUndefined()
  expect(anchor('character', 'danbooru:rem_(re:zero)')).toBe('character|bangumi:1')
  expect(anchor('character', 'danbooru:gotoh_hitori')).toBe('character|bangumi:3')
  expect(anchor('character', 'danbooru:rem_(cosplay)')).toBeUndefined()
})
