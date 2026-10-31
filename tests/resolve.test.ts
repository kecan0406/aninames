import { expect, test } from 'bun:test'
import { ACCEPT, characterKey, FORM, keyScore, pairScore, VETO } from '../src/resolve.ts'

test('a name key is loose for a one-word or two-character name and short for a given name alone', () => {
  expect(characterKey('我妻善逸')).toEqual({ key: 'ja|我妻善逸', loose: false, short: false, script: 'ja' })
  expect(characterKey('ジェリー')).toEqual({ key: 'ja|じぇりー', loose: false, short: true, script: 'ja' })
  expect(characterKey('セーラーマーキュリー')?.short).toBe(false)
  expect(characterKey('レム')?.loose).toBe(true)
  expect(characterKey('Zenitsu Agatsuma')).toEqual({
    key: 'latin|agatsuma zenitsu',
    loose: false,
    short: false,
    script: 'latin',
  })
  expect(characterKey('D.Va')).toEqual({ key: 'latin|dva', loose: true, short: false, script: 'latin' })
  expect(characterKey('rem (re:zero)')?.key).toBe(characterKey('Rem')?.key)
})

test('works and main names that contradict a shared name keep two characters apart', () => {
  const parody = pairScore(0, keyScore('latin', false, false, 1), 'disjoint', false, true)
  expect(parody).toBeLessThanOrEqual(VETO)
  const namesake = pairScore(keyScore('ja', false, true, 2), keyScore('latin', true, false, 2), 'disjoint', true, false)
  expect(namesake).toBeLessThan(ACCEPT)
  const adaptation = pairScore(
    keyScore('ja', false, false, 2),
    keyScore('latin', false, false, 2),
    'disjoint',
    false,
    false,
  )
  expect(adaptation).toBeGreaterThanOrEqual(ACCEPT)
  const form = pairScore(keyScore('ja', false, false, 1), keyScore('latin', false, false, 1), 'unknown', false, true)
  expect(form).toBeGreaterThanOrEqual(FORM)
  const cast = pairScore(0, keyScore('latin', true, false, 1), 'same', false, false)
  expect(cast).toBeGreaterThanOrEqual(ACCEPT)
})
