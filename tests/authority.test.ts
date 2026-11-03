import { expect, test } from 'bun:test'
import { type AuthorityWork, authorityProblems, readAuthority, readWork } from '../src/authority.ts'
import { entryOf } from '../src/sources/fribb.ts'

const FILE = 'lumen-song.toml'

test('a work file reads its keys and turns every site into a list', () => {
  const work = readWork(
    FILE,
    `name = "Lumen Song"
native = "ルーメンの歌"
danbooru = "lumen_song"
lead = "lumen-song/aria"

[art]
steam = "420"

[[character]]
id = "aria"
native = ["アリア"]
danbooru = "aria_(lumen_song)"
sites = { konachan = "aria", yande = ["aria", "aria_lumen"] }
anilist = 12
`,
  )
  expect(work).toEqual({
    id: 'lumen-song',
    name: 'Lumen Song',
    native: 'ルーメンの歌',
    danbooru: 'lumen_song',
    lead: 'lumen-song/aria',
    art: { steam: '420' },
    characters: [
      {
        id: 'aria',
        native: ['アリア'],
        danbooru: 'aria_(lumen_song)',
        sites: { konachan: ['aria'], yande: ['aria', 'aria_lumen'] },
        anilist: 12,
      },
    ],
  })
})

test('a key the file does not take, or a value in the wrong form, stops it', () => {
  expect(() => readWork(FILE, 'name = "Lumen Song"\ncolour = "red"\n')).toThrow('colour')
  expect(() => readWork(FILE, 'name = "Lumen Song"\n[art]\ntmdb = "890"\n')).toThrow('art.tmdb')
  expect(() => readWork(FILE, 'name = "Lumen Song"\n[art]\npicture = "http://example.test/a.png"\n')).toThrow(
    'art.picture',
  )
  expect(() => readWork(FILE, 'native = "ルーメン"\n')).toThrow('name')
  expect(() => readWork('Lumen Song.toml', 'name = "Lumen Song"\n')).toThrow('its name')
})

const work = (id: string, rest: Partial<AuthorityWork> = {}): AuthorityWork => ({
  id,
  name: id,
  characters: [],
  ...rest,
})

test('the works hold together: one tag, one subject', () => {
  expect(
    authorityProblems([
      work('lumen-song', { danbooru: 'lumen', characters: [{ id: 'aria', danbooru: 'aria_(lumen)' }] }),
      work('briarwood-rocks', { characters: [{ id: 'aria', danbooru: 'aria_(lumen)' }, { id: 'tess' }] }),
    ]),
  ).toEqual(['briarwood-rocks/aria: danbooru "aria_(lumen)" is lumen-song/aria already'])
})

test('a character with a tag takes its full name, and another work must exist', () => {
  expect(
    authorityProblems([work('lumen-song', { characters: [{ id: 'aria', danbooru: 'aria_star', also: ['nowhere'] }] })]),
  ).toEqual([
    'lumen-song/aria: its id must be its danbooru tag\'s full name, "aria-star"',
    'lumen-song/aria: also names "nowhere", no other work',
  ])
})

test('a lead names the work or one of its characters', () => {
  expect(
    authorityProblems([
      work('lumen-song', { lead: 'lumen-song/aria', characters: [{ id: 'aria' }] }),
      work('briarwood-rocks', { lead: 'briarwood-rocks/tess' }),
      work('moonlit-harbor', { lead: 'lumen-song' }),
    ]),
  ).toEqual([
    'briarwood-rocks: lead "briarwood-rocks/tess" names neither it nor one of its characters',
    'moonlit-harbor: lead "lumen-song" names neither it nor one of its characters',
  ])
})

test('the authority in this repository holds together', () => {
  expect(readAuthority().length).toBeGreaterThan(0)
})

test('the id map gives a work its TMDB number through the numbers it shares', () => {
  expect(entryOf({ anilist_id: 7, mal_id: 8, themoviedb_id: { tv: 9 } })).toEqual({
    id: 'tmdb:tv/9',
    kind: 'work',
    attach: true,
    refs: ['anilist:7', 'mal:8'],
    names: [],
  })
  expect(entryOf({ anidb_id: 7, themoviedb_id: { movie: 9 } })?.id).toBe('tmdb:movie/9')
  expect(entryOf({ anilist_id: 7 })).toBeUndefined()
  expect(entryOf({ themoviedb_id: { tv: 9 } })).toBeUndefined()
})
