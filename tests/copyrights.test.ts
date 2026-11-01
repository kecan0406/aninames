import { expect, test } from 'bun:test'
import type { Staged } from '../src/build.ts'
import { apart, type Copyrights, closestWork, type Drawn, drawnOf, ownersOf } from '../src/copyrights.ts'
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

  const union = link(
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
