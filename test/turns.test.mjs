import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { blobPath, putBlob, writeJson } from '../plugin/lib/store.mjs'
import { projectDir } from '../plugin/lib/paths.mjs'
import { appendEvent, clearCurrent, gcBlobs, getCurrent, findTurn, inProgressTurns, listHistory, listTurnIds, loadTurn, newTurnId, pruneTurns, readEvents, saveTurn, setCurrent } from '../plugin/lib/turns.mjs'
import { isPro } from '../plugin/lib/license.mjs'
import { makeProject, tempDir } from './helpers.mjs'

test('turn ids sort in creation order', () => {
  assert.ok(newTurnId(1000) < newTurnId(2000))
})

test('turns and events round-trip; a torn event line is skipped', () => {
  const pdir = tempDir()
  saveTurn(pdir, { id: 't1', finished: false })
  appendEvent(pdir, 't1', { tool: 'Bash', command: 'ls' })
  appendEvent(pdir, 't1', { tool: 'Edit', path: 'a', before: null })
  assert.equal(loadTurn(pdir, 't1').id, 't1')
  assert.equal(readEvents(pdir, 't1').length, 2)
  assert.deepEqual(readEvents(pdir, 'missing'), [])
})

test('session pointers are per session and survive odd session ids', () => {
  const home = tempDir()
  setCurrent(home, 'a/b', { root: '/p', id: 't1' })
  setCurrent(home, 'c', { root: '/p', id: 't2' })
  assert.deepEqual(getCurrent(home, 'a/b'), { root: '/p', id: 't1' })
  clearCurrent(home, 'a/b')
  assert.equal(getCurrent(home, 'a/b'), null)
  assert.equal(getCurrent(home, 'c').id, 't2')
})

test('prune keeps the newest turns', () => {
  const pdir = tempDir()
  for (let i = 0; i < 5; i++) saveTurn(pdir, { id: newTurnId(1000 + i), finished: true })
  pruneTurns(pdir, 2)
  assert.equal(listTurnIds(pdir).length, 2)
})

test('listHistory: finished turns with changes, newest first, undo records and every session included', () => {
  const pdir = tempDir()
  const ids = [1, 2, 3, 4, 5].map((n) => newTurnId(n))
  saveTurn(pdir, { id: ids[0], sessionId: 's1', finished: true, changes: [{ path: 'a' }] })
  saveTurn(pdir, { id: ids[1], sessionId: 's1', finished: true, changes: [] })
  saveTurn(pdir, { id: ids[2], sessionId: 's1', finished: false, changes: [{ path: 'c' }] })
  saveTurn(pdir, { id: ids[3], kind: 'undo', finished: true, changes: [{ path: 'a' }] })
  saveTurn(pdir, { id: ids[4], sessionId: 's2', finished: true, changes: [{ path: 'b' }] })
  assert.deepEqual(listHistory(pdir).map((t) => t.id), [ids[4], ids[3], ids[0]])
  assert.deepEqual(listHistory(tempDir()), [])
})

test('listHistory stops at max (default 50)', () => {
  const pdir = tempDir()
  for (let n = 1; n <= 60; n++) saveTurn(pdir, { id: newTurnId(n), finished: true, changes: [{ path: 'a' }] })
  assert.equal(listHistory(pdir).length, 50)
  assert.equal(listHistory(pdir, 3).length, 3)
  assert.equal(listHistory(pdir)[0].id, listTurnIds(pdir).at(-1))
})

test('findTurn takes a 1-based number or an exact id, nothing else', () => {
  const list = [{ id: '00000000c-aaaaaa' }, { id: '00000000b-bbbbbb' }, { id: '00000000a-cccccc' }]
  assert.equal(findTurn(list, '1'), list[0])
  assert.equal(findTurn(list, '3'), list[2])
  assert.equal(findTurn(list, '00000000b-bbbbbb'), list[1])
  for (const bad of ['0', '-1', '3.5', '4', '99', '', ' 1', '01', '00000000b', 'b-bbbbbb']) assert.equal(findTurn(list, bad), null, bad)
})

