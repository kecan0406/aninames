import { expect, test } from 'bun:test'
import type { Staged } from '../src/build.ts'
import { apart, type Copyrights, closestWork, type Drawn, drawnOf, ownersOf } from '../src/copyrights.ts'
import type { Ref } from '../src/model.ts'
import { link } from '../src/spine.ts'
import { node } from '../src/union.ts'

const drawn = (posts: number, ...works: [string, number][]): Drawn => ({ posts, works })

test('the closest work is the one the character takes up most of, not the widest franchise', () => {
  const sizes = new Map([
    ['starfall_franchise', 90000],
    ['starfall_academy', 3000],
  ])
  const pip = drawn(1000, ['starfall_franchise', 1000], ['starfall_academy', 900])

  expect(closestWork(pip, sizes)).toBe('starfall_academy')
})

test('a franchise with no narrower work is the closest one, however large', () => {
  expect(closestWork(drawn(1000, ['starfall_franchise', 1000]), new Map([['starfall_franchise', 90000]]))).toBe(
    'starfall_franchise',
  )
  expect(closestWork(drawn(0), new Map())).toBeUndefined()
})

test('a few posts that are mostly another work do not place a character', () => {
  expect(closestWork(drawn(7, ['touhou', 4]), new Map([['touhou', 900000]]))).toBeUndefined()
  expect(closestWork(drawn(7, ['touhou', 7]), new Map([['touhou', 900000]]))).toBe('touhou')
})

test('the first tag with counts speaks for a character', () => {
  const pip = drawn(10, ['starfall', 10])
  const copyrights: Copyrights = { characters: new Map([['pip', pip]]), sizes: new Map() }

  expect(drawnOf(['pip_(cosplay)', 'pip'], copyrights)).toBe(pip)
  expect(drawnOf(['nobody'], copyrights)).toBeUndefined()
})

test('only a copyright on nearly all its posts owns a character, so a crossover does not', () => {
  const pip = drawn(100, ['starfall_academy', 100], ['starfall', 95], ['tidewater', 30])

  expect(ownersOf(pip, 'starfall_academy')).toEqual(['starfall'])
})

test('two tags are apart only when both are drawn enough and share no work', () => {
  const harbor = drawn(100, ['moonlit_harbor', 100])
  const also = drawn(50, ['moonlit_harbor', 40], ['starfall', 30])
  const tide = drawn(20, ['tidewater', 20])
  const rare = drawn(2, ['tidewater', 2])

  expect(apart(harbor, tide)).toBe(true)
  expect(apart(harbor, also)).toBe(false)
  expect(apart(harbor, rare)).toBe(false)
})

const staged = (source: string, entry: Staged['entry']): Staged => ({
  source,
  layer: 'unlicensed',
  entry,
  popularity: 0,
})

test('a tag drawn in other works stays off a character the larger tag already reached', () => {
  const copyrights: Copyrights = {
    characters: new Map([
      ['nell_(moonlit_harbor)', drawn(500, ['moonlit_harbor', 500])],
      ['nell_(tidewater)', drawn(40, ['tidewater', 40])],
    ]),
    sizes: new Map(),
  }

  const { union } = link(
    [
      staged('bangumi', {
        id: 'bangumi:1',
        kind: 'character',
        names: [{ text: 'ネルネル', lang: 'ja', kind: 'official' }],
      }),
      staged('danbooru', {
        id: 'danbooru:nell_(tidewater)',
        kind: 'character',
        names: [{ text: 'ネルネル', lang: 'ja', kind: 'synonym' }],
      }),
      staged('danbooru', {
        id: 'danbooru:nell_(moonlit_harbor)',
        kind: 'character',
        names: [{ text: 'ネルネル', lang: 'ja', kind: 'synonym' }],
      }),
    ],
    false,
    copyrights,
  )

  const person = union.find(node('character', 'bangumi:1'))

  expect(union.find(node('character', 'danbooru:nell_(moonlit_harbor)'))).toBe(person)
  expect(union.find(node('character', 'danbooru:nell_(tidewater)'))).not.toBe(person)
})

const work = (id: Ref, text: string, extra: Partial<Staged['entry']> = {}): Staged =>
  staged('bangumi', { id, kind: 'work', names: [{ text, lang: 'ja', kind: 'official' }], ...extra })

