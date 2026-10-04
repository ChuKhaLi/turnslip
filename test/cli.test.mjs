import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIB, makeProject, tempDir } from './helpers.mjs'

const cli = (args, cwd, home) => spawnSync(process.execPath, [join(LIB, 'cli.mjs'), ...args], { cwd, env: { ...process.env, TURNSLIP_HOME: home }, encoding: 'utf8' })

test('undo with a turn argument is a Pro feature', () => {
  const r = cli(['undo', 'abc'], makeProject({}), tempDir())
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
  assert.match(r.stdout, /^usage: \/turnslip:undo \[n\|id\] · \/turnslip:history \[n\] \[--ids\] · \/turnslip:report · \/turnslip:mode simple\|detailed · \/turnslip:setup$/m)
})