test('inProgressTurns finds unfinished turns for this root only', () => {
  const home = tempDir()
  const root = makeProject({})
  const other = makeProject({})
  const pdir = projectDir(home, root)
  saveTurn(pdir, { id: 't1', root, finished: false })
  setCurrent(home, 's1', { root, id: 't1' })
  setCurrent(home, 's2', { root: other, id: 'tX' })
  assert.deepEqual(inProgressTurns(home, root).map((x) => x.turn.id), ['t1'])
})

test('gc removes old unreferenced blobs and keeps referenced or young ones', () => {
  const home = tempDir()
  const root = makeProject({})
  const pdir = projectDir(home, root)
  const kept = putBlob(home, Buffer.from('kept'))
  const orphan = putBlob(home, Buffer.from('orphan'))
  const young = putBlob(home, Buffer.from('young'))
  writeJson(join(pdir, 'index.json'), { a: { mtime: 1, size: 1, hash: kept } })
  const old = new Date(Date.now() - 2 * 3600_000)
  utimesSync(blobPath(home, kept), old, old)
  utimesSync(blobPath(home, orphan), old, old)
  assert.equal(gcBlobs(home), 1)
  assert.equal(existsSync(blobPath(home, orphan)), false)
  assert.equal(existsSync(blobPath(home, kept)), true)
  assert.equal(existsSync(blobPath(home, young)), true)
})

test('isPro is false until plan 2 wires licensing', () => {
  assert.equal(isPro(tempDir()), false)
})

test('a torn event line is skipped and the whole lines around it survive', () => {
  const pdir = tempDir()
  appendEvent(pdir, 't1', { tool: 'Bash', command: 'a' })
  appendFileSync(join(pdir, 'turns', 't1', 'events.jsonl'), '{"tool":"Ed')
  appendFileSync(join(pdir, 'turns', 't1', 'events.jsonl'), '\n')
  appendEvent(pdir, 't1', { tool: 'Bash', command: 'b' })
  assert.deepEqual(readEvents(pdir, 't1').map((e) => e.command), ['a', 'b'])
})

test('gc keeps every blob a turn record or event references, and an unfinished turn start (final #8)', () => {
  const home = tempDir()
  const root = makeProject({})
  const pdir = projectDir(home, root)
  const names = ['start', 'before', 'after', 'event', 'orphan']
  const h = Object.fromEntries(names.map((n) => [n, putBlob(home, Buffer.from(n))]))
  saveTurn(pdir, { id: 't1', finished: true, changes: [{ path: 'a.txt', before: h.before, after: h.after }] })
  saveTurn(pdir, { id: 't2', finished: false, start: { 'a.txt': h.start } })
  appendEvent(pdir, 't1', { tool: 'Edit', path: 'a.txt', before: h.event })
  const old = new Date(Date.now() - 2 * 3600_000)
  for (const n of names) utimesSync(blobPath(home, h[n]), old, old)
  assert.equal(gcBlobs(home), 1)
  for (const n of names.slice(0, -1)) assert.equal(existsSync(blobPath(home, h[n])), true, n)
  assert.equal(existsSync(blobPath(home, h.orphan)), false)
})

test('gc skips a stray file in objects/ and stops deleting once its budget passes (final #8)', () => {
  const home = tempDir()
  const orphan = putBlob(home, Buffer.from('orphan'))
  const old = new Date(Date.now() - 2 * 3600_000)
  utimesSync(blobPath(home, orphan), old, old)
  writeFileSync(join(home, 'store', 'objects', 'stray'), 'x')
  assert.equal(gcBlobs(home, { budgetMs: 0 }), 0)
  assert.equal(existsSync(blobPath(home, orphan)), true)
  assert.equal(gcBlobs(home), 1)
  assert.equal(existsSync(blobPath(home, orphan)), false)
})

test('turn ids made in the same millisecond still sort in the order they were made (CI macOS)', () => {
  const ids = Array.from({ length: 200 }, () => newTurnId(1_000_000))
  assert.deepEqual([...ids].sort(), ids)
  const live = Array.from({ length: 200 }, () => newTurnId())
  assert.deepEqual([...live].sort(), live)
})
