import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Rows, View } from '../src/client/chunks.ts'
import { FORMAT, KEY_TABLES, type KeyRow, pack, readManifest } from '../src/client/format.ts'
import { decode } from '../src/client/names.ts'
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
    const flat = new Writer(join(dir, 'core', 'flat'), 45)
    keys.forEach((key, eid) => {
      flat.add([key, eid, 1000, 8, 0, 0, 0], key)
    })
    flat.flush()
    const entity = new Writer(join(dir, 'core', 'entity'), 120)
    for (let eid = 0; eid < 6; eid++) {
      const id = `c/x:${eid}`
      entity.add([eid, id, [[`name ${eid}`, 'en', 0, 0]], [], [], [], 0, 0, 0, 0], id, eid)
    }
    entity.flush()
    const empty = pack([], [])
    const tables = Object.fromEntries(KEY_TABLES.map((table) => [table, empty]))
    const layers = { core: { ...tables, flat: flat.packed(false), entity: entity.packed(true) } }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ aninames: FORMAT, built: '', layers }))
    const source = fileSource(dir)
    const manifest = readManifest(await source.manifest())
    expect(manifest.layers.get('core')?.keys.flat.bounds).toEqual(['', 'b', 'b', 'c'])
    const loaded = new Map<string, Rows>()
    const settle = async <T>(read: (view: View) => T): Promise<T> => {
      for (;;) {
        const view = new View(manifest, ['core'], (path) => loaded.get(path))
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
