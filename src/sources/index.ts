import type { Source } from '../model.ts'

export const NAMES = ['aod', 'wikidata', 'vndb', 'kowiki', 'anidb', 'bangumi', 'anissia', 'danbooru'] as const

export async function load(name: string): Promise<Source> {
  if (!(NAMES as readonly string[]).includes(name)) {
    throw new Error(`aninames: no source named ${name} (${NAMES.join(', ')})`)
  }
  const module = (await import(`./${name}.ts`)) as { default: Source }
  return module.default
}

export async function pick(names: string[]): Promise<Source[]> {
  return Promise.all((names.length === 0 ? [...NAMES] : names).map(load))
}
