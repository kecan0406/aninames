import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { type Entry, ref, type Source } from '../model.ts'
import { fresh, json, sleep } from '../net.ts'

const API = 'https://api.anissia.net/anime/list'

interface Anime {
  animeNo: number
  subject: string
  originalSubject: string
}

interface Page {
  code: string
  data: { content: Anime[]; last: boolean }
}

function tidy(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

const anissia: Source = {
  name: 'anissia',
  layer: 'unlicensed',
  license: 'unstated (Anissia API)',

  async fetch(raw) {
    const path = join(raw, 'anime.json')
    if (await fresh(path, 1)) {
      return
    }
    const all = new Map<number, Anime>()
    for (let page = 0; ; page++) {
      if (page > 0) {
        await sleep(1000)
      }
      const body = await json<Page>(`${API}/${page}`)
      if (body.code !== 'ok') {
        throw new Error(`aninames: ${API}/${page} answered ${body.code}`)
      }
      for (const anime of body.data.content) {
        all.set(anime.animeNo, anime)
      }
      if (body.data.content.length === 0 || body.data.last) {
        break
      }
    }
    await Bun.write(`${path}.part`, JSON.stringify([...all.values()]))
    await rename(`${path}.part`, path)
  },

  async *stage(raw) {
    const file = Bun.file(join(raw, 'anime.json'))
    if (!(await file.exists())) {
      throw new Error(`aninames: ${file.name} is missing; run fetch anissia first`)
    }
    let skipped = 0
    for (const anime of (await file.json()) as Anime[]) {
      const original = tidy(anime.originalSubject ?? '')
      const subject = tidy(anime.subject ?? '')
      if (!original || !subject) {
        skipped++
        continue
      }
      const entry: Entry = {
        id: ref('anissia', anime.animeNo),
        kind: 'work',
        attach: true,
        link: [original],
        names: [{ text: subject, lang: 'ko', kind: 'official' }],
      }
      yield entry
    }
    console.log(`anissia: skipped ${skipped} entries without an original title`)
  },
}

export default anissia
