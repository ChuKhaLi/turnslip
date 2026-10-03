import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nextIndexerRun, onPostToolUse, onStop, onUserPromptSubmit, startIndexer } from '../plugin/lib/hook.mjs'
import { projectDir } from '../plugin/lib/paths.mjs'
import { readJson, snapshot, writeJson } from '../plugin/lib/store.mjs'
import { getCurrent, loadTurn } from '../plugin/lib/turns.mjs'
import { undoLatest } from '../plugin/lib/undo.mjs'
import { hookInput, makeProject, tempDir } from './helpers.mjs'

const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)) }
  return false
}

test('the first turn of a new project runs light and builds the index in the background', async () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'old\n' })
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root) })
  assert.equal(await until(() => existsSync(join(projectDir(home, root), 'index.json'))), true)
})

test('light mode reports tool edits with their pre-image and says shell changes are not tracked', () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'old\n' })
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root), budgetMs: 0 })
  writeFileSync(join(root, 'a.txt'), 'new\n')
  writeFileSync(join(root, 'shell.txt'), 'x\n')
  onPostToolUse({ home, input: hookInput('PostToolUse', root, { tool_name: 'Edit', tool_input: { file_path: join(root, 'a.txt') }, tool_response: { originalFile: 'old\n' } }) })
  const out = onStop({ home, input: hookInput('Stop', root, { last_assistant_message: '<receipt>Edited | files: a.txt</receipt>' }) })
  assert.equal(out.systemMessage, 'turnslip · Edited · 1 file · shell changes not tracked yet · /turnslip:undo')
})

test('a fresh lock stops a second indexer', () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a' })
  const pdir = projectDir(home, root)
  mkdirSync(pdir, { recursive: true })
  writeFileSync(join(pdir, 'indexing.lock'), 'held')
  startIndexer(home, root) // a spawn would overwrite the lock with its pid
  assert.equal(readFileSync(join(pdir, 'indexing.lock'), 'utf8'), 'held')
})

test('a stale index runs the turn light and rebuilds the index in the background (final #1)', async () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  const index = join(projectDir(home, root), 'index.json')
  writeJson(index, snapshot({ home, root }).index)
  const old = new Date(Date.now() - 3600_000)
  utimesSync(index, old, old)
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root), budgetMs: 0 })
  const ptr = getCurrent(home, 'sess-1')
  assert.equal(loadTurn(projectDir(home, root), ptr.id).light, true)
  assert.equal(await until(() => statSync(index).mtimeMs > old.getTime() + 1000), true)
})

test('light mode drops ignored paths, so undo never writes them back (final #7)', () => {
  const home = tempDir()
  const root = makeProject({ '.gitignore': 'cfg.local\n', 'a.txt': 'old\n', 'cfg.local': 'x=1\n' })
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root), budgetMs: 0 })
  writeFileSync(join(root, 'a.txt'), 'new\n')
  writeFileSync(join(root, 'cfg.local'), 'x=2\n')
  onPostToolUse({ home, input: hookInput('PostToolUse', root, { tool_name: 'Edit', tool_input: { file_path: join(root, 'a.txt') }, tool_response: { originalFile: 'old\n' } }) })
  onPostToolUse({ home, input: hookInput('PostToolUse', root, { tool_name: 'Edit', tool_input: { file_path: join(root, 'cfg.local') }, tool_response: { originalFile: 'x=1\n' } }) })
  const out = onStop({ home, input: hookInput('Stop', root, { last_assistant_message: '<receipt>Edited | files: a.txt</receipt>' }) })
  assert.equal(out.systemMessage, 'turnslip · Edited · 1 file · shell changes not tracked yet · /turnslip:undo')
  writeJson(join(projectDir(home, root), 'index.json'), snapshot({ home, root }).index)
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root, { session_id: 's2' }) })
  undoLatest({ home, root })
  assert.equal(onStop({ home, input: hookInput('Stop', root, { session_id: 's2', last_assistant_message: '<receipt>Ran undo | files: none</receipt>' }) }), null)
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'old\n')
  assert.equal(readFileSync(join(root, 'cfg.local'), 'utf8'), 'x=2\n')
})

// NEXT §6: a project whose warm snapshot never fits the budget spawned a full walk at every prompt.
test('the indexer backs off: at once, then 1, 2, 4 ... minutes, at most 60', () => {
  const MIN = 60_000
  const t = 1_000_000_000
  assert.equal(nextIndexerRun(null, t), true)
  assert.equal(nextIndexerRun({ streak: 0, lastSpawn: t }, t), true)
  assert.equal(nextIndexerRun({ streak: 1, lastSpawn: t }, t + MIN - 1), false)
  assert.equal(nextIndexerRun({ streak: 1, lastSpawn: t }, t + MIN), true)
  assert.equal(nextIndexerRun({ streak: 3, lastSpawn: t }, t + 4 * MIN - 1), false)
  assert.equal(nextIndexerRun({ streak: 3, lastSpawn: t }, t + 4 * MIN), true)
  assert.equal(nextIndexerRun({ streak: 20, lastSpawn: t }, t + 60 * MIN - 1), false)
  assert.equal(nextIndexerRun({ streak: 20, lastSpawn: t }, t + 60 * MIN), true)
})

test('a project over budget at every prompt spawns one indexer, not one per prompt', async () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a\n' })
  const pdir = projectDir(home, root)
  writeJson(join(pdir, 'index.json'), snapshot({ home, root }).index)
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root), budgetMs: 0 })
  const first = readJson(join(pdir, 'indexer.json'))
  assert.equal(first.streak, 1)
  assert.equal(await until(() => !existsSync(join(pdir, 'indexing.lock'))), true) // the walk is over: no lock holds back a second
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root), budgetMs: 0 })
  assert.deepEqual(readJson(join(pdir, 'indexer.json')), first)
  assert.equal(existsSync(join(pdir, 'indexing.lock')), false) // no second spawn
})

test('a prompt within budget resets the backoff', () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a\n' })
  const pdir = projectDir(home, root)
  writeJson(join(pdir, 'index.json'), snapshot({ home, root }).index)
  writeJson(join(pdir, 'indexer.json'), { streak: 4, lastSpawn: Date.now() })
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root) })
  assert.equal(readJson(join(pdir, 'indexer.json')).streak, 0)
})

test('a failed indexer spawn crashes nothing and frees the lock (NEXT §7)', async () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a' })
  const lock = join(projectDir(home, root), 'indexing.lock')
  startIndexer(home, root, { execPath: join(tempDir(), 'no-such-node.exe') })
  assert.equal(await until(() => !existsSync(lock)), true)
  assert.equal(existsSync(join(projectDir(home, root), 'index.json')), false) // the spawn failed: nothing was indexed
})

test('a stale lock is taken over; a fresh one is not', () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a' })
  const pdir = projectDir(home, root)
  mkdirSync(pdir, { recursive: true })
  const lock = join(pdir, 'indexing.lock')
  writeFileSync(lock, 'old')
  const old = new Date(Date.now() - 11 * 60_000)
  utimesSync(lock, old, old)
  startIndexer(home, root)
  assert.notEqual(readFileSync(lock, 'utf8'), 'old')
})
