import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { activityCutoff, onPostToolUse, onSessionEnd, onStop, onUserPromptSubmit } from '../plugin/lib/hook.mjs'
import { projectDir } from '../plugin/lib/paths.mjs'
import { hashBytes, snapshot, writeJson } from '../plugin/lib/store.mjs'
import { getCurrent, listHistory, newTurnId, saveTurn } from '../plugin/lib/turns.mjs'
import { currentHashFn, planUndo, undoLatest, undoTurn } from '../plugin/lib/undo.mjs'
import { hookInput, makeProject, tempDir } from './helpers.mjs'

function indexed(files) {
  const home = tempDir()
  const root = makeProject(files)
  writeJson(join(projectDir(home, root), 'index.json'), snapshot({ home, root }).index)
  return { home, root }
}
function agentTurn({ home, root }, act, session = 'sess-1') {
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root, { session_id: session }) })
  act()
  return onStop({ home, input: hookInput('Stop', root, { session_id: session, last_assistant_message: '<receipt>Did things | files: none</receipt>' }) })
}

test('undo restores modified and deleted files and removes created ones, shell changes included', () => {
  const p = indexed({ 'a.txt': 'a\n', 'gone.txt': 'g\n' })
  agentTurn(p, () => {
    writeFileSync(join(p.root, 'a.txt'), 'changed\n')
    writeFileSync(join(p.root, 'new.txt'), 'n\n')
    rmSync(join(p.root, 'gone.txt'))
  })
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.equal(readFileSync(join(p.root, 'gone.txt'), 'utf8'), 'g\n')
  assert.equal(existsSync(join(p.root, 'new.txt')), false)
  assert.match(out, /^turnslip · undid "Did things" \(just now\) · restored 2 files, removed 1$/)
})

test('undo never overwrites a file changed after the turn', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'claude\n'))
  writeFileSync(join(p.root, 'a.txt'), 'mine\n')
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'mine\n')
  assert.match(out, /kept 1 file changed since: a\.txt/)
})

test('undoing twice redoes', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'b\n'))
  undoLatest(p)
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'b\n')
})

test('effects outside files are listed as not undone', () => {
  const plan = planUndo({ turn: { changes: [], flags: [{ kind: 'packages', command: 'npm install left-pad' }, { kind: 'outside', command: 'cp a /etc/x', paths: ['/etc/x'] }] }, currentHash: () => null })
  assert.deepEqual(plan.notUndone, ['packages: npm install left-pad', 'outside the project: /etc/x'])
})

// A delete command whose deletions undo puts back is a file effect, not one "outside files" (spec §8):
// listing it as not undone beside "restored 2 files" read as a contradiction (captured 2026-10-07, spike
// 2026-10-07-claude-code-deleted-my-files). It stays listed when undo restores none of the turn's
// deletions: then they fell where no snapshot reaches (a path .gitignore excludes, outside the project).
const rmTurn = (changes) => ({ changes, flags: [{ kind: 'delete', command: 'rm -rf build' }, ...changes.map((c) => ({ kind: 'delete', path: c.path }))] })

test('a delete command whose deleted files undo restores is not listed as not undone', () => {
  const turn = rmTurn([{ path: 'build/a.css', status: 'deleted', before: 'h1', after: null }, { path: 'build/b.html', status: 'deleted', before: 'h2', after: null }])
  const plan = planUndo({ turn, currentHash: () => null })
  assert.equal(plan.restore.length, 2)
  assert.deepEqual(plan.notUndone, [])
})

test('a delete command that left no deletion undo can restore stays listed as not undone', () => {
  const ignored = planUndo({ turn: { changes: [], flags: [{ kind: 'delete', command: 'rm -rf node_modules' }] }, currentHash: () => null })
  assert.deepEqual(ignored.notUndone, ['delete: rm -rf node_modules'])
  const recreated = planUndo({ turn: rmTurn([{ path: 'build/a.css', status: 'deleted', before: 'h1', after: null }]), currentHash: () => 'mine' })
  assert.deepEqual(recreated.conflicts, ['build/a.css'])
  assert.deepEqual(recreated.notUndone, ['delete: rm -rf build'])
})

