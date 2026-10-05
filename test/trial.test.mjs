import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRO_HINT } from '../plugin/lib/promo.mjs'
import { TRIAL_RUNS, TRIAL_USED, spendTrial, trialLine, trialOpen, trialSpent, trialUsed } from '../plugin/lib/trial.mjs'
import { tempDir } from './helpers.mjs'

const ids = { businessId: 'bus_ts', productId: 'pdt_ts' }
const DAY = 86_400_000

test('three runs: each spend is recorded, the fourth is refused', () => {
  const home = tempDir()
  assert.equal(TRIAL_RUNS, 3)
  assert.equal(trialUsed(home), 0)
  assert.equal(trialOpen(home, { ids }), true)
  assert.deepEqual([spendTrial(home), spendTrial(home), spendTrial(home)], [1, 2, 3])
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'trial.json'), 'utf8')), { used: 3 })
  assert.equal(trialOpen(home, { ids }), false)
  assert.equal(spendTrial(home), null)
  assert.equal(trialUsed(home), 3)
})

test('the lines name the count, then the key and the command on the last run', () => {
  assert.equal(trialLine(1), 'Pro trial · 1 of 3 used · turnslip.dev/#pro')
  assert.equal(trialLine(2), 'Pro trial · 2 of 3 used · turnslip.dev/#pro')
  assert.equal(trialLine(3), `Pro trial · that was the last of 3 · ${PRO_HINT}`)
  assert.equal(TRIAL_USED, 'Your 3 trial runs are used.')
})

test('a malformed or unreadable trial.json counts as used up: a miss, never a free Pro', () => {
  for (const body of ['null', '{}', '{"used":2.5}', '{"used":-1}', '{"used":4}', '{"used":"1"}', 'not json']) {
    const home = tempDir()
    writeFileSync(join(home, 'trial.json'), body)
    assert.equal(trialUsed(home), 3, body)
    assert.equal(trialOpen(home, { ids }), false, body)
    assert.equal(spendTrial(home), null, body)
  }
  const home = tempDir()
  mkdirSync(join(home, 'trial.json'))
  assert.equal(trialUsed(home), 3, 'a directory')
})

test('a run that cannot be recorded is not given, and the failure is logged', () => {
  const home = tempDir()
  const write = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }
  assert.equal(spendTrial(home, { write }), null)
  assert.equal(trialUsed(home), 0)
  assert.match(readFileSync(join(home, 'log'), 'utf8'), /trial/)
})

test('no trial before Pro is on sale, or for a license that is off', () => {
  const home = tempDir()
  assert.equal(trialOpen(home, { ids: { businessId: '', productId: '' } }), false)
  assert.equal(trialOpen(home, { ids: { businessId: 'bus_ts', productId: '' } }), false)
  writeFileSync(join(home, 'license.json'), JSON.stringify({ key: 'TS-AAAA-BBBB-WXYZ', status: 'revoked', reason: 'r', lastOk: 0, lastCheck: 0 }))
  assert.equal(trialOpen(home, { ids }), false)
  writeFileSync(join(home, 'license.json'), JSON.stringify({ key: 'TS-AAAA-BBBB-WXYZ', instanceId: 'x', status: 'active', lastOk: Date.now() - 15 * DAY, lastCheck: Date.now() }))
  assert.equal(trialOpen(home, { ids }), false)
  assert.ok(!existsSync(join(home, 'trial.json')))
})

// Final review M2: a malformed file blocks the trial (a miss, never a free Pro), but must not tell a
// user who never ran it that their runs are used: only a file recording all three says so.
test('trialSpent is true only when trial.json records all three runs', () => {
  const home = tempDir()
  assert.equal(trialSpent(home), false)
  writeFileSync(join(home, 'trial.json'), '{"used":2}')
  assert.equal(trialSpent(home), false)
  writeFileSync(join(home, 'trial.json'), '{"used":3}')
  assert.equal(trialSpent(home), true)
  for (const body of ['null', '{"used":4}', 'not json']) {
    writeFileSync(join(home, 'trial.json'), body)
    assert.equal(trialSpent(home), false, body)
    assert.equal(trialOpen(home, { ids }), false, body)
  }
})
