import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadIgnore, makeIsTracked, parseGitignore } from '../plugin/lib/gitignore.mjs'
import { makeProject } from './helpers.mjs'

const ig = (text) => {
  const root = makeProject({ '.gitignore': text })
  return loadIgnore(root)
}

test('unanchored globs match at any depth', () => {
  const i = ig('*.log\n')
  assert.equal(i('a/b.log', false), true)
  assert.equal(i('a/b.txt', false), false)
})

test('a trailing slash matches directories only', () => {
  const i = ig('build/\n')
  assert.equal(i('build', true), true)
  assert.equal(i('build', false), false)
})

test('a leading slash anchors to the root', () => {
  const i = ig('/dist\n')
  assert.equal(i('dist', true), true)
  assert.equal(i('src/dist', true), false)
})

test('negation re-includes, last rule wins', () => {
  const i = ig('*.log\n!keep.log\n')
  assert.equal(i('keep.log', false), false)
  assert.equal(i('drop.log', false), true)
})

test('double star crosses directories', () => {
  const i = ig('**/tmp\n')
  assert.equal(i('a/b/tmp', true), true)
})

test('comments and blank lines are ignored; .git and node_modules always are', () => {
  assert.equal(parseGitignore('# c\n\n').length, 0)
  const i = ig('')
  assert.equal(i('node_modules', true), true)
  assert.equal(i('sub/.git', true), true)
})

test('no .gitignore means only the built-in exclusions', () => {
  const i = loadIgnore(makeProject({ 'a.txt': 'x' }))
  assert.equal(i('a.txt', false), false)
})

test('isTracked checks every parent directory', () => {
  const root = makeProject({ '.gitignore': 'build/\n' })
  const t = makeIsTracked(root)
  assert.equal(t('build/out.js'), false)
  assert.equal(t('node_modules/x/index.js'), false)
  assert.equal(t('src/a.js'), true)
})

// Nested .gitignore files (spike §11: web/.gitignore with dist/ was not honoured).
test('a nested .gitignore applies only under its own directory', () => {
  const i = loadIgnore(makeProject({ 'web/.gitignore': 'dist/\n' }))
  assert.equal(i('web/dist', true), true)
  assert.equal(i('dist', true), false) // a sibling at the root is not touched
  assert.equal(i('api/dist', true), false)
})

test('a nested pattern with a slash is relative to its own directory', () => {
  const i = loadIgnore(makeProject({ 'web/.gitignore': '/build\nsrc/gen\n' }))
  assert.equal(i('web/build', true), true)
  assert.equal(i('web/src/build', true), false)
  assert.equal(i('build', true), false)
  assert.equal(i('web/src/gen', true), true)
  assert.equal(i('src/gen', true), false)
})

test('a deeper .gitignore overrides a shallower one, both ways', () => {
  const i = loadIgnore(makeProject({ '.gitignore': '*.log\n', 'web/.gitignore': '!keep.log\n', 'api/.gitignore': 'secret.txt\n' }))
  assert.equal(i('keep.log', false), true)
  assert.equal(i('web/keep.log', false), false)
  assert.equal(i('web/other.log', false), true)
  assert.equal(i('api/secret.txt', false), true)
  assert.equal(i('secret.txt', false), false)
})

test('isTracked honours nested .gitignore files', () => {
  const t = makeIsTracked(makeProject({ 'web/.gitignore': 'dist/\n', 'web/dist/bundle.js': 'b' }))
  assert.equal(t('web/dist/bundle.js'), false)
  assert.equal(t('web/app.js'), true)
  assert.equal(t('dist/bundle.js'), true)
})

// NEXT §7: escapes, bracket classes, and git's ignorecase default on Windows and macOS.
test('a backslash escapes # and ! at the start of a pattern', () => {
  const i = loadIgnore(makeProject({ '.gitignore': '\\#notes.txt\n\\!important.txt\n' }), 'linux')
  assert.equal(i('#notes.txt', false), true)
  assert.equal(i('!important.txt', false), true)
  assert.equal(i('important.txt', false), false) // not a negation
  assert.equal(i('notes.txt', false), false)
})

test('bracket classes match one character from the set, a range, or not the set', () => {
  const i = loadIgnore(makeProject({ '.gitignore': 'log[0-9].txt\nfile[abc].js\ntmp[!x].md\n' }), 'linux')
  assert.equal(i('log7.txt', false), true)
  assert.equal(i('logx.txt', false), false)
  assert.equal(i('fileb.js', false), true)
  assert.equal(i('filed.js', false), false)
  assert.equal(i('tmpa.md', false), true)
  assert.equal(i('tmpx.md', false), false)
  assert.equal(i('[unclosed', false), false)
  assert.equal(loadIgnore(makeProject({ '.gitignore': '[unclosed\n' }), 'linux')('[unclosed', false), true) // an unclosed [ is literal
})

test('matching ignores case on Windows and macOS, as git does by default, and not on Linux', () => {
  const text = 'Build/\n*.LOG\n'
  for (const platform of ['win32', 'darwin']) {
    const i = loadIgnore(makeProject({ '.gitignore': text }), platform)
    assert.equal(i('build', true), true, platform)
    assert.equal(i('debug.log', false), true, platform)
  }
  const linux = loadIgnore(makeProject({ '.gitignore': text }), 'linux')
  assert.equal(linux('build', true), false)
  assert.equal(linux('debug.log', false), false)
  assert.equal(makeIsTracked(makeProject({ '.gitignore': 'Dist/\n' }), 'win32')('dist/a.js'), false)
})