test('an undo run inside a turn does not show up as that turn\'s change', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'b\n'))
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root, { session_id: 's2' }) })
  undoLatest(p)
  const out = onStop({ home: p.home, input: hookInput('Stop', p.root, { session_id: 's2', last_assistant_message: '<receipt>Ran undo | files: none</receipt>' }) })
  assert.equal(out, null)
})

test('nothing to undo says so', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  assert.equal(undoLatest(p), 'turnslip · nothing to undo yet')
})

test('a tool edit with no captured earlier copy is kept, not removed', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  const now = hashBytes(Buffer.from('a\n'))
  const plan = planUndo({ turn: { changes: [{ path: 'a.txt', status: 'modified', before: null, after: now, unknownBefore: true }], flags: [] }, currentHash: currentHashFn(p.root) })
  assert.deepEqual(plan.remove, [])
  assert.deepEqual(plan.restore, [])
  assert.deepEqual(plan.noEarlierCopy, ['a.txt'])
  const id = newTurnId()
  saveTurn(projectDir(p.home, p.root), { id, finished: true, root: p.root, slip: { sentence: 'Edited a' }, flags: [], changes: [{ path: 'a.txt', status: 'modified', before: null, after: now, unknownBefore: true }] })
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.match(out, /kept 1 file \(no earlier copy\): a\.txt/)
})

// A file older than the turn but absent from the start snapshot has before:null too; undo must not take it for new.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('undo keeps a gitignored file the turn un-ignored (probe a)', async () => {
  const p = indexed({ '.gitignore': 'secret.env\n', 'secret.env': 'KEY=1\n', 'a.txt': 'a\n' })
  await sleep(2300)
  agentTurn(p, () => writeFileSync(join(p.root, '.gitignore'), ''))
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'secret.env'), 'utf8'), 'KEY=1\n')
  // Since NEXT §6 the un-ignored file is not part of the turn at all, so undo neither keeps nor names it.
  assert.match(out, /^turnslip · undid "Did things" \(just now\) · restored 1 file, removed 0$/)
  assert.equal(readFileSync(join(p.root, '.gitignore'), 'utf8'), 'secret.env\n')
})

test('undo keeps an oversized file the turn shrank (probe b)', async () => {
  const p = indexed({ 'big.bin': Buffer.alloc(6 * 1024 * 1024, 1) })
  await sleep(2300)
  agentTurn(p, () => writeFileSync(join(p.root, 'big.bin'), 'small\n'))
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'big.bin'), 'utf8'), 'small\n')
  assert.match(out, /kept 1 file \(no earlier copy\): big\.bin/)
})

test('a failed restore is reported, the rest is undone and recorded', () => {
  const p = indexed({ 'a.txt': 'a\n', e: 'plain\n' })
  agentTurn(p, () => {
    writeFileSync(join(p.root, 'a.txt'), 'b\n')
    rmSync(join(p.root, 'e'))
    mkdirSync(join(p.root, 'e'))
    writeFileSync(join(p.root, 'e', 'f.txt'), 'f\n')
  })
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.match(out, /could not restore: e/)
  const again = undoLatest(p)
  assert.doesNotMatch(again, /changed since: a\.txt/)
  const pdir = projectDir(p.home, p.root)
  const recs = readdirSync(join(pdir, 'turns')).map((id) => JSON.parse(readFileSync(join(pdir, 'turns', id, 'turn.json'), 'utf8'))).filter((t) => t.kind === 'undo')
  assert.ok(recs.some((t) => t.changes.some((c) => c.path === 'a.txt')))
})

test('when nothing could be undone, no empty undo record is saved', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'claude\n'))
  writeFileSync(join(p.root, 'a.txt'), 'mine\n')
  const out = undoLatest(p)
  assert.match(out, /^turnslip · nothing undone for "Did things" \(just now\) · kept 1 file changed since: a\.txt$/)
  const pdir = projectDir(p.home, p.root)
  const kinds = readdirSync(join(pdir, 'turns')).map((id) => JSON.parse(readFileSync(join(pdir, 'turns', id, 'turn.json'), 'utf8')).kind)
  assert.deepEqual(kinds.filter((k) => k === 'undo'), [])
})

test('redoing an undone deletion removes the file again, even one older than the turn', async () => {
  const p = indexed({ 'gone.txt': 'g\n' })
  await sleep(2300)
  agentTurn(p, () => rmSync(join(p.root, 'gone.txt')))
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'gone.txt'), 'utf8'), 'g\n')
  undoLatest(p)
  assert.equal(existsSync(join(p.root, 'gone.txt')), false)
})

