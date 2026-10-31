import { expect, test } from 'bun:test'
import { adultCharactersOf, familyOf, groupsOf, homeOf, learnedOf, tierOf, votedOf } from '../src/build.ts'
import type { Entry, Ref } from '../src/model.ts'

test('a copyright tag takes every same-title work the evidence ties together, and refuses an even split', () => {
  const ties = new Set(['tv|film', 'film|manga', 'game|tv'])
  const tied = (a: string, b: string) => ties.has(`${a}|${b}`) || ties.has(`${b}|${a}`)
  const series = groupsOf(['tv', 'film', 'manga', 'game', 'stray'], tied)
  expect(series).toEqual([['tv', 'film', 'manga', 'game'], ['stray']])
  expect(familyOf(series, new Set())).toEqual(['tv', 'film', 'manga', 'game'])
  expect(familyOf(series, new Set(['stray']))).toEqual(['stray'])
  expect(familyOf([['tv'], ['film', 'manga'], ['game']], new Set(['game', 'tv']))).toEqual(['tv', 'game'])
  expect(
    familyOf(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      new Set(),
    ),
  ).toEqual([])
  expect(familyOf([['a'], ['b']], new Set())).toEqual([])
  expect(familyOf([['a', 'b'], ['c']], new Set())).toEqual(['a', 'b'])
  expect(familyOf([['solo']], new Set())).toEqual(['solo'])
  expect(familyOf([], new Set())).toEqual([])
})

test('a character goes home by its qualifier, then by its works, then by what characters sharing its qualifier chose', () => {
  const direct = new Map([['tidepool', 'tidepool_academy']])
  const learned = new Map([['tpa', 'tidepool_academy']])
  const anything = () => true
  expect(homeOf(['tidepool'], direct, 'crossover_quest', learned, anything)).toBe('tidepool_academy')
  expect(homeOf(['tpa'], direct, 'crossover_quest', learned, anything)).toBe('crossover_quest')
  expect(homeOf(['tpa'], direct, undefined, learned, anything)).toBe('tidepool_academy')
  expect(homeOf(['tpa'], direct, undefined, learned, (tag) => tag === 'crossover_quest')).toBeUndefined()
  expect(homeOf([], direct, undefined, learned, anything)).toBeUndefined()
  const votes = new Map([
    [
      'tpa',
      new Map([
        ['tidepool_academy', 4],
        ['crossover_quest', 1],
      ]),
    ],
    [
      'split',
      new Map([
        ['tidepool_academy', 2],
        ['crossover_quest', 2],
      ]),
    ],
    ['once', new Map([['tidepool_academy', 1]])],
  ])
  expect(learnedOf(votes)).toEqual(new Map([['tpa', 'tidepool_academy']]))
})

test("a character's works choose the tag most of them carry, a tie going to the one with more posts", () => {
  const posts = (tag: string) =>
    new Map([
      ['academy_saga', 9000],
      ['tidepool_academy', 400],
      ['crossover_quest', 50000],
    ]).get(tag) ?? 0
  expect(
    votedOf(
      new Map([
        ['tidepool_academy', 4],
        ['crossover_quest', 1],
      ]),
      posts,
    ),
  ).toBe('tidepool_academy')
  expect(
    votedOf(
      new Map([
        ['tidepool_academy', 1],
        ['crossover_quest', 1],
      ]),
      posts,
    ),
  ).toBe('crossover_quest')
  expect(
    votedOf(
      new Map([
        ['tidepool_academy', 2],
        ['academy_saga', 2],
        ['crossover_quest', 1],
      ]),
      posts,
    ),
  ).toBe('academy_saga')
  expect(votedOf(new Map(), posts)).toBeUndefined()
})

test("a character's place in its home's cast is its best role in a work of that home, then whether a catalog knows it", () => {
  const home = new Set(['harbor_tv', 'harbor_film'])
  const reaches = (work: string) => home.has(work)
  expect(
    tierOf(
      new Map([
        ['harbor_tv', 1],
        ['harbor_film', 0],
      ]),
      reaches,
      true,
    ),
  ).toBe(0)
  expect(
    tierOf(
      new Map([
        ['harbor_tv', 1],
        ['crossover_quest', 0],
      ]),
      reaches,
      true,
    ),
  ).toBe(1)
  expect(tierOf(new Map([['harbor_tv', 2]]), reaches, true)).toBe(2)
  expect(tierOf(new Map(), reaches, true)).toBe(2)
  expect(tierOf(new Map(), reaches, false)).toBe(3)
})

test('a character is adult only when every work it is in, in any layer, is adult', () => {
  const character = (id: string, layers: Ref[][]) => ({
    id,
    kind: 'character' as const,
    members: layers.map((works): { entry: Entry } => ({ entry: { id: 'vndb:c1', names: [], works } })),
  })
  const found = adultCharactersOf(
    [
      character('c/parody', [['vndb:v1']]),
      character('c/guest', [['vndb:v1'], ['bangumi:7']]),
      character('c/unplaced', [[]]),
    ],
    (work) => `w/${work}`,
    new Set(['w/vndb:v1']),
  )
  expect([...found]).toEqual(['c/parody'])
})
