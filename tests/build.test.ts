import { expect, test } from 'bun:test'
import { lostFrom } from '../src/audit.ts'
import { adultCharactersOf, genresFrom } from '../src/build.ts'
import {
  dominantOf,
  familyKeysOf,
  familyOf,
  groupsOf,
  type KeyedWork,
  MOST_GROUP,
  startsWith,
  titleName,
} from '../src/families.ts'
import { chosenOf, homeOf, learnedOf, tierOf } from '../src/homes.ts'
import { priorOf } from '../src/match.ts'
import type { Entry, Ref } from '../src/model.ts'
import { gameGenres } from '../src/sources/bangumi.ts'
import { natureOf } from '../src/sources/wikidata.ts'

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

test('a symbol that names another work keeps its title apart, and other punctuation does not', () => {
  expect(titleName('呪術廻戦≡')).not.toBe(titleName('呪術廻戦'))
  expect(titleName('∀ガンダム')).not.toBe(titleName('ガンダム'))
  expect(titleName('ぼっち・ざ・ろっく！')).toBe(titleName('ぼっち・ざ・ろっく!'))
})

test('a work with its own tag and an anime proper outrank a trailer', () => {
  expect(priorOf('anime', 'UNKNOWN', false)).toBe(0)
  expect(priorOf('game', 'GAME', true)).toBeGreaterThan(priorOf('anime', 'UNKNOWN', false))
  expect(priorOf('anime', 'TV', true)).toBeGreaterThan(priorOf('anime', 'TV', false))
})

test('an audit fails a table that lost a tenth of its rows and not one that lost less', () => {
  expect(lostFrom({ 'unlicensed.names': 100 }, { 'unlicensed.names': 91 })).toEqual([])
  expect(lostFrom({ 'unlicensed.names': 100 }, { 'unlicensed.names': 89 })).toHaveLength(1)
  expect(lostFrom({ 'kowiki.names': 100 }, {})).toHaveLength(1)
})

function keyed(rows: [root: string, year: number, tag?: string, posts?: number][]): Map<string, KeyedWork> {
  return new Map(
    rows.map(([root, year, tag, posts]) => [root, { key: `bangumi-${root}`, year, rank: 0, tag, posts: posts ?? 0 }]),
  )
}

function linked(pairs: [string, string][]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>()
  for (const [a, b] of pairs) {
    links.set(a, (links.get(a) ?? new Set()).add(b))
    links.set(b, (links.get(b) ?? new Set()).add(a))
  }
  return links
}

test('a work with no tag takes the nearest tag within two hops, the one with the most posts', () => {
  const works = keyed([
    ['season1', 2020, 'moonlit_harbor', 500],
    ['season2', 2022],
    ['movie', 2024],
    ['spinoff', 2023, 'harbor_cats', 90],
    ['special', 2025],
    ['far', 2026],
  ])
  const links = linked([
    ['season1', 'season2'],
    ['season2', 'movie'],
    ['season2', 'spinoff'],
    ['movie', 'special'],
    ['special', 'far'],
  ])
  const keys = familyKeysOf(works, links)
  expect(keys.get('season1')).toBeUndefined()
  expect(keys.get('season2')).toEqual({ key: 'moonlit_harbor', tier: 2 })
  expect(keys.get('movie')).toEqual({ key: 'moonlit_harbor', tier: 2 })
  expect(keys.get('special')).toEqual({ key: 'bangumi-special', tier: 0 })
  expect(keys.get('far')).toEqual({ key: 'bangumi-special', tier: 1 })
})

