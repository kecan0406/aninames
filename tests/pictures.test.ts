import { afterEach, expect, test } from 'bun:test'
import {
  anilistCharacter,
  bangumiCharacter,
  characterPicture,
  keyArtOf,
  liveCharacterFile,
  picksOf,
} from '../src/client/pictures.ts'

const NOW = { tries: 1, timeout: 1000 }

const real = globalThis.fetch

afterEach(() => {
  globalThis.fetch = real
})

function answering(routes: Record<string, () => Response>): string[] {
  const asked: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    const route = Object.keys(routes).find((part) => url.includes(part))
    return route ? (routes[route] as () => Response)() : new Response('{}', { status: 404 })
  }) as typeof fetch
  return asked
}

test('picks take a series over a film, an anime over a manga, and every other number first come', () => {
  expect(
    picksOf([
      { refs: ['tmdb:movie/5', 'anilist:manga/8', 'steam:420', 'bangumi:3'] },
      { refs: ['tmdb:tv/9', 'anilist:7', 'igdb:starfall-arena'] },
    ]),
  ).toEqual({ tmdb: 'tv/9', anilist: 7, steam: '420', igdb: 'starfall-arena', bangumi: 3 })
  expect(picksOf([])).toEqual({})
})

test('a character gives its numbers and the address of its Bangumi picture', () => {
  const member = { refs: ['anilist:12', 'bangumi:34'] }
  expect(anilistCharacter(member)).toBe(12)
  expect(bangumiCharacter(member)).toBe(34)
  expect(anilistCharacter({ refs: ['anilist:manga/12'] })).toBeNull()
  expect(characterPicture(34)).toBe('https://api.bgm.tv/v0/characters/34/image?type=medium')
})

test('a hand picture answers first, and nothing is asked of the network', async () => {
  const asked = answering({})
  const art = await keyArtOf([{ picture: 'https://example.test/hand.png', tmdb: 'tv/1' }], { tmdb: 'key' }, NOW)
  expect(art).toEqual({
    value: { src: 'https://example.test/hand.png', srcset: null, from: 'hand', cover: false },
    settled: true,
  })
  expect(asked).toEqual([])
})

test('the hand picks are tried before the found ones', async () => {
  const asked = answering({
    '/apps/111/': () => new Response(null, { status: 404 }),
    '/apps/222/': () => new Response(null, { status: 200 }),
  })
  const art = await keyArtOf([{ steam: '222' }, { steam: '111' }], {}, NOW)
  expect(art.value?.from).toBe('steam')
  expect(art.value?.src).toContain('/apps/222/')
  expect(asked).toHaveLength(1)
})

test('a source with no key is skipped, and a Bangumi cover comes last, marked as a cover', async () => {
  const asked = answering({
    '/subjects/77/': () => new Response(null, { status: 302, headers: { location: 'https://cdn.test/cover.jpg' } }),
    '/apps/5/': () => new Response(null, { status: 404 }),
  })
  const art = await keyArtOf([{ tmdb: 'tv/1', igdb: 'lumen', steam: '5', bangumi: 77 }], {}, NOW)
  expect(art).toEqual({
    value: { src: 'https://cdn.test/cover.jpg', srcset: null, from: 'bangumi', cover: true },
    settled: true,
  })
  expect(asked.some((url) => url.includes('themoviedb'))).toBe(false)
})

test('an empty Bangumi picture counts as none', async () => {
  answering({
    '/characters/9/': () =>
      new Response(null, { status: 302, headers: { location: 'https://cdn.test/img/no_icon_subject.png' } }),
  })
  expect(await liveCharacterFile(9, NOW)).toEqual({ value: null, settled: true })
})

test('a failure that may pass leaves the answer unsettled, and a 404 settles it', async () => {
  answering({ '/characters/1/': () => new Response(null, { status: 500 }) })
  expect((await liveCharacterFile(1, NOW)).settled).toBe(false)
  answering({})
  expect((await liveCharacterFile(2, NOW)).settled).toBe(true)
})
