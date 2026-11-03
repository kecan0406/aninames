import { type AuthorityCharacter, type AuthorityWork, readAuthority } from '../authority.ts'
import { type Entry, type Name, ref, type Source } from '../model.ts'

export const AUTHORITY = 'authority'

export function homeOf(work: AuthorityWork): string {
  return work.danbooru ?? `${AUTHORITY}-${work.id}`
}

function workEntry(work: AuthorityWork): Entry {
  return {
    id: ref('authority', work.id),
    kind: 'work',
    attach: true,
    ...(work.danbooru ? { refs: [ref('danbooru', work.danbooru)] } : {}),
    names: [
      { text: work.name, kind: 'official' },
      ...(work.native ? [{ text: work.native, kind: 'official' } satisfies Name] : []),
    ],
  }
}

function characterEntry(work: AuthorityWork, character: AuthorityCharacter): Entry {
  return {
    id: ref('authority', `${work.id}/${character.id}`),
    kind: 'character',
    attach: true,
    ...(character.danbooru ? { refs: [ref('danbooru', character.danbooru)] } : {}),
    names: [
      ...(character.person ? [{ text: character.person, lang: 'en', kind: 'official' } satisfies Name] : []),
      ...(character.native ?? []).map((text): Name => ({ text, kind: 'official' })),
      { text: character.id.replace(/-/g, ' '), kind: 'synonym' },
    ],
    home: homeOf(work),
  }
}

const source: Source = {
  name: AUTHORITY,
  layer: 'unlicensed',
  license: 'MIT (written by hand in this repository)',
  async fetch() {},
  *stage() {
    for (const work of readAuthority()) {
      yield workEntry(work)
      for (const character of work.characters) if (character.native) yield characterEntry(work, character)
    }
  },
}

export default source
