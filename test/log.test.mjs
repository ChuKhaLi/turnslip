import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logError } from '../plugin/lib/log.mjs'
import { tempDir } from './helpers.mjs'

test('logError writes one line per failure and masks the key it is given', () => {
  const home = tempDir()
  const key = 'TS-AAAA-BBBB-WXYZ'
  logError(home, 'cli activate', new Error(`bad ${key} here`), key)
  const log = readFileSync(join(home, 'log'), 'utf8')
  assert.match(log, /^\d{4}-\d\d-\d\dT.* cli activate Error: bad …WXYZ here/)
  assert.ok(!log.includes(key))
})

test('logError never throws, even when the home cannot be written', () => {
  assert.doesNotThrow(() => logError(join(tempDir(), 'missing', '\0bad'), 'x', new Error('y')))
})