test('works no tag reaches form a family under the earliest of them, and a group too large to be one stays apart', () => {
  const small = familyKeysOf(
    keyed([
      ['manga', 2016],
      ['tv', 2019],
      ['film', 2021],
      ['alone', 2020],
    ]),
    linked([
      ['manga', 'tv'],
      ['tv', 'film'],
    ]),
  )
  expect(small.get('manga')).toEqual({ key: 'bangumi-manga', tier: 0 })
  expect(small.get('tv')).toEqual({ key: 'bangumi-manga', tier: 1 })
  expect(small.get('film')).toEqual({ key: 'bangumi-manga', tier: 1 })
  expect(small.get('alone')).toEqual({ key: 'bangumi-alone', tier: 0 })
  const roots = Array.from({ length: MOST_GROUP + 1 }, (_, at) => `w${at}`)
  const large = familyKeysOf(
    keyed(roots.map((root, at) => [root, 2000 + at])),
    linked(roots.slice(1).map((root, at) => [roots[at] as string, root])),
  )
  expect(large.get('w5')).toEqual({ key: 'bangumi-w5', tier: 0 })
})

test('a family of one year is headed by its most collected work', () => {
  const works = new Map<string, KeyedWork>([
    ['book', { key: 'bangumi-book', year: 2023, rank: 90, tag: undefined, posts: 0 }],
    ['film', { key: 'bangumi-film', year: 2023, rank: 9000, tag: undefined, posts: 0 }],
  ])
  expect(familyKeysOf(works, linked([['book', 'film']])).get('book')).toEqual({ key: 'bangumi-film', tier: 1 })
})

test('a game says rhythm or adventure from its genre and tags, and other only when a genre says neither', () => {
  expect(gameGenres(['MUG'], ['游戏', '街机'])).toEqual(['rhythm'])
  expect(gameGenres([], ['iOS', 'MUG'])).toEqual(['rhythm'])
  expect(gameGenres(['MUG & ADV'], [])).toEqual(['rhythm', 'adventure'])
  expect(gameGenres(['恋愛アドベンチャー'], [])).toEqual(['adventure'])
  expect(gameGenres([], ['Galgame', 'PC'])).toEqual(['adventure'])
  expect(gameGenres(['RPG'], ['PC'])).toEqual(['other'])
  expect(gameGenres([''], ['PC'])).toEqual([])
  expect(gameGenres(['SMUGGLER'], [])).toEqual(['other'])
})

test('a visual novel is a game VNDB lists unless its genre says otherwise', () => {
  expect(genresFrom([], true)).toEqual(['vn'])
  expect(genresFrom(['adventure'], true)).toEqual(['vn'])
  expect(genresFrom(['other'], true)).toEqual([])
  expect(genresFrom(['adventure'], false)).toEqual([])
  expect(genresFrom(['rhythm'], true)).toEqual(['rhythm'])
  expect(genresFrom(['rhythm', 'adventure'], true)).toEqual(['rhythm', 'vn'])
})

test('a tag has a nature only when every type its item states names one', () => {
  expect(natureOf(['Q11446438'])).toBe('group')
  expect(natureOf(['Q11338907', 'Q1897589'])).toBe('software')
  expect(natureOf(['Q126480223', 'Q20739124'])).toBe('group')
  expect(natureOf(['Q891723', 'Q167270'])).toBe('organization')
  expect(natureOf(['Q8102'])).toBe('term')
  expect(natureOf(['Q196600', 'Q850978'])).toBeUndefined()
  expect(natureOf(['Q431289'])).toBeUndefined()
  expect(natureOf([])).toBeUndefined()
})

test('a tag finds a title by its leading words, never by part of a word', () => {
  expect(startsWith(['tide', 'runner', 'ii'], ['tide', 'runner'])).toBe(true)
  expect(startsWith(['tide', 'runner'], ['tide', 'runner'])).toBe(true)
  expect(startsWith(['tiderunner'], ['tide', 'runner'])).toBe(false)
  expect(startsWith(['tide'], ['tide', 'runner'])).toBe(false)
})

test('among the works a tag finds by title, one with a tenth of the most collected or fewer does not count', () => {
  expect(
    dominantOf(
      new Map([
        ['film', 2000],
        ['namesake', 40],
        ['sequel', 200],
      ]),
    ),
  ).toEqual(['film', 'sequel'])
  expect(dominantOf(new Map([['alone', 0]]))).toEqual(['alone'])
})
