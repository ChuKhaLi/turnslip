import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffManifests, isBinary, lineStats } from '../plugin/lib/diff.mjs'

test('a UTF-8 BOM and old-Mac lone CR line ends change no line count (NEXT §7)', () => {
  const b = (s) => Buffer.from(s, 'utf8')
  assert.deepEqual(lineStats(b('﻿a\nb\n'), b('a\nb\n')), { plus: 0, minus: 0, added: [] })
  assert.deepEqual(lineStats(b('a\nb\n'), b('﻿a\nb\n')), { plus: 0, minus: 0, added: [] })
  assert.deepEqual(lineStats(b('a\rb\r'), b('a\nb\n')), { plus: 0, minus: 0, added: [] })
  assert.deepEqual(lineStats(b('a\rb'), b('a\rc')), { plus: 1, minus: 1, added: [{ no: 2, text: 'c' }] })
})

test('diffManifests classifies added, modified and deleted, sorted by path', () => {
  const d = diffManifests({ a: '1', b: '2', c: '3' }, { b: '2', c: '9', d: '4' })
  assert.deepEqual(d, [
    { path: 'a', status: 'deleted', before: '1', after: null },
    { path: 'c', status: 'modified', before: '3', after: '9' },
    { path: 'd', status: 'added', before: null, after: '4' },
  ])
})

test('lineStats counts added and removed lines with their line numbers', () => {
  const s = lineStats(Buffer.from('a\nb\nc\n'), Buffer.from('a\nX\nc\nY\n'))
  assert.equal(s.plus, 2)
  assert.equal(s.minus, 1)
  assert.deepEqual(s.added, [{ no: 2, text: 'X' }, { no: 4, text: 'Y' }])
})

test('a new file is all plus; a deleted file is all minus', () => {
  assert.deepEqual([lineStats(null, Buffer.from('a\nb\n')).plus, lineStats(Buffer.from('a\nb\n'), null).minus], [2, 2])
})

test('a CRLF-only rewrite counts as no line change', () => {
  const s = lineStats(Buffer.from('a\nb\n'), Buffer.from('a\r\nb\r\n'))
  assert.deepEqual([s.plus, s.minus], [0, 0])
})

test('binary content has no line stats and no added lines', () => {
  const bin = Buffer.from([0x89, 0x50, 0x00, 0x01])
  assert.equal(isBinary(bin), true)
  assert.deepEqual(lineStats(null, bin), { plus: null, minus: null, added: [] })
})

test('files named like Object.prototype keys diff like any other (minor)', () => {
  assert.deepEqual(diffManifests({}, { constructor: '1' }), [{ path: 'constructor', status: 'added', before: null, after: '1' }])
  assert.deepEqual(diffManifests({ toString: '1' }, {}), [{ path: 'toString', status: 'deleted', before: '1', after: null }])
})
