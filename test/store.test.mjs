import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_FILE_BYTES, getBlob, hashBytes, putBlob, readJson, snapshot, writeAtomic, writeJson } from '../plugin/lib/store.mjs'
import { makeProject, tempDir } from './helpers.mjs'

test('blobs round-trip and are stored once', () => {
  const home = tempDir()
  const h1 = putBlob(home, Buffer.from('hello'))
  const h2 = putBlob(home, Buffer.from('hello'))
  assert.equal(h1, h2)
  assert.equal(h1, hashBytes(Buffer.from('hello')))
  assert.equal(getBlob(home, h1).toString(), 'hello')
})

test('readJson falls back on missing or corrupt files; writeJson creates parents', () => {
  const dir = tempDir()
  assert.equal(readJson(join(dir, 'nope.json'), 7), 7)
  writeFileSync(join(dir, 'bad.json'), '{')
  assert.equal(readJson(join(dir, 'bad.json')), null)
  writeJson(join(dir, 'a', 'b.json'), { x: 1 })
  assert.deepEqual(readJson(join(dir, 'a', 'b.json')), { x: 1 })
})

test('a snapshot covers tracked files and skips ignored, node_modules and oversized ones', () => {
  const root = makeProject({
    '.gitignore': 'dist/\n', 'src/a.js': 'a', 'dist/out.js': 'o', 'node_modules/m/i.js': 'm',
  })
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(MAX_FILE_BYTES + 1))
  const snap = snapshot({ home: tempDir(), root })
  assert.deepEqual(Object.keys(snap.manifest).sort(), ['.gitignore', 'src/a.js'])
})

test('a warm snapshot trusts mtime and size instead of re-reading', () => {
  const home = tempDir()
  const root = makeProject({})
  const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000) // whole second, 1 min ago
  const aPath = join(root, 'a.txt')
  writeFileSync(aPath, 'aaaa')
  utimesSync(aPath, T, T)
  const first = snapshot({ home, root })
  writeFileSync(aPath, 'bbbb') // same size
  utimesSync(aPath, T, T)
  const warm = snapshot({ home, root, index: first.index })
  assert.equal(warm.manifest['a.txt'], first.manifest['a.txt'])
  const cold = snapshot({ home, root })
  assert.notEqual(cold.manifest['a.txt'], first.manifest['a.txt'])
})

test('a passed deadline returns null, never a partial manifest', () => {
  const root = makeProject({ 'a.txt': 'x', 'b/c.txt': 'y' })
  assert.equal(snapshot({ home: tempDir(), root, deadline: performance.now() - 1 }), null)
})

// Spec §11: a warm turn-start snapshot of 20,000 files fits the 500 ms budget.
test('a warm snapshot of 20,000 files takes under 500 ms', { timeout: 180000 }, () => {
  const home = tempDir()
  const root = makeProject({})
  for (let d = 0; d < 200; d++) {
    mkdirSync(join(root, `d${d}`))
    for (let f = 0; f < 100; f++) writeFileSync(join(root, `d${d}`, `f${f}.txt`), `${d}-${f}\n`)
  }
  const cold = snapshot({ home, root })
  const t0 = performance.now()
  const warm = snapshot({ home, root, index: cold.index, deadline: t0 + 500 })
  assert.notEqual(warm, null, `warm snapshot passed the budget (${Math.round(performance.now() - t0)} ms)`)
  assert.equal(Object.keys(warm.manifest).length, 20000)
})

test('an unreadable directory is skipped, not the whole snapshot (final #3)', () => {
  const root = makeProject({ 'a.txt': 'a\n', 'data/db/x.bin': 'x', 'data/keep.txt': 'k' })
  const readDir = (p, o) => {
    if (p.replace(/\\/g, '/').endsWith('data/db')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    return readdirSync(p, o)
  }
  const snap = snapshot({ home: tempDir(), root, readDir })
  assert.deepEqual(Object.keys(snap.manifest).sort(), ['a.txt', 'data/keep.txt'])
  assert.throws(() => snapshot({ home: tempDir(), root, readDir: () => { throw new Error('EPERM') } }), /EPERM/)
})

test('a snapshot leaves out what a nested .gitignore ignores (spike §11)', () => {
  const home = tempDir()
  const root = makeProject({ 'web/.gitignore': 'dist/\n', 'web/dist/bundle.js': 'b\n', 'web/app.js': 'a\n', 'dist/keep.js': 'k\n' })
  assert.deepEqual(Object.keys(snapshot({ home, root }).manifest).sort(), ['dist/keep.js', 'web/.gitignore', 'web/app.js'])
})

test('writeAtomic leaves no .tmp file behind when it fails (NEXT §7)', () => {
  const dir = tempDir()
  const target = join(dir, 'busy')
  mkdirSync(join(target, 'inside'), { recursive: true }) // a non-empty directory where the file should go: rename fails
  assert.throws(() => writeAtomic(target, 'x'))
  assert.deepEqual(readdirSync(dir), ['busy'])
})