test('a turn interrupted before Stop is finalized at the next prompt and is what undo takes back (final #2)', () => {
  const p = indexed({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'a2\n'))
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  writeFileSync(join(p.root, 'b.txt'), 'b2\n') // Esc: no Stop
  const t3 = onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  assert.deepEqual(Object.keys(t3), ['hookSpecificOutput']) // the finalized turn prints nothing
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'b\n')
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a2\n')
  assert.match(out, /^turnslip · undid "Claude gave no summary \(interrupted\)" \(just now\) · restored 1 file, removed 0 · files: b\.txt$/)
})

// The Esc window: Esc fires no Stop, so the turn is finished at the next prompt. Edits made between
// the two (the user's, a `!` line) carry an mtime after the turn's last event and are left out.
const later = () => Math.ceil(Date.now() / 1000) + 10 // whole seconds: NTFS mtimes are finer than ms
function claudeEdits({ home, root }, rel, text) {
  const orig = readFileSync(join(root, rel), 'utf8')
  writeFileSync(join(root, rel), text)
  onPostToolUse({ home, input: hookInput('PostToolUse', root, { tool_name: 'Edit', tool_input: { file_path: join(root, rel) }, tool_response: { filePath: join(root, rel), originalFile: orig } }) })
}

test('an edit made after Esc is left out of the interrupted turn, and undo names what it restored', () => {
  const p = indexed({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'claude\n')
  writeFileSync(join(p.root, 'b.txt'), 'mine\n') // Esc, then the user edits
  utimesSync(join(p.root, 'b.txt'), later(), later())
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'mine\n')
  assert.match(out, /^turnslip · undid "Claude gave no summary \(interrupted\)" \(just now\) · restored 1 file, removed 0 · files: a\.txt$/)
  undoLatest(p) // the redo must not bring anything of the user's back either
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'mine\n')
})

test('an interrupted turn with no tool events cuts off at its start', () => {
  const p = indexed({ 'b.txt': 'b\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  writeFileSync(join(p.root, 'b.txt'), 'mine\n')
  utimesSync(join(p.root, 'b.txt'), later(), later())
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  assert.equal(undoLatest(p), 'turnslip · nothing to undo yet')
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'mine\n')
})

test('a light interrupted turn leaves out a tool-touched file edited after Esc', () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a\n' }) // no index: the turn runs light
  const p = { home, root }
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root) })
  claudeEdits(p, 'a.txt', 'claude\n')
  writeFileSync(join(root, 'a.txt'), 'mine\n')
  utimesSync(join(root, 'a.txt'), later(), later())
  onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root) })
  assert.equal(undoLatest(p), 'turnslip · nothing to undo yet')
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'mine\n')
})

test('a turn finished by Stop after Esc and a ! line leaves out what the user wrote meanwhile (captured 2.1.286)', () => {
  const p = indexed({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'claude\n')
  // Esc fires no Stop; a `!` line then makes Claude answer in the same turn, and Stop ends it.
  writeFileSync(join(p.root, 'b.txt'), 'mine\n')
  writeFileSync(join(p.root, 'c.txt'), 'mine\n')
  utimesSync(join(p.root, 'b.txt'), later(), later())
  utimesSync(join(p.root, 'c.txt'), later(), later())
  const stop = onStop({ home: p.home, input: hookInput('Stop', p.root, { last_assistant_message: '<receipt>Edited a | files: a.txt</receipt>' }) })
  assert.equal(stop.systemMessage, 'turnslip · Edited a · 1 file · /turnslip:undo') // no "not mentioned: b.txt, c.txt"
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'mine\n')
  assert.equal(readFileSync(join(p.root, 'c.txt'), 'utf8'), 'mine\n')
})

