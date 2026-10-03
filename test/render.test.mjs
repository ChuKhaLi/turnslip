import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanSentence, renderSlip, shortCmd } from '../plugin/lib/render.mjs'

// NEXT §7: text safety in what turnslip prints.
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

test('shortCmd of a missing command is empty, and a cut never splits an emoji', () => {
  assert.equal(shortCmd(undefined), '')
  assert.equal(shortCmd(null), '')
  const out = shortCmd('😀'.repeat(50))
  assert.equal(Array.from(out).length, 40)
  assert.ok(!loneSurrogate.test(out))
})

test('cleanSentence cuts at 120 characters, never inside an emoji', () => {
  const out = cleanSentence('😀'.repeat(130))
  assert.equal(Array.from(out).length, 120)
  assert.ok(!loneSurrogate.test(out))
})

test('cleanSentence turns Unicode line separators and bidi controls into spaces', () => {
  const seps = [0x2028, 0x2029, 0x85, 0x202e, 0x2066, 0x200f].map((n) => String.fromCharCode(n))
  assert.equal(cleanSentence(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((ch, i) => ch + (seps[i] ?? '')).join('')), 'a b c d e f g')
})

const base = { sentence: 'Added a login page', changes: [], flags: [], unmentioned: [], claimedUnchanged: [], light: false }
const c = (path, extra = {}) => ({ path, status: 'modified', plus: 1, minus: 0, source: 'tool', ...extra })

test('nothing changed and nothing flagged renders nothing', () => {
  assert.equal(renderSlip(base), '')
})

test('simple mode matches the spec example, on one line', () => {
  const s = renderSlip({ ...base, changes: [c('src/login.tsx'), c('src/api.ts'), c('.env', { status: 'added', source: 'shell' })], flags: [{ kind: 'secret', path: '.env', line: null }], unmentioned: ['.env'] })
  assert.equal(s, 'turnslip · Added a login page · 3 files · 🔑 key added in .env · not mentioned: .env · /turnslip:undo')
  assert.equal(s.includes('\n'), false)
})

test('no receipt says so; long lists are cut', () => {
  const s = renderSlip({ ...base, sentence: null, changes: [c('a')], unmentioned: ['a', 'b', 'c', 'd', 'e'] })
  assert.match(s, /^turnslip · Claude gave no summary · 1 file · not mentioned: a, b, c \+2 more · \/turnslip:undo$/)
})

test('a flag without file changes still renders, without the undo hint', () => {
  assert.equal(renderSlip({ ...base, flags: [{ kind: 'ship', command: 'git push' }] }), 'turnslip · Added a login page · 🚀 pushed or deployed')
})

test('light mode says shell changes are not tracked yet', () => {
  assert.match(renderSlip({ ...base, changes: [c('a')], light: true }), /shell changes not tracked yet/)
})

test('detailed mode lists paths with counts and marks shell changes', () => {
  const s = renderSlip({ ...base, changes: [c('src/api.ts', { plus: 8, minus: 2 }), c('.env', { status: 'added', plus: 1, source: 'shell' })], flags: [{ kind: 'secret', path: '.env', line: 1 }], unmentioned: ['.env'] }, 'detailed')
  assert.equal(s, 'turnslip · src/api.ts +8 −2 · .env +1 −0 (shell) · 🔑 .env:1 · unmentioned: .env · /turnslip:undo')
})

test('sentences lose newlines and control characters and are capped', () => {
  assert.equal(cleanSentence('a\nb\u0007c'), 'a b c')
  assert.equal(cleanSentence('x'.repeat(200)).length, 120)
  assert.equal(cleanSentence('   '), null)
  assert.equal(shortCmd('npm   install   left-pad'), 'npm install left-pad')
})

test('paths with control characters are sanitized in simple and detailed modes', () => {
  const s = renderSlip({ ...base, changes: [c('src/file\nname.tsx'), c('.env\u001b[31m', { status: 'added' })], flags: [{ kind: 'secret', path: 'secret\npath.env', line: 1 }], unmentioned: ['un\nmentioned.ts'] })
  assert.equal(s.includes('\n'), false)
  assert.equal(s.includes('\u001b'), false)
  const d = renderSlip({ ...base, changes: [c('src/file\nname.tsx'), c('.env\u001b[31m', { status: 'added' })], flags: [{ kind: 'secret', path: 'secret\npath.env', line: 1 }], unmentioned: ['un\nmentioned.ts'] }, 'detailed')
  assert.equal(d.includes('\n'), false)
  assert.equal(d.includes('\u001b'), false)
})
