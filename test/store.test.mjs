import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_FILE_BYTES, getBlob, hashBytes, putBlob, readJson, secureHome, snapshot, writeAtomic, writeJson } from '../plugin/lib/store.mjs'
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
  // Best of three: a shared CI runner (Windows especially) stalls now and then, which says nothing
  // about the code; a real regression misses the budget every time.
  const times = []
  let warm = null
  for (let i = 0; i < 3 && !warm; i++) {
    const t0 = performance.now()
    warm = snapshot({ home, root, index: cold.index, deadline: t0 + 500 })
    times.push(Math.round(performance.now() - t0))
  }
  assert.notEqual(warm, null, `every warm snapshot passed the budget (${times.join(', ')} ms)`)
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

// Captured 2026-10-04: on Windows, two processes renaming onto one index.json (a hook and the detached
// indexer) made 12% of renames fail with EPERM in a probe; with short retries the worst case took 3.
test('writeAtomic retries a rename Windows refuses for a moment, and writes the file', () => {
  const dir = tempDir()
  const target = join(dir, 'index.json')
  let calls = 0
  const rename = (a, b) => { if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' }); renameSync(a, b) }
  writeAtomic(target, 'x', { platform: 'win32', rename, wait: () => {} })
  assert.equal(calls, 3)
  assert.equal(readFileSync(target, 'utf8'), 'x')
  assert.deepEqual(readdirSync(dir), ['index.json'])
})

test('writeAtomic gives up after its retries, leaving no .tmp, and never retries off Windows', () => {
  const dir = tempDir()
  const target = join(dir, 'index.json')
  let calls = 0
  const rename = () => { calls++; throw Object.assign(new Error('busy'), { code: 'EPERM' }) }
  assert.throws(() => writeAtomic(target, 'x', { platform: 'win32', rename, wait: () => {} }), { code: 'EPERM' })
  assert.equal(calls, 11)
  assert.deepEqual(readdirSync(dir), [])
  calls = 0
  assert.throws(() => writeAtomic(target, 'x', { platform: 'linux', rename, wait: () => {} }), { code: 'EPERM' })
  assert.equal(calls, 1)
  calls = 0
  const other = () => { calls++; throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }
  assert.throws(() => writeAtomic(target, 'x', { platform: 'win32', rename: other, wait: () => {} }), { code: 'ENOENT' })
  assert.equal(calls, 1, 'only a refusal is retried')
})

// ~/.turnslip holds license.json (the key) and snapshot blobs (.env files included): owner only on Unix.
function fakeFs(mode) {
  const calls = []
  return { calls, fs: {
    mkdirSync: (p, o) => calls.push(['mkdir', p, o]),
    statSync: () => ({ mode: 0o40000 | mode }),
    chmodSync: (p, m) => calls.push(['chmod', p, m]),
  } }
}

test('secureHome creates the home as 0700 and tightens one others can read (Unix)', () => {
  const a = fakeFs(0o755)
  assert.equal(secureHome('/h', { platform: 'linux', fs: a.fs }), true)
  assert.deepEqual(a.calls, [['mkdir', '/h', { recursive: true, mode: 0o700 }], ['chmod', '/h', 0o700]])
  const b = fakeFs(0o700)
  secureHome('/h', { platform: 'darwin', fs: b.fs })
  assert.deepEqual(b.calls, [['mkdir', '/h', { recursive: true, mode: 0o700 }]])
  const c = fakeFs(0o710) // group execute alone is still too open
  secureHome('/h', { platform: 'linux', fs: c.fs })
  assert.deepEqual(c.calls.at(-1), ['chmod', '/h', 0o700])
})

test('secureHome on Windows only creates the folder (ACLs, not modes, guard it there)', () => {
  const a = fakeFs(0o777)
  secureHome('C:/h', { platform: 'win32', fs: a.fs })
  assert.deepEqual(a.calls, [['mkdir', 'C:/h', { recursive: true, mode: 0o700 }]])
})

test('secureHome never throws', () => {
  const fs = { mkdirSync: () => { throw new Error('EACCES') }, statSync: () => ({ mode: 0 }), chmodSync: () => {} }
  assert.equal(secureHome('/h', { platform: 'linux', fs }), false)
})

test('secureHome on a real Unix home', { skip: process.platform === 'win32' }, () => {
  const home = join(tempDir(), 'ts-home')
  mkdirSync(home, { mode: 0o755 })
  secureHome(home)
  assert.equal(statSync(home).mode & 0o777, 0o700)
  const fresh = join(tempDir(), 'ts-fresh')
  secureHome(fresh)
  assert.equal(statSync(fresh).mode & 0o777, 0o700)
})
