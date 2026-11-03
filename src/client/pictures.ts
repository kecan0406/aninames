export type ArtSource = 'hand' | 'tmdb' | 'anilist' | 'steam' | 'igdb' | 'bangumi'

export interface KeyArt {
  src: string
  srcset: string | null
  from: ArtSource
  cover: boolean
}

export interface Picks {
  picture?: string
  tmdb?: string
  anilist?: number
  steam?: string
  igdb?: string
  bangumi?: number
}

export interface Twitch {
  id: string
  secret: string
}

export interface Keys {
  tmdb?: string
  twitch?: Twitch
}

export interface Reach {
  tries: number
  timeout: number
  agent?: string
}

export interface Live<T> {
  value: T
  settled: boolean
}

interface Refs {
  refs: readonly string[]
}

interface Backdrop {
  file_path?: unknown
  iso_639_1?: unknown
  vote_average?: unknown
  vote_count?: unknown
  width?: unknown
}

interface Picture {
  image_id?: unknown
  width?: unknown
  height?: unknown
  alpha_channel?: unknown
  animated?: unknown
}

const TMDB_API = 'https://api.themoviedb.org/3'

const TMDB_IMAGES = 'https://image.tmdb.org/t/p'

const TMDB_FILE = /^\/\w+\.(?:jpg|png)$/

const ANILIST_API = 'https://graphql.anilist.co'

const ANILIST_FILE = /^https:\/\/s4\.anilist\.co\/file\/anilistcdn\/[\w./-]+$/

const STEAM_ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps'

const STEAM_APP = /^[1-9]\d*$/

const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token'

const IGDB_API = 'https://api.igdb.com/v4'

const IGDB_IMAGES = 'https://images.igdb.com/igdb/image/upload'

const IGDB_SLUG = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/

const IGDB_IMAGE = /^[a-z0-9]+$/

const BANGUMI_API = 'https://api.bgm.tv/v0'

const NO_PICTURE = 'no_icon'

const ANIME = /^anilist:(\d+)$/

const MANGA = /^anilist:manga\/(\d+)$/

const STEAM = /^steam:(\d+)$/

const IGDB = /^igdb:([a-z0-9-]+)$/

const BANGUMI = /^bangumi:(\d+)$/

const WIDEST = 1280

const WIDE = 1.5

const PAGE = 50

const PAUSE_MS = 2000

class Refused extends Error {
  readonly status: number

