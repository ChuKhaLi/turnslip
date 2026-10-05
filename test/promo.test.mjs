import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROMO, promoLine } from '../plugin/lib/promo.mjs'
import { tempDir } from './helpers.mjs'

const DAY = 86_400_000
const ids = { businessId: 'bus_ts', productId: 'pdt_ts' }
const T0 = Date.parse('2026-10-04T12:00:00Z')

test('the prompt: never for Pro, then at most once a week, five times in all', () => {
  const home = tempDir()
  assert.equal(promoLine(home, { pro: true, now: T0, ids }), '')
  assert.equal(PROMO, 'Pro: history, undo any earlier turn, session report · turnslip.dev/#pro')
  assert.equal(promoLine(home, { pro: false, now: T0, ids }), PROMO)
  assert.equal(promoLine(home, { pro: false, now: T0 + 7 * DAY - 1, ids }), '')
  let t = T0
  for (let i = 2; i <= 5; i++) { t += 7 * DAY; assert.equal(promoLine(home, { pro: false, now: t, ids }), PROMO, `showing ${i}`) }
  assert.equal(promoLine(home, { pro: false, now: t + 70 * DAY, ids }), '')
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'promo.json'), 'utf8')), { shown: 5, last: t })
})

test('a broken promo.json shows nothing (a miss, never a nag)', () => {
  for (const body of ['{', '[]', '{"shown":"x","last":0}', '{"shown":-3,"last":0}', '{"shown":0,"last":-1}', 'null']) {
    const home = tempDir()
    writeFileSync(join(home, 'promo.json'), body)
    assert.equal(promoLine(home, { pro: false, now: T0, ids }), '', body)
  }
})

test('not on sale: no prompt and no showing used up, with either id empty', () => {
  const home = tempDir()
  for (const x of [{}, { businessId: '', productId: '' }, { businessId: 'bus_ts', productId: '' }, { businessId: '', productId: 'pdt_ts' }]) {
    assert.equal(promoLine(home, { pro: false, now: T0, ids: x }), '')
  }
  assert.throws(() => readFileSync(join(home, 'promo.json')))
})

test('a license that is off (revoked, stale) gets no prompt and no showing used up', () => {
  const home = tempDir()
  writeFileSync(join(home, 'license.json'), JSON.stringify({ key: 'TS-AAAA-BBBB-WXYZ', status: 'revoked', reason: 'r', lastOk: 0, lastCheck: 0 }))
  assert.equal(promoLine(home, { pro: false, now: T0, ids }), '')
  writeFileSync(join(home, 'license.json'), JSON.stringify({ key: 'TS-AAAA-BBBB-WXYZ', instanceId: 'x', status: 'active', lastOk: T0 - 15 * DAY, lastCheck: T0 }))
  assert.equal(promoLine(home, { pro: false, now: T0, ids }), '')
  assert.throws(() => readFileSync(join(home, 'promo.json')))
})