test('a Stop turn keeps a change made before its last event, a shell change included', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  writeFileSync(join(p.root, 'a.txt'), 'shell\n')
  utimesSync(join(p.root, 'a.txt'), later(), later()) // the command ran long: its write is late...
  onPostToolUse({ home: p.home, input: hookInput('PostToolUse', p.root, { tool_name: 'Bash', tool_input: { command: 'make' } }) })
  // ...but its PostToolUse comes later still; stand in for that with an event stamped after the write.
  const pdir = projectDir(p.home, p.root)
  const id = readdirSync(join(pdir, 'turns')).sort().at(-1)
  writeFileSync(join(pdir, 'turns', id, 'events.jsonl'), JSON.stringify({ tool: 'Bash', at: later() * 1000, command: 'make' }) + '\n')
  const stop = onStop({ home: p.home, input: hookInput('Stop', p.root, { last_assistant_message: '<receipt>Built | files: a.txt</receipt>' }) })
  assert.equal(stop.systemMessage, 'turnslip · Built · 1 file · /turnslip:undo')
})

test('activityCutoff is the last event plus 2 s, the start without events, and off for untimed events', () => {
  const turn = { startedAt: new Date(10_000).toISOString() }
  assert.equal(activityCutoff(turn, []), 12_000)
  assert.equal(activityCutoff(turn, [{ at: 15_000 }, { at: 13_000 }]), 17_000)
  assert.equal(activityCutoff(turn, [{ at: 15_000 }, { tool: 'Bash' }]), null) // written before the upgrade
})

test('undoing an older turn keeps a file a later turn changed and restores the rest (review focus 4)', () => {
  const p = indexed({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  agentTurn(p, () => { writeFileSync(join(p.root, 'a.txt'), 'a1\n'); writeFileSync(join(p.root, 'b.txt'), 'b1\n') })
  agentTurn(p, () => writeFileSync(join(p.root, 'b.txt'), 'b2\n'))
  const older = listHistory(projectDir(p.home, p.root))[1]
  const out = undoTurn({ home: p.home, root: p.root, turn: older })
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'b2\n')
  assert.match(out, /^turnslip · undid "Did things" \(just now\) · restored 1 file, removed 0 · kept 1 file changed since: b\.txt$/)
})

test('the result line carries how long ago the undone turn ran', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'x\n'))
  const turn = listHistory(projectDir(p.home, p.root))[0]
  const out = undoTurn({ home: p.home, root: p.root, turn, now: Date.parse(turn.startedAt) + 5 * 60_000 })
  assert.match(out, /^turnslip · undid "Did things" \(5 min ago\) · /)
})

test('the undo record keeps the session that ran it, and undo 1 then redoes', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'a.txt'), 'x\n'))
  undoLatest({ ...p, sessionId: 'sess-9' })
  const pdir = projectDir(p.home, p.root)
  const [record] = listHistory(pdir)
  assert.equal(record.kind, 'undo')
  assert.equal(record.sessionId, 'sess-9')
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'x\n')
  assert.equal('sessionId' in listHistory(pdir)[0], false) // none given, none stored
})

test('undo names a turn as history does: no sentence, interrupted, and a long sentence cut (final review)', () => {
  const p = indexed({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  writeFileSync(join(p.root, 'a.txt'), 'x\n') // Esc: no Stop, so no sentence
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  agentTurn(p, () => writeFileSync(join(p.root, 'b.txt'), 'y\n'))
  const pdir = projectDir(p.home, p.root)
  const interrupted = listHistory(pdir)[1]
  assert.match(undoTurn({ home: p.home, root: p.root, turn: interrupted }), /^turnslip · undid "Claude gave no summary \(interrupted\)" \(just now\) · /)
  assert.equal(listHistory(pdir)[0].slip.sentence, 'Undid: Claude gave no summary (interrupted)')
  const long = { ...listHistory(pdir)[1], slip: { sentence: `${'w'.repeat(150)}\r\nend` } }
  assert.match(undoTurn({ home: p.home, root: p.root, turn: long }), new RegExp(`^turnslip · undid "${'w'.repeat(120)}" \\(just now\\) · restored 1 file`))
})

test('an interrupted turn is finished even when the next prompt comes from an untracked folder (NEXT §6)', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'claude\n') // then Esc: no Stop
  // The next prompt arrives from the home directory, which turnslip never tracks (nor snapshots).
  assert.equal(onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', homedir()) }), null)
  const [turn] = listHistory(projectDir(p.home, p.root))
  assert.equal(turn.interrupted, true)
  assert.deepEqual(turn.changes.map((c) => c.path), ['a.txt'])
  // A tool run in the untracked folder must not land in the finished turn's events.
  const events = join(projectDir(p.home, p.root), 'turns', turn.id, 'events.jsonl')
  const before = readFileSync(events, 'utf8')
  onPostToolUse({ home: p.home, input: hookInput('PostToolUse', homedir(), { tool_name: 'Bash', tool_input: { command: 'echo hi' } }) })
  assert.equal(readFileSync(events, 'utf8'), before)
  assert.match(undoLatest(p), /^turnslip · undid /)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
})

test('a turn still open when the session ends is finished then, and the pointer goes (NEXT §6)', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'claude\n') // then /exit mid-turn: no Stop
  assert.equal(onSessionEnd({ home: p.home, input: hookInput('SessionEnd', p.root, { reason: 'prompt_input_exit' }) }), null)
  const [turn] = listHistory(projectDir(p.home, p.root))
  assert.equal(turn.interrupted, true)
  assert.deepEqual(turn.changes.map((c) => c.path), ['a.txt'])
  assert.equal(getCurrent(p.home, 'sess-1'), null)
  assert.equal(onSessionEnd({ home: p.home, input: hookInput('SessionEnd', p.root) }), null) // nothing open: a no-op
})

