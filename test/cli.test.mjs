import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIB, makeProject, tempDir } from './helpers.mjs'

const cli = (args, cwd, home) => spawnSync(process.execPath, [join(LIB, 'cli.mjs'), ...args], { cwd, env: { ...process.env, TURNSLIP_HOME: home }, encoding: 'utf8' })

// Once Pro is on sale a free user has trial runs (spec §6b): with them spent, the gate shows.
test('undo with a turn argument is a Pro feature', () => {
  const home = tempDir()
  writeFileSync(join(home, 'trial.json'), JSON.stringify({ used: 3 }))
  const r = cli(['undo', 'abc'], makeProject({}), home)
  assert.match(r.stdout, /Undoing an earlier turn is part of turnslip Pro/)
})

test('mode simple is saved; detailed is Pro', () => {
  const home = tempDir()
  const root = makeProject({})
  assert.match(cli(['mode', 'simple'], root, home).stdout, /mode: simple/)
  assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).mode, 'simple')
  assert.match(cli(['mode', 'detailed'], root, home).stdout, /Detailed mode is part of turnslip Pro/)
})

test('setup prints version, Node and data location', () => {
  const home = tempDir()
  const r = cli(['setup'], makeProject({}), home)
  assert.match(r.stdout, /^turnslip \d+\.\d+\.\d+ · Node v\d+/) // the exact string is pinned in verbs.test.mjs
  assert.ok(r.stdout.includes(home))
})

test('unknown verbs print usage and exit 0', () => {
  const r = cli(['bogus'], makeProject({}), tempDir())
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^usage: \/turnslip:undo \[n\|id\] · \/turnslip:history \[n\] \[--ids\] · \/turnslip:report · \/turnslip:mode simple\|detailed · \/turnslip:setup · \/turnslip:buy · \/turnslip:activate <key> · \/turnslip:deactivate$/m)
})

const ACTIVATE_USAGE = 'usage: /turnslip:activate <key> · the key is in the email from Dodo Payments'

// No CLI test may pass a well-formed key: the shipped ids are live, so it would reach Dodo. No CLI test
// runs buy: it would open a real browser (test/verbs.test.mjs fakes the opener).
test('activate checks the key format before anything else', () => {
  const root = makeProject({})
  assert.equal(cli(['activate'], root, tempDir()).stdout.trim(), ACTIVATE_USAGE)
  assert.equal(cli(['activate', 'TS', 'AAAA'], root, tempDir()).stdout.trim(), ACTIVATE_USAGE)
  // several arguments are joined, so a valid first word plus a stray word fails the key check
  assert.equal(cli(['activate', 'TS-AAAA-BBBB-WXYZ', 'x'], root, tempDir()).stdout.trim(), ACTIVATE_USAGE)
})

test('deactivate without a license says so', () => {
  assert.equal(cli(['deactivate'], makeProject({}), tempDir()).stdout.trim(), 'turnslip · no license on this machine')
})

test('an error in a verb is printed and logged to <home>/log', () => {
  const home = tempDir()
  mkdirSync(join(home, 'config.json')) // a folder where config.json goes: the write throws
  const r = cli(['mode', 'simple'], makeProject({}), home)
  assert.match(r.stdout, /^turnslip · something went wrong: /)
  assert.match(readFileSync(join(home, 'log'), 'utf8'), / cli mode /)
})