  constructor(url: string, status: number) {
    super(`aninames: ${url} answered ${status}`)
    this.status = status
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

async function asked(url: string, init: RequestInit, how: Reach): Promise<unknown> {
  let failure = new Error('aninames: no answer')
  for (let tried = 0; tried < how.tries; tried += 1) {
    if (tried > 0) await pause(PAUSE_MS * tried)
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(how.timeout) })
      if (response.ok) return await response.json()
      failure = new Refused(url, response.status)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw failure
}

async function settle<T>(run: () => Promise<T>, none: T): Promise<Live<T>> {
  try {
    return { value: await run(), settled: true }
  } catch (error) {
    return { value: none, settled: error instanceof Refused && error.status === 404 }
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function first(members: readonly Refs[], pattern: RegExp): string | undefined {
  return members
    .flatMap((member) => member.refs)
    .map((ref) => pattern.exec(ref)?.[1])
    .find(Boolean)
}

function tmdbIn(members: readonly Refs[]): string | undefined {
  const refs = members.flatMap((member) => member.refs)
  const ref = refs.find((each) => each.startsWith('tmdb:tv/')) ?? refs.find((each) => each.startsWith('tmdb:movie/'))
  return ref?.slice('tmdb:'.length)
}

function anilistIn(members: readonly Refs[]): number | undefined {
  const series = (member: Refs) => member.refs.some((ref) => ref.startsWith('tmdb:tv/'))
  const refs = members.toSorted((a, b) => Number(series(b)) - Number(series(a))).flatMap((member) => member.refs)
  const found = refs.map((ref) => ANIME.exec(ref)).find(Boolean) ?? refs.map((ref) => MANGA.exec(ref)).find(Boolean)
  return found?.[1] ? Number(found[1]) : undefined
}

export function picksOf(members: readonly Refs[]): Picks {
  const tmdb = tmdbIn(members)
  const anilist = anilistIn(members)
  const steam = first(members, STEAM)
  const igdb = first(members, IGDB)
  const bangumi = first(members, BANGUMI)
  return {
    ...(tmdb ? { tmdb } : {}),
    ...(anilist ? { anilist } : {}),
    ...(steam ? { steam } : {}),
    ...(igdb ? { igdb } : {}),
    ...(bangumi ? { bangumi: Number(bangumi) } : {}),
  }
}

export function anilistCharacter(member: Refs): number | null {
  const id = first([member], ANIME)
  return id ? Number(id) : null
}

export function bangumiCharacter(member: Refs): number | null {
  const id = first([member], BANGUMI)
  return id ? Number(id) : null
}

export function characterPicture(id: number): string {
  return `${BANGUMI_API}/characters/${id}/image?type=medium`
}

function headersOf(how: Reach): Record<string, string> {
  return how.agent ? { 'user-agent': how.agent } : {}
}

async function bangumiFile(url: string, how: Reach): Promise<string | null> {
  let failure: unknown = new Error('aninames: no answer')
  for (let tried = 0; tried < how.tries; tried += 1) {
    if (tried > 0) await pause(PAUSE_MS * tried)
    try {
      const response = await fetch(url, {
        headers: headersOf(how),
        redirect: 'manual',
        signal: AbortSignal.timeout(how.timeout),
      })
      const to = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && to) return to.includes(NO_PICTURE) ? null : to
      failure = new Refused(url, response.status)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

export function liveCharacterFile(id: number, how: Reach): Promise<Live<string | null>> {
  return settle(() => bangumiFile(characterPicture(id), how), null)
}

export function liveCover(id: number, how: Reach, size: 'large' | 'common' = 'large'): Promise<Live<string | null>> {
  return settle(() => bangumiFile(`${BANGUMI_API}/subjects/${id}/image?type=${size}`, how), null)
}

function tmdbArt(file: string): KeyArt {
  return {
    src: `${TMDB_IMAGES}/w1280${file}`,
    srcset: `${TMDB_IMAGES}/w300${file} 300w, ${TMDB_IMAGES}/w780${file} 780w, ${TMDB_IMAGES}/w1280${file} 1280w`,
    from: 'tmdb',
    cover: false,
  }
}

function igdbArt(image: string): KeyArt {
  return {
    src: `${IGDB_IMAGES}/t_1080p/${image}.jpg`,
    srcset: `${IGDB_IMAGES}/t_720p/${image}.jpg 1280w, ${IGDB_IMAGES}/t_1080p/${image}.jpg 1920w`,
    from: 'igdb',
    cover: false,
  }
}

function bestOf(backdrops: Backdrop[]): string | null {
  const usable = backdrops.filter(
    (backdrop): backdrop is Backdrop & { file_path: string } =>
      typeof backdrop.file_path === 'string' && TMDB_FILE.test(backdrop.file_path) && count(backdrop.width) >= WIDEST,
  )
  const bare = usable.filter((backdrop) => backdrop.iso_639_1 === null || backdrop.iso_639_1 === 'xx')
  const [best] = (bare.length > 0 ? bare : usable).toSorted(
    (a, b) => count(b.vote_average) - count(a.vote_average) || count(b.vote_count) - count(a.vote_count),
  )
  return best?.file_path ?? null
}

async function backdropOf(tmdb: string, token: string, how: Reach): Promise<string | null> {
  const init = { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }
  const details = (await asked(`${TMDB_API}/${tmdb}`, init, how)) as { backdrop_path?: unknown }
  if (typeof details?.backdrop_path === 'string' && TMDB_FILE.test(details.backdrop_path)) return details.backdrop_path
  const found = (await asked(`${TMDB_API}/${tmdb}/images?include_image_language=null,xx,en,ja`, init, how)) as {
    backdrops?: unknown
  }
  return Array.isArray(found?.backdrops) ? bestOf(found.backdrops as Backdrop[]) : null
}

async function anilistAsk(
  query: string,
  variables: Record<string, unknown>,
  how: Reach,
): Promise<Record<string, unknown>> {
  const answer = (await asked(
    ANILIST_API,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    how,
  )) as { data?: Record<string, unknown> }
  if (!answer?.data) throw new Error('aninames: AniList answered no data')
  return answer.data
}

function anilistFile(value: unknown): string | null {
  return typeof value === 'string' && ANILIST_FILE.test(value) && !value.includes('/default.') ? value : null
}

function nodes(data: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const list = (data.page as Record<string, unknown> | undefined)?.[field]
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : []
}

async function bannerOf(id: number, how: Reach): Promise<string | null> {
  const data = await anilistAsk('query ($id: Int) { media: Media(id: $id) { bannerImage } }', { id }, how)
  return anilistFile((data.media as Record<string, unknown> | undefined)?.bannerImage)
}

export async function bannersOf(ids: readonly number[], how: Reach): Promise<Map<number, string>> {
  const banners = new Map<number, string>()
  for (let at = 0; at < ids.length; at += PAGE) {
    const data = await anilistAsk(
      'query ($ids: [Int]) { page: Page(perPage: 50) { media(id_in: $ids) { id bannerImage } } }',
      { ids: ids.slice(at, at + PAGE) },
      how,
    )
    for (const media of nodes(data, 'media')) {
      const banner = anilistFile(media.bannerImage)
      if (typeof media.id === 'number' && banner) banners.set(media.id, banner)
    }
  }
  return banners
}

export async function picturesOf(ids: readonly number[], how: Reach): Promise<Map<number, string>> {
  const pictures = new Map<number, string>()
  for (let at = 0; at < ids.length; at += PAGE) {
    const data = await anilistAsk(
      'query ($ids: [Int]) { page: Page(perPage: 50) { characters(id_in: $ids) { id image { large } } } }',
      { ids: ids.slice(at, at + PAGE) },
      how,
    )
    for (const character of nodes(data, 'characters')) {
      const picture = anilistFile((character.image as Record<string, unknown> | undefined)?.large)
      if (typeof character.id === 'number' && picture) pictures.set(character.id, picture)
    }
  }
  return pictures
}

export function livePictures(ids: readonly number[], how: Reach): Promise<Live<Map<number, string>>> {
  return settle(() => picturesOf(ids, how), new Map())
}

async function heroOf(app: string, how: Reach): Promise<string | null> {
  if (!STEAM_APP.test(app)) return null
  const url = `${STEAM_ASSETS}/${app}/library_hero.jpg`
  const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(how.timeout) })
  if (response.status === 404) return null
  if (!response.ok) throw new Refused(url, response.status)
  return url
}

let twitch: { token: string; until: number } | undefined

async function tokenOf(app: Twitch, how: Reach): Promise<string> {
  if (twitch && Date.now() < twitch.until) return twitch.token
  const query = new URLSearchParams({ client_id: app.id, client_secret: app.secret, grant_type: 'client_credentials' })
  const answer = (await asked(`${TWITCH_TOKEN}?${query}`, { method: 'POST' }, how)) as {
    access_token?: unknown
    expires_in?: unknown
  }
  if (typeof answer?.access_token !== 'string') throw new Error('aninames: Twitch answered no token')
  twitch = { token: answer.access_token, until: Date.now() + Math.max(0, count(answer.expires_in) - 60) * 1000 }
  return twitch.token
}

function widest(pictures: unknown): string | null {
  const usable = (Array.isArray(pictures) ? (pictures as Picture[]) : []).filter(
    (picture): picture is Picture & { image_id: string } =>
      typeof picture?.image_id === 'string' &&
      IGDB_IMAGE.test(picture.image_id) &&
      picture.alpha_channel !== true &&
      picture.animated !== true &&
      count(picture.width) >= WIDEST &&
      count(picture.width) >= WIDE * count(picture.height),
  )
  return usable.toSorted((a, b) => count(b.width) - count(a.width))[0]?.image_id ?? null
}

async function artworkOf(slug: string, app: Twitch, how: Reach): Promise<string | null> {
  if (!IGDB_SLUG.test(slug)) return null
  const token = await tokenOf(app, how)
  const fields = 'artworks.image_id,artworks.width,artworks.height,artworks.alpha_channel,artworks.animated'
  const found = await asked(
    `${IGDB_API}/games`,
    {
      method: 'POST',
      headers: { 'client-id': app.id, authorization: `Bearer ${token}`, accept: 'application/json' },
      body: `fields ${fields},screenshots.image_id,screenshots.width,screenshots.height; where slug = "${slug}"; limit 1;`,
    },
    how,
  ).catch((error: unknown) => {
    if (error instanceof Refused && error.status === 401) twitch = undefined
    throw error
  })
  const game = Array.isArray(found) ? (found[0] as Record<string, unknown> | undefined) : undefined
  return widest(game?.artworks) ?? widest(game?.screenshots)
}

type Step = () => Promise<Live<KeyArt | null>>

function step<T>(run: () => Promise<T | null>, art: (found: T) => KeyArt): Step {
  return async () => {
    const { value, settled } = await settle(run, null)
    return { value: value === null ? null : art(value), settled }
  }
}

function stepsOf(picks: Picks, keys: Keys, how: Reach): Step[] {
  const { picture, tmdb, anilist, steam, igdb } = picks
  const token = keys.tmdb
  const app = keys.twitch
  return [
    ...(picture
      ? [async () => ({ value: { src: picture, srcset: null, from: 'hand', cover: false } as KeyArt, settled: true })]
      : []),
    ...(tmdb && token ? [step(() => backdropOf(tmdb, token, how), tmdbArt)] : []),
    ...(anilist
      ? [
          step(
            () => bannerOf(anilist, how),
            (src): KeyArt => ({ src, srcset: null, from: 'anilist', cover: false }),
          ),
        ]
      : []),
    ...(steam
      ? [
          step(
            () => heroOf(steam, how),
            (src): KeyArt => ({ src, srcset: null, from: 'steam', cover: false }),
          ),
        ]
      : []),
    ...(igdb && app ? [step(() => artworkOf(igdb, app, how), igdbArt)] : []),
  ]
}

function coverStep(id: number, how: Reach): Step {
  return step(
    () => bangumiFile(`${BANGUMI_API}/subjects/${id}/image?type=large`, how),
    (src): KeyArt => ({ src, srcset: null, from: 'bangumi', cover: true }),
  )
}

export async function keyArtOf(picks: readonly Picks[], keys: Keys, how: Reach): Promise<Live<KeyArt | null>> {
  const cover = picks.map((each) => each.bangumi).find((id) => id !== undefined)
  const steps = [...picks.flatMap((each) => stepsOf(each, keys, how)), ...(cover ? [coverStep(cover, how)] : [])]
  let settled = true
  for (const run of steps) {
    const found = await run()
    settled &&= found.settled
    if (found.value) return { value: found.value, settled }
  }
  return { value: null, settled }
}