test('SessionEnd stays light when the end snapshot would not fit its window', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'claude\n')
  onSessionEnd({ home: p.home, input: hookInput('SessionEnd', p.root), budgetMs: 0 })
  const [turn] = listHistory(projectDir(p.home, p.root))
  assert.equal(turn.light, true)
  assert.deepEqual(turn.changes.map((c) => c.path), ['a.txt'])
})

// NEXT §6: another plugin's Stop hook blocks, Claude carries on in the same turn, and Stop fires again
// (stop_hook_active). turnslip opens a continuation at each Stop so that carry-on work is tracked.
const stopWith = (p, receipt, extra = {}) => onStop({ home: p.home, input: hookInput('Stop', p.root, { last_assistant_message: receipt, ...extra }) })
const turnIds = (p) => readdirSync(join(projectDir(p.home, p.root), 'turns'))

test('work done after another plugin blocks Stop gets its own slip and undo', () => {
  const p = indexed({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'A\n')
  assert.match(stopWith(p, '<receipt>Changed a | files: a.txt</receipt>').systemMessage, /^turnslip · Changed a · 1 file/)
  claudeEdits(p, 'b.txt', 'B\n') // the other plugin blocked: Claude carries on
  const second = stopWith(p, '<receipt>Changed b | files: b.txt</receipt>', { stop_hook_active: true })
  assert.match(second.systemMessage, /^turnslip · Changed b · 1 file · \/turnslip:undo$/)
  const history = listHistory(projectDir(p.home, p.root))
  assert.deepEqual(history.map((t) => t.changes.map((c) => c.path)), [['b.txt'], ['a.txt']])
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'b.txt'), 'utf8'), 'b\n')
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'A\n')
})

test('an unused continuation is dropped at the next prompt and never takes the user\'s own edits', () => {
  const p = indexed({ 'a.txt': 'a\n', 'c.txt': 'c\n', 'd.txt': 'd\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'A\n')
  stopWith(p, '<receipt>Changed a | files: a.txt</receipt>')
  writeFileSync(join(p.root, 'c.txt'), 'mine\n') // the user, between turns
  rmSync(join(p.root, 'd.txt'))
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  const history = listHistory(projectDir(p.home, p.root))
  assert.deepEqual(history.map((t) => t.changes.map((c) => c.path)), [['a.txt']])
  assert.equal(turnIds(p).length, 2) // the first turn and the new one; the continuation is gone
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'a.txt'), 'utf8'), 'a\n')
  assert.equal(readFileSync(join(p.root, 'c.txt'), 'utf8'), 'mine\n')
  assert.equal(existsSync(join(p.root, 'd.txt')), false)
})

test('a second Stop with nothing done in between prints nothing and records nothing', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'A\n')
  stopWith(p, '<receipt>Changed a | files: a.txt</receipt>')
  const before = turnIds(p).sort()
  assert.equal(stopWith(p, '<receipt>Nothing more | files: none</receipt>', { stop_hook_active: true }), null)
  assert.deepEqual(turnIds(p).sort(), before)
  assert.equal(listHistory(projectDir(p.home, p.root)).length, 1)
})

