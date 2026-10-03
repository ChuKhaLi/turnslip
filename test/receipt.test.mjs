import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeIsTracked } from '../plugin/lib/gitignore.mjs'
import { RECEIPT_INSTRUCTION, compareClaims, parseReceipt } from '../plugin/lib/receipt.mjs'
import { makeProject } from './helpers.mjs'

test('the instruction text is the one the spike measured 9/9', () => {
  assert.match(RECEIPT_INSTRUCTION, /^End your final reply with exactly one line of the form <receipt>/)
})

test('parses sentence and files', () => {
  assert.deepEqual(parseReceipt('Done.\n<receipt>Added login | files: src/a.ts, src/b.ts</receipt>'), { sentence: 'Added login', files: ['src/a.ts', 'src/b.ts'] })
})

test('a prose mention of the tag before the real line is not picked up (captured defect)', () => {
  const text = 'I will end with the `<receipt>` line below.\n\n<receipt>Created hello.txt | files: hello.txt</receipt>'
  assert.deepEqual(parseReceipt(text), { sentence: 'Created hello.txt', files: ['hello.txt'] })
  // Receipt in prose on same line must not match; only the anchored one at end should match
  const text2 = 'Wrap it as <receipt>x | files: y</receipt> at the end.\n\n<receipt>real | files: z</receipt>'
  assert.deepEqual(parseReceipt(text2), { sentence: 'real', files: ['z'] })
  // Receipt at start with text after must still match
  const text3 = '<receipt>a | files: x</receipt>\nThanks!'
  assert.deepEqual(parseReceipt(text3), { sentence: 'a', files: ['x'] })
})

test('the last receipt wins; none means an empty list; missing files section means null', () => {
  assert.deepEqual(parseReceipt('<receipt>a | files: x</receipt>\n<receipt>b | files: none</receipt>'), { sentence: 'b', files: [] })
  assert.deepEqual(parseReceipt('<receipt>just a sentence</receipt>'), { sentence: 'just a sentence', files: null })
  assert.equal(parseReceipt('no receipt here'), null)
  assert.equal(parseReceipt(undefined), null)
})

const tracked = () => true

test('unmentioned lists changed paths Claude did not claim', () => {
  const r = compareClaims({ changes: [{ path: 'a.js' }, { path: '.env' }], files: ['a.js'], root: '/p', isTracked: tracked, platform: 'linux' })
  assert.deepEqual(r, { unmentioned: ['.env'], claimedUnchanged: [] })
})

test('absolute Windows paths, backslashes and case still match on win32', () => {
  const r = compareClaims({ changes: [{ path: 'src/App.js' }], files: ['C:\\Work\\Proj\\SRC\\app.js'], root: 'C:\\Work\\Proj', isTracked: tracked, platform: 'win32' })
  assert.deepEqual(r.unmentioned, [])
})

test('a directory claim covers what is under it and is never "claimed but unchanged"', () => {
  const r = compareClaims({ changes: [{ path: 'dist/x.js' }], files: ['dist/', 'node_modules/'], root: '/p', isTracked: tracked, platform: 'linux' })
  assert.deepEqual(r, { unmentioned: [], claimedUnchanged: [] })
})

test('claimed but unchanged skips paths turnslip cannot see', () => {
  const r = compareClaims({ changes: [], files: ['a.js', 'build/out.js'], root: '/p', isTracked: (p) => !p.startsWith('build/'), platform: 'linux' })
  assert.deepEqual(r.claimedUnchanged, ['a.js'])
})

test('no files section compares nothing', () => {
  assert.deepEqual(compareClaims({ changes: [{ path: 'a' }], files: null, root: '/p', isTracked: tracked }), { unmentioned: [], claimedUnchanged: [] })
})

test('CRLF line endings are handled in receipt lines', () => {
  assert.deepEqual(parseReceipt('Done.\r\n<receipt>Fixed bug | files: src/fix.js</receipt>\r\n'), { sentence: 'Fixed bug', files: ['src/fix.js'] })
})

test('a directory claim without trailing slash covers paths under it', () => {
  const r = compareClaims({ changes: [{ path: 'src/a.js' }, { path: 'src/b.js' }], files: ['src'], root: '/p', isTracked: tracked, platform: 'linux' })
  assert.deepEqual(r, { unmentioned: [], claimedUnchanged: [] })
})

test('a directory claim without trailing slash that covers something is never unchanged', () => {
  const r = compareClaims({ changes: [{ path: 'src/a.js' }], files: ['src', 'docs'], root: '/p', isTracked: tracked, platform: 'linux' })
  assert.deepEqual(r.claimedUnchanged, ['docs'])
})

test('on win32 the ignore check sees the claim in its own case (minor)', () => {
  const isTracked = makeIsTracked(makeProject({ '.gitignore': 'Secrets.txt\n' }))
  const r = compareClaims({ changes: [], files: ['Secrets.txt'], root: 'C:\\p', isTracked, platform: 'win32' })
  assert.deepEqual(r.claimedUnchanged, [])
})