const person = (id: Ref, text: string, works: Ref[], kind: 'official' | 'synonym' = 'official'): Staged =>
  staged('bangumi', { id, kind: 'character', names: [{ text, lang: 'ja', kind }], works })

const copyright = (id: Ref, text: string): Staged =>
  staged('danbooru', { id, kind: 'work', attach: true, family: true, names: [{ text, kind: 'main' }], link: [text] })

const tag = (id: Ref, ...names: string[]): Staged =>
  staged('danbooru', { id, kind: 'character', names: names.map((text) => ({ text, kind: 'main' as const })) })

test('a one-word tag takes the only character of that name in the works its posts are tagged with', () => {
  const copyrights: Copyrights = {
    characters: new Map([['rin_(moon_harbor)', drawn(100, ['moon_harbor', 100])]]),
    sizes: new Map(),
  }
  const { union } = link(
    [
      work('bangumi:1', '月の港'),
      work('bangumi:2', '別の話'),
      person('bangumi:10', 'リン', ['bangumi:1']),
      person('bangumi:11', 'リン', ['bangumi:2']),
      copyright('danbooru:moon_harbor', '月の港'),
      tag('danbooru:rin_(moon_harbor)', 'リン'),
    ],
    false,
    copyrights,
  )

  expect(union.find(node('character', 'danbooru:rin_(moon_harbor)'))).toBe(union.find(node('character', 'bangumi:10')))
})

test('a costume tag joins the character of its plain tag, unless its own name is a character of its own', () => {
  const copyrights: Copyrights = {
    characters: new Map([
      ['pip_(moon_harbor)', drawn(100, ['moon_harbor', 100])],
      ['pip_(bunny)_(moon_harbor)', drawn(50, ['moon_harbor', 50])],
      ['pip_(storm)_(moon_harbor)', drawn(40, ['moon_harbor', 40])],
    ]),
    sizes: new Map(),
  }
  const { union } = link(
    [
      work('bangumi:1', '月の港'),
      person('bangumi:10', 'ピップ・ハーバー', ['bangumi:1']),
      person('bangumi:11', '嵐のピップ', ['bangumi:1']),
      copyright('danbooru:moon_harbor', '月の港'),
      tag('danbooru:pip_(moon_harbor)', 'ピップ・ハーバー'),
      tag('danbooru:pip_(bunny)_(moon_harbor)', 'バニーピップ'),
      tag('danbooru:pip_(storm)_(moon_harbor)', '嵐のピップ'),
    ],
    false,
    copyrights,
  )
  const pip = union.find(node('character', 'bangumi:10'))

  expect(union.find(node('character', 'danbooru:pip_(moon_harbor)'))).toBe(pip)
  expect(union.find(node('character', 'danbooru:pip_(bunny)_(moon_harbor)'))).toBe(pip)
  expect(union.find(node('character', 'danbooru:pip_(storm)_(moon_harbor)'))).toBe(
    union.find(node('character', 'bangumi:11')),
  )
})

test('a franchise tag no title places goes to the earliest work its name is in and its characters appear in', () => {
  const shared = (name: string) => ({ posts: 100, works: [[name, 100]] as [string, number][] })
  const copyrights: Copyrights = {
    characters: new Map([
      ['aki', shared('star_saga')],
      ['bea', shared('star_saga')],
    ]),
    sizes: new Map(),
  }
  const { graph } = link(
    [
      work('bangumi:1', 'スターサーガII', { year: 2001 }),
      work('bangumi:2', 'スターサーガIII', { year: 2005 }),
      work('bangumi:3', '別の話', { year: 1999 }),
      person('bangumi:10', '秋山亜紀', ['bangumi:1', 'bangumi:2', 'bangumi:3']),
      person('bangumi:11', '石川美亜', ['bangumi:1', 'bangumi:2', 'bangumi:3']),
      staged('danbooru', {
        id: 'danbooru:star_saga',
        kind: 'work',
        attach: true,
        family: true,
        names: [{ text: 'star saga', kind: 'main' }],
        link: ['star saga', 'スターサーガ'],
      }),
      tag('danbooru:aki', '秋山亜紀'),
      tag('danbooru:bea', '石川美亜'),
    ],
    false,
    copyrights,
  )

  expect(graph.families.get('danbooru:star_saga')?.works).toEqual([node('work', 'bangumi:1')])
})