test('SessionEnd drops an unused continuation', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  claudeEdits(p, 'a.txt', 'A\n')
  stopWith(p, '<receipt>Changed a | files: a.txt</receipt>')
  onSessionEnd({ home: p.home, input: hookInput('SessionEnd', p.root) })
  assert.equal(turnIds(p).length, 1)
  assert.equal(getCurrent(p.home, 'sess-1'), null)
})

test('a file un-ignored by a .gitignore edit mid-turn is not reported as added (NEXT §6)', () => {
  const p = indexed({ '.gitignore': 'local.cfg\n', 'local.cfg': 'x=1\n', 'a.txt': 'a\n' })
  agentTurn(p, () => {
    writeFileSync(join(p.root, '.gitignore'), '') // un-ignores local.cfg, which was there all along
    writeFileSync(join(p.root, 'new.txt'), 'n\n') // a file the turn really added
  })
  const [turn] = listHistory(projectDir(p.home, p.root))
  assert.deepEqual(turn.changes.map((c) => `${c.status} ${c.path}`), ['modified .gitignore', 'added new.txt'])
  undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'local.cfg'), 'utf8'), 'x=1\n')
  assert.equal(existsSync(join(p.root, 'new.txt')), false)
})

test('the start-of-turn rules come from nested .gitignore files too', () => {
  const p = indexed({ 'web/.gitignore': 'dist/\n', 'web/dist/b.js': 'b\n' })
  agentTurn(p, () => writeFileSync(join(p.root, 'web', '.gitignore'), ''))
  const [turn] = listHistory(projectDir(p.home, p.root))
  assert.deepEqual(turn.changes.map((c) => `${c.status} ${c.path}`), ['modified web/.gitignore'])
})

// A rename keeps the file's creation time, so the birth check alone keeps the new name and undo leaves two
// copies (captured 2026-10-07, docs/spikes/2026-10-07-what-rewind-misses.md). A path the turn added whose
// content is exactly what undo writes back to a deleted path is that file moved: removing it loses nothing.
test('undo of a rename puts the file back under its old name and removes the new one', async () => {
  const p = indexed({ 'src/config.js': 'export const PORT = 3000\n', 'a.txt': 'a\n' })
  await sleep(2300)
  agentTurn(p, () => renameSync(join(p.root, 'src/config.js'), join(p.root, 'src/settings.js')))
  const out = undoLatest(p)
  assert.equal(readFileSync(join(p.root, 'src/config.js'), 'utf8'), 'export const PORT = 3000\n')
  assert.ok(!existsSync(join(p.root, 'src/settings.js')), 'the new name is still there')
  assert.match(out, /^turnslip · undid "Did things" \(just now\) · restored 1 file, removed 1$/)
})

test('an older added file is removed only when undo writes its exact content back elsewhere', () => {
  const turn = (changes) => ({ startedAt: new Date().toISOString(), changes, flags: [] })
  const old = () => 1 // born long before the turn
  // Different content: not a move, kept as before.
  const other = planUndo({ turn: turn([{ path: 'a.js', status: 'deleted', before: 'h1', after: null }, { path: 'b.js', status: 'added', before: null, after: 'h2' }]),
    currentHash: (q) => (q === 'b.js' ? 'h2' : null), birthtimeOf: old })
  assert.deepEqual(other.noEarlierCopy, ['b.js'])
  assert.deepEqual(other.remove, [])
  // Same content, but the old path was recreated since: undo does not write it back, so the copy stays.
  const conflict = planUndo({ turn: turn([{ path: 'a.js', status: 'deleted', before: 'h1', after: null }, { path: 'b.js', status: 'added', before: null, after: 'h1' }]),
    currentHash: (q) => (q === 'b.js' ? 'h1' : 'mine'), birthtimeOf: old })
  assert.deepEqual(conflict.noEarlierCopy, ['b.js'])
  assert.deepEqual(conflict.conflicts, ['a.js'])
  // Same content and the old path is restored: a move, so the new name goes.
  const moved = planUndo({ turn: turn([{ path: 'a.js', status: 'deleted', before: 'h1', after: null }, { path: 'b.js', status: 'added', before: null, after: 'h1' }]),
    currentHash: (q) => (q === 'b.js' ? 'h1' : null), birthtimeOf: old })
  assert.deepEqual(moved.remove, ['b.js'])
  assert.deepEqual(moved.noEarlierCopy, [])
})
