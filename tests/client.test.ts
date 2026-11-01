import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Rows, View } from '../src/client/chunks.ts'
import { CHARACTER, FORMAT, KEY_TABLES, type KeyRow, pack, present, readManifest } from '../src/client/format.ts'
import { decode, Names } from '../src/client/names.ts'
import { compare } from '../src/client/order.ts'
import { fileSource } from '../src/client/source.ts'
import { Writer } from '../src/files.ts'

test('keys sort by code point like SQLite and UTF-8 bytes, not by UTF-16 unit', () => {
  const words = ['\u{1F600}', '￿', '', 'z', '\u{10000}', '퟿', 'ア', '']
  const bytes = [...words].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  expect([...words].sort(compare)).toEqual(bytes)
  expect(compare('', '\u{1F600}')).toBeLessThan(0)
  expect(compare('￿', '\u{10000}')).toBeLessThan(0)
  expect('\u{1F600}' < '').toBe(true)
})

test('range lookups find equal keys that straddle chunk files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aninames-'))
  try {
    const keys = ['a', 'b', 'b', 'b', 'b', 'b', 'c', 'd']
    const flat = new Writer(join(dir, 'unlicensed', 'flat'), 45)
    keys.forEach((key, eid) => {
      flat.add([key, eid, 1000, 8, 0, 0, 0], key)
    })
    flat.flush()
    const entity = new Writer(join(dir, 'unlicensed', 'entity'), 120)
    for (let eid = 0; eid < 6; eid++) {
      const id = `c/x:${eid}`
      entity.add([eid, id, [[`name ${eid}`, 'en', 0, 0]], [], [], [], 0, 0, 0, 0], id, eid)
    }
    entity.flush()
    const empty = pack([], [])
    const tables = Object.fromEntries(KEY_TABLES.map((table) => [table, empty]))
    const layers = { unlicensed: { ...tables, flat: flat.packed(false), entity: entity.packed(true) } }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ aninames: FORMAT, built: '', layers }))
    const source = fileSource(dir)
    const manifest = readManifest(await source.manifest())
    expect(manifest.layers.get('unlicensed')?.keys.flat.bounds).toEqual(['', 'b', 'b', 'c'])
    const loaded = new Map<string, Rows>()
    const settle = async <T>(read: (view: View) => T): Promise<T> => {
      for (;;) {
        const view = new View(manifest, ['unlicensed'], (path) => loaded.get(path))
        const value = read(view)
        if (view.wanted.size === 0) return value
        for (const path of view.wanted) loaded.set(path, decode(path, await source.file(path)))
      }
    }
    const eids = (rows: KeyRow[]) => rows.map((row) => row[1])
    expect(eids(await settle((view) => view.keys('flat', { low: 'b', high: 'b' })))).toEqual([1, 2, 3, 4, 5])
    expect(eids(await settle((view) => view.keys('flat', { low: 'a', high: 'b' })))).toEqual([0, 1, 2, 3, 4, 5])
    expect(eids(await settle((view) => view.keys('flat', { low: 'a', high: 'c', open: true })))).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(eids(await settle((view) => view.keys('flat', { low: 'c', high: 'c' })))).toEqual([6])
    expect(await settle((view) => view.keys('flat', { low: 'bb', high: 'bb' }))).toEqual([])
    expect(eids(await settle((view) => view.keys('flat', { low: 'b', high: 'z', open: true, spans: 1 })))).toEqual([])
    expect(eids(await settle((view) => view.keys('flat', { low: 'b', high: 'z', open: true, spans: 2 })))).toEqual([
      6, 7,
    ])
    expect((await settle((view) => view.entity(3))).map((row) => row.id)).toEqual(['c/x:3'])
    expect((await settle((view) => view.byId('c/x:4'))).map((row) => row.eid)).toEqual([4])
    expect(await settle((view) => view.byId('c/x:9'))).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tagged finds the entities of a Danbooru tag whatever its punctuation and qualifier, with their refs and facts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aninames-'))
  try {
    const tag = new Writer(join(dir, 'unlicensed', 'tag'), 4096)
    tag.add(['pip', 1, 30, CHARACTER | present('unlicensed'), 0, 0, 0], 'pip')
    tag.add(['starfallharbor', 0, 40, present('unlicensed'), 0, 5, 0], 'starfallharbor')
    tag.add(['starfallharbor', 2, 120, present('unlicensed'), 0, 9, 0], 'starfallharbor')
    tag.flush()
    const entity = new Writer(join(dir, 'unlicensed', 'entity'), 4096)
    const rows = [
      [
        0,
        'w/x:0',
        [['Starfall Harbor: The Movie', 'en', 1, 0]],
        [['starfall_harbor_(film)', 40]],
        [],
        [],
        0,
        5,
        0,
        0,
        [],
        null,
        [],
        2021,
      ],
      [1, 'c/x:1', [['Pip', 'en', 0, 0]], [['pip_(starfall_harbor)', 30]], [[2, 'w/x:2']], [], 0, 0, 0, 0, []],
      [
        2,
        'w/x:2',
        [
          ['Starfall Harbor', 'en', 2, 0],
          ['Starfall Harbor', 'en', 1, 0],
        ],
        [['starfall_harbor', 120]],
        [],
        [],
        0,
        9,
        0,
        0,
        ['anilist:9', 'tmdb:tv/7'],
        null,
        ['JP'],
        2019,
        'anime',
      ],
    ] as const
    for (const row of rows) entity.add([...row], row[1], row[0])
    entity.flush()
    const empty = pack([], [])
    const keys = Object.fromEntries(KEY_TABLES.map((table) => [table, empty]))
    const layers = { unlicensed: { ...keys, tag: tag.packed(false), entity: entity.packed(true) } }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ aninames: FORMAT, built: '', layers }))
    const names = new Names(fileSource(dir))
    const works = await names.tagged('Starfall-Harbor', { kind: 'work' })
    expect(works.map((found) => found.id)).toEqual(['w/x:2', 'w/x:0'])
    expect(works[0]?.refs).toEqual(['anilist:9', 'tmdb:tv/7'])
    expect(works.map((found) => [found.origin, found.year, found.medium])).toEqual([
      [['JP'], 2019, 'anime'],
      [[], 2021, null],
    ])
    expect(works[0]?.names).toEqual([{ text: 'Starfall Harbor', lang: 'en', kind: 'official' }])
    expect((await names.tagged('pip_(anything)')).map((found) => found.id)).toEqual(['c/x:1'])
    expect(await names.tagged('pip', { kind: 'work' })).toEqual([])
    expect(await names.tagged('starfall')).toEqual([])
    expect((await names.tagged('starfall', { prefix: true })).map((found) => found.id)).toEqual(['w/x:2', 'w/x:0'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cast lists the characters at home in a tag by role before posts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aninames-'))
  try {
    const here = CHARACTER | present('unlicensed')
    const home = new Writer(join(dir, 'unlicensed', 'home'), 4096)
    for (const row of [
      ['starfallharbor', 1, 50, here, 0, 4, 0, 1],
      ['starfallharbor', 5, 900, here, 0, 9, 0, 2],
      ['tidepoolacademy', 3, 80, here, 0, 7, 0, 1],
    ])
      home.add(row, row[0] as string)
    home.flush()
    const entity = new Writer(join(dir, 'unlicensed', 'entity'), 4096)
    for (const row of [
      [1, 'c/x:1', [['Pip', 'en', 0, 0]], [['pip_(starfall_harbor)', 50]], [], [], 0, 4, 0, 0, [], 'starfall_harbor'],
      [
        3,
        'c/x:3',
        [['Wren', 'en', 0, 0]],
        [['wren_(tidepool_academy)', 80]],
        [],
        [],
        0,
        7,
        0,
        0,
        [],
        'tidepool_academy',
      ],
      [5, 'c/x:5', [], [['doodle_pip_(starfall_harbor)', 900]], [], [], 0, 9, 0, 0, [], 'starfall_harbor'],
    ] as const)
      entity.add([...row], row[1], row[0])
    entity.flush()
    const empty = pack([], [])
    const keys = Object.fromEntries(KEY_TABLES.map((table) => [table, empty]))
    const unlicensed = { ...keys, tag: empty, home: home.packed(false), entity: entity.packed(true) }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ aninames: FORMAT, built: '', layers: { unlicensed } }))
    const names = new Names(fileSource(dir))
    expect((await names.cast('Starfall Harbor')).map((found) => [found.id, found.role])).toEqual([
      ['c/x:1', 'support'],
      ['c/x:5', 'minor'],
    ])
    expect((await names.cast('starfall_harbor', { limit: 1 })).map((found) => found.id)).toEqual(['c/x:1'])
    expect((await names.cast('tidepool_academy')).map((found) => [found.id, found.home])).toEqual([
      ['c/x:3', 'tidepool_academy'],
    ])
    expect((await names.lookup(['c/x:3']))[0]?.home).toBe('tidepool_academy')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
