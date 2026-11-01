import { expect, test } from 'bun:test'
import { adultCharactersOf, familyOf, groupsOf } from '../src/build.ts'
import { chosenOf, homeOf, learnedOf, tierOf } from '../src/homes.ts'
import type { Entry, Ref } from '../src/model.ts'

test('a copyright tag takes the same-title works the evidence ties together: the group its own name finds, else a group holding most of them, never a tie', () => {
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
  expect(familyOf([['vn', 'tv', 'manga'], ['comic'], ['comic_2']], new Set())).toEqual(['vn', 'tv', 'manga'])
  expect(familyOf([['vn', 'tv'], ['stray'], ['other']], new Set())).toEqual([])
  expect(familyOf([['game'], ['namesake']], new Set(), new Set(['game']))).toEqual(['game'])
  expect(familyOf([['a', 'b'], ['c'], ['d']], new Set(), new Set(['c', 'd']))).toEqual([])
  expect(familyOf([['solo']], new Set())).toEqual(['solo'])
  expect(familyOf([], new Set())).toEqual([])
})

test('a character goes home by the tag most of its works reach, then by its qualifier, then by its works or what characters sharing its qualifier chose', () => {
  expect(homeOf({ tag: 'crossover_quest', most: true }, 'tidepool_academy', undefined)).toBe('crossover_quest')
  expect(homeOf({ tag: 'crossover_quest', most: false }, 'tidepool_academy', undefined)).toBe('tidepool_academy')
  expect(homeOf({ tag: 'crossover_quest', most: false }, undefined, 'academy_saga')).toBe('crossover_quest')
  expect(homeOf(undefined, undefined, 'tidepool_academy')).toBe('tidepool_academy')
  expect(homeOf(undefined, undefined, undefined)).toBeUndefined()
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

test("a character's works choose the most specific tag most of them reach and that is big enough, else the tag the most of them carry", () => {
  const posts = (tag: string) =>
    new Map([
      ['academy_saga', 90000],
      ['tidepool_academy', 400],
      ['tidepool_drama_cd', 120],
      ['crossover_quest', 50000],
    ]).get(tag) ?? 0
  const all = () => true
  const work = (weight: number, ...tags: [string, number][]) => ({ weight, tags: new Map(tags) })
  const games = [
    work(2, ['tidepool_academy', 0], ['academy_saga', 1]),
    work(2, ['tidepool_drama_cd', 0], ['academy_saga', 1]),
    work(2, ['academy_saga', 0]),
  ]
  expect(chosenOf(games, all, posts)).toEqual({ tag: 'academy_saga', most: true })
  const series = [
    work(2, ['tidepool_academy', 0], ['academy_saga', 1]),
    work(2, ['tidepool_academy', 0], ['academy_saga', 1]),
  ]
  expect(chosenOf(series, all, posts)).toEqual({ tag: 'tidepool_academy', most: true })
  expect(chosenOf(series, (tag) => tag !== 'tidepool_academy', posts)).toEqual({ tag: 'academy_saga', most: true })
  const lead = [work(3, ['tidepool_academy', 0]), work(2, ['crossover_quest', 0])]
  expect(chosenOf(lead, all, posts)).toEqual({ tag: 'tidepool_academy', most: true })
  const spread = [
    work(2, ['tidepool_academy', 0]),
    work(2, ['tidepool_academy', 0]),
    work(2, ['crossover_quest', 0]),
    work(2, ['tidepool_drama_cd', 0]),
  ]
  expect(chosenOf(spread, all, posts)).toEqual({ tag: 'tidepool_academy', most: false })
  const even = [work(2, ['tidepool_academy', 0]), work(2, ['crossover_quest', 0])]
  expect(chosenOf(even, all, posts)).toEqual({ tag: 'crossover_quest', most: false })
  expect(chosenOf(even, (tag) => tag !== 'crossover_quest', posts)).toEqual({ tag: 'tidepool_academy', most: false })
  expect(chosenOf([work(2)], all, posts)).toBeUndefined()
})

test("a character's place in its home's cast is its best role in a work of that home, a lead counting only in a work with a third of the home's most collected", () => {
  const home = new Map([
    ['harbor_tv', 30000],
    ['harbor_film', 12000],
    ['harbor_spinoff', 900],
  ])
  const size = (work: string) => home.get(work)
  expect(
    tierOf(
      new Map([
        ['harbor_tv', 1],
        ['harbor_film', 0],
      ]),
      size,
      30000,
    ),
  ).toBe(0)
  expect(
    tierOf(
      new Map([
        ['harbor_tv', 1],
        ['crossover_quest', 0],
      ]),
      size,
      30000,
    ),
  ).toBe(1)
  expect(
    tierOf(
      new Map([
        ['harbor_tv', 2],
        ['harbor_spinoff', 0],
      ]),
      size,
      30000,
    ),
  ).toBe(1)
  expect(tierOf(new Map([['harbor_tv', 2]]), size, 30000)).toBe(2)
  expect(tierOf(new Map(), size, 30000)).toBe(2)
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
