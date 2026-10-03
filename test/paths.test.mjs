import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, parse } from 'node:path'
import { isTrackableRoot, normalizeAbs, projectId, toRel, turnslipHome } from '../plugin/lib/paths.mjs'

test('TURNSLIP_HOME overrides the default home', () => {
  assert.equal(turnslipHome({ TURNSLIP_HOME: join('x', 'y') }).endsWith(join('x', 'y')), true)
  assert.equal(turnslipHome({}), join(homedir(), '.turnslip'))
})

test('project ids ignore case and separators on Windows only', () => {
  assert.equal(projectId('C:\\Work\\App', 'win32'), projectId('c:/work/app', 'win32'))
  assert.equal(normalizeAbs('C:\\Work', 'win32').includes('\\'), false)
})

test('the home directory and a filesystem root are not trackable', () => {
  assert.equal(isTrackableRoot(homedir()), false)
  assert.equal(isTrackableRoot(parse(process.cwd()).root), false)
  assert.equal(isTrackableRoot(join(homedir(), 'some-project')), true)
})

test('toRel returns forward-slash paths relative to the root', () => {
  const root = join(homedir(), 'p')
  assert.equal(toRel(root, join(root, 'src', 'a.js')), 'src/a.js')
  assert.equal(toRel(root, 'src/b.js'), 'src/b.js')
  assert.equal(toRel(root, join(homedir(), 'other.txt')), '../other.txt')
})
