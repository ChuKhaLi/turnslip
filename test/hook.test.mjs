import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectDir } from '../plugin/lib/paths.mjs'
import { MAX_FILE_BYTES, snapshot, writeJson } from '../plugin/lib/store.mjs'
import { hookInput, makeProject, runHook, tempDir } from './helpers.mjs'

// A project whose index already exists, so turns run in full mode.
function indexed(files) {
  const home = tempDir()
  const root = makeProject(files)
  writeJson(join(projectDir(home, root), 'index.json'), snapshot({ home, root }).index)
  return { home, root }
}

function turn({ home, root }, act, reply, session = 'sess-1') {
  const start = runHook(hookInput('UserPromptSubmit', root, { session_id: session, prompt: 'x' }), home)
  act()
  return { start, stop: runHook(hookInput('Stop', root, { session_id: session, stop_hook_active: false, last_assistant_message: reply }), home) }
}

test('UserPromptSubmit injects the receipt instruction', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  const { start } = turn(p, () => {}, '')
  assert.equal(start.code, 0)
  assert.match(start.json.hookSpecificOutput.additionalContext, /<receipt>/)
})

test('a shell-made change is caught and an unmentioned file is named', () => {
  const p = indexed({ 'app.js': 'console.log(1)\n' })
  const { stop } = turn(p, () => {
    writeFileSync(join(p.root, 'app.js'), 'console.log(2)\n')
    writeFileSync(join(p.root, 'notes.txt'), 'todo\n')
  }, 'Done.\n<receipt>Changed the log | files: app.js</receipt>')
  assert.equal(stop.code, 0)
  assert.equal(stop.json.systemMessage, 'turnslip · Changed the log · 2 files · not mentioned: notes.txt · /turnslip:undo')
})

test('a secret added through a shell write is flagged', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  const { stop } = turn(p, () => writeFileSync(join(p.root, '.env'), 'API_KEY=sk-test-1234567890abcdef\n'), '<receipt>Added env | files: .env</receipt>')
  assert.match(stop.json.systemMessage, /🔑 key added in \.env/)
})

test('a turn that changed nothing prints nothing', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  const { stop } = turn(p, () => {}, '<receipt>Answered | files: none</receipt>')
  assert.equal(stop.stdout, '')
})

test('Review Focus 1: the home directory is never snapshotted', () => {
  const home = tempDir()
  const r = runHook(hookInput('UserPromptSubmit', homedir()), home)
  assert.equal(r.code, 0)
  assert.equal(r.stdout, '')
})

test('Review Focus 2: two sessions in one project each see only their own turn', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  runHook(hookInput('UserPromptSubmit', p.root, { session_id: 'A' }), p.home)
  writeFileSync(join(p.root, 'fromA.txt'), 'a\n')
  runHook(hookInput('UserPromptSubmit', p.root, { session_id: 'B' }), p.home)
  writeFileSync(join(p.root, 'fromB.txt'), 'b\n')
  const a = runHook(hookInput('Stop', p.root, { session_id: 'A', last_assistant_message: '<receipt>x | files: fromA.txt, fromB.txt</receipt>' }), p.home)
  const b = runHook(hookInput('Stop', p.root, { session_id: 'B', last_assistant_message: '<receipt>x | files: fromB.txt</receipt>' }), p.home)
  assert.match(a.json.systemMessage, /2 files/) // A's window saw both writes: filesystem truth
  assert.match(b.json.systemMessage, /1 file ·/)  // B started after fromA.txt existed
})

test('Review Focus 5: Stop and PostToolUse with no started turn are silent', () => {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a' })
  assert.equal(runHook(hookInput('Stop', root, { last_assistant_message: '' }), home).stdout, '')
  assert.equal(runHook(hookInput('PostToolUse', root, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} }), home).code, 0)
  // a dropped null-pointer guard would throw into the catch and leave a log entry
  assert.equal(existsSync(join(home, 'log')), false)
})

test('PostToolUse records Edit pre-images and Bash commands', () => {
  const p = indexed({ 'a.txt': 'old\n' })
  runHook(hookInput('UserPromptSubmit', p.root), p.home)
  writeFileSync(join(p.root, 'a.txt'), 'new\n')
  runHook(hookInput('PostToolUse', p.root, { tool_name: 'Edit', tool_input: { file_path: join(p.root, 'a.txt') }, tool_response: { filePath: join(p.root, 'a.txt'), originalFile: 'old\n' } }), p.home)
  runHook(hookInput('PostToolUse', p.root, { tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { stdout: '' } }), p.home)
  const stop = runHook(hookInput('Stop', p.root, { last_assistant_message: '<receipt>Edited | files: a.txt</receipt>' }), p.home)
  assert.equal(stop.json.systemMessage, 'turnslip · Edited · 1 file · 🚀 pushed or deployed · /turnslip:undo')
})

test('a corrupt store never breaks the hook', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  writeFileSync(join(projectDir(p.home, p.root), 'index.json'), '{not json')
  const { start, stop } = turn(p, () => writeFileSync(join(p.root, 'b.txt'), 'b'), '')
  assert.equal(start.code, 0)
  assert.equal(stop.code, 0)
})

function lightTurn(files, act, events, reply) {
  const home = tempDir()
  const root = makeProject(files)
  runHook(hookInput('UserPromptSubmit', root), home) // no index: light mode
  act(root)
  for (const e of events(root)) runHook(hookInput('PostToolUse', root, e), home)
  return { home, root, stop: runHook(hookInput('Stop', root, { last_assistant_message: reply }), home) }
}

test('a tool edit outside the project is flagged, not reported as a deleted file', () => {
  const other = join(tempDir(), 'x.txt')
  writeFileSync(other, 'x\n')
  const { stop } = lightTurn({ 'a.txt': 'a\n' }, () => {}, () => [{ tool: 'Edit', tool_input: { file_path: other }, tool_response: { filePath: other, originalFile: 'y\n' } }], '<receipt>Edited | files: none</receipt>')
  assert.match(stop.json.systemMessage, /outside the project|⚠/)
  assert.doesNotMatch(stop.json.systemMessage, /deleted|🗑/)
})

test('a root file named like ..env.bak is not treated as outside', () => {
  const { stop } = lightTurn({ '..env.bak': 'a\n' }, (root) => writeFileSync(join(root, '..env.bak'), 'b\n'),
    (root) => [{ tool: 'Edit', tool_input: { file_path: join(root, '..env.bak') }, tool_response: { filePath: join(root, '..env.bak'), originalFile: 'a\n' } }], '<receipt>Edited | files: ..env.bak</receipt>')
  assert.doesNotMatch(stop.json.systemMessage, /outside|⚠/)
  assert.match(stop.json.systemMessage, /1 file/)
})

test('a corrupt index runs the turn light and the shell-made file is not attributed', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  writeFileSync(join(projectDir(p.home, p.root), 'index.json'), '{not json')
  const { stop } = turn(p, () => writeFileSync(join(p.root, 'b.txt'), 'b'), '')
  assert.equal(stop.stdout, '')
  const tdir = join(projectDir(p.home, p.root), 'turns')
  // The continuation opened at Stop (for work after a blocked Stop) is not a turn of its own yet.
  const saved = readdirSync(tdir).map((d) => JSON.parse(readFileSync(join(tdir, d, 'turn.json'), 'utf8'))).filter((t) => t.kind !== 'continuation')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].light, true)
})

test('an Edit with no original text never reads as an added secret', () => {
  const { stop } = lightTurn({ '.env': 'API_KEY=sk-test-1234567890abcdef\n' }, () => {},
    (root) => [{ tool: 'Edit', tool_input: { file_path: join(root, '.env') }, tool_response: { filePath: join(root, '.env') } }], '<receipt>Edited env | files: .env</receipt>')
  assert.match(stop.json.systemMessage, /1 file/)
  assert.doesNotMatch(stop.json.systemMessage, /🔑/)
})

// path.relative across drive letters is string math, so no second drive is needed.
test('a tool edit on another drive is flagged outside, not reported as deleted', { skip: process.platform !== 'win32' }, () => {
  const drive = tmpdir()[0].toUpperCase() === 'Z' ? 'Y' : 'Z'
  const other = `${drive}:\\nonexistent\\a.txt`
  const r = lightTurn({ 'a.txt': 'a\n' }, () => {}, () => [{ tool: 'Edit', tool_input: { file_path: other }, tool_response: { filePath: other, originalFile: 'y\n' } }], '<receipt>Edited | files: none</receipt>')
  assert.match(r.stop.json.systemMessage, /outside the project|⚠/)
  assert.doesNotMatch(r.stop.json.systemMessage, /deleted|🗑/)
})

test('a turn that newly ignores dist/ reports no deletion of dist files (final #4)', () => {
  const p = indexed({ '.gitignore': '', 'dist/out.js': 'x\n', 'a.txt': 'a\n' })
  const { stop } = turn(p, () => writeFileSync(join(p.root, '.gitignore'), 'dist/\n'), '<receipt>Ignored dist | files: .gitignore</receipt>')
  assert.equal(stop.json.systemMessage, 'turnslip · Ignored dist · 1 file · /turnslip:undo')
})

test('a file that grew past MAX_FILE_BYTES is not reported deleted (final #5)', () => {
  const p = indexed({ 'data.csv': 'a,b\n', 'a.txt': 'a\n' })
  const { stop } = turn(p, () => writeFileSync(join(p.root, 'data.csv'), Buffer.alloc(MAX_FILE_BYTES + 1, 0x41)), '<receipt>Grew data | files: data.csv</receipt>')
  assert.equal(stop.stdout, '')
})

test('a finished turn saves no start or end manifest (final #8)', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  turn(p, () => writeFileSync(join(p.root, 'a.txt'), 'b\n'), '<receipt>Edited | files: a.txt</receipt>')
  const tdir = join(projectDir(p.home, p.root), 'turns')
  const [saved] = readdirSync(tdir).map((d) => JSON.parse(readFileSync(join(tdir, d, 'turn.json'), 'utf8')))
  assert.equal(saved.finished, true)
  assert.equal('start' in saved, false)
  assert.equal('end' in saved, false)
  assert.equal(saved.changes.length, 1)
})

// Spec §11: an unwritable home and a missing project directory never break Claude Code.
const EVENTS = {
  SessionStart: { source: 'startup' },
  UserPromptSubmit: { prompt: 'x' },
  PostToolUse: { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} },
  Stop: { stop_hook_active: false, last_assistant_message: '<receipt>x | files: none</receipt>' },
  SessionEnd: { reason: 'prompt_input_exit' },
}

test('every event exits 0 with empty stdout when the home cannot be written (final #10)', () => {
  const file = join(tempDir(), 'blocker')
  writeFileSync(file, 'not a directory')
  const home = join(file, 'home')
  const root = makeProject({ 'a.txt': 'a\n' })
  for (const [event, extra] of Object.entries(EVENTS)) {
    const r = runHook(hookInput(event, root, extra), home)
    assert.equal(r.code, 0, event)
    assert.equal(r.stdout, '', event)
  }
})

test('every event exits 0 with empty stdout when the project directory is gone (final #10)', () => {
  const home = tempDir()
  const root = join(tempDir(), 'gone')
  for (const [event, extra] of Object.entries(EVENTS)) {
    const r = runHook(hookInput(event, root, extra), home)
    assert.equal(r.code, 0, event)
    assert.equal(r.stdout, '', event)
  }
  assert.equal(existsSync(join(home, 'projects')), false)
})

test('a tool that names no file still stamps the turn, so its late writes are not cut off', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  runHook(hookInput('UserPromptSubmit', p.root), p.home)
  for (const tool_name of ['mcp__fs__write_file', 'Task', 'Agent']) runHook(hookInput('PostToolUse', p.root, { tool_name, tool_input: {}, tool_response: {} }), p.home)
  const pdir = projectDir(p.home, p.root)
  const id = readdirSync(join(pdir, 'turns')).sort().at(-1)
  const events = readFileSync(join(pdir, 'turns', id, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(events.map((e) => e.tool), ['mcp__fs__write_file', 'Task', 'Agent'])
  assert.ok(events.every((e) => Number.isFinite(e.at) && !('path' in e)))
})

test('SessionEnd, run as the hook process, finishes an open turn and prints nothing', () => {
  const p = indexed({ 'a.txt': 'old\n' })
  runHook(hookInput('UserPromptSubmit', p.root), p.home)
  writeFileSync(join(p.root, 'a.txt'), 'new\n')
  runHook(hookInput('PostToolUse', p.root, { tool_name: 'Edit', tool_input: { file_path: join(p.root, 'a.txt') }, tool_response: { filePath: join(p.root, 'a.txt'), originalFile: 'old\n' } }), p.home)
  const r = runHook(hookInput('SessionEnd', p.root, { reason: 'prompt_input_exit' }), p.home)
  assert.equal(r.code, 0)
  assert.equal(r.stdout, '')
  const pdir = projectDir(p.home, p.root)
  const turns = readdirSync(join(pdir, 'turns')).map((id) => JSON.parse(readFileSync(join(pdir, 'turns', id, 'turn.json'), 'utf8')))
  assert.deepEqual(turns.map((t) => [t.finished, t.interrupted, t.changes.map((c) => c.path)]), [[true, true, ['a.txt']]])
})

// Claude Code 2.1.288 on Windows runs shell commands with a PowerShell tool (captured, release item 4).
test('a PowerShell command is recorded like a Bash one and read by the command rules', () => {
  const p = indexed({ 'a.txt': 'a\n' })
  runHook(hookInput('UserPromptSubmit', p.root), p.home)
  writeFileSync(join(p.root, 'b.txt'), 'b\n')
  runHook(hookInput('PostToolUse', p.root, { tool_name: 'PowerShell', tool_input: { command: 'npm install left-pad', description: 'x' }, tool_response: {} }), p.home)
  const stop = runHook(hookInput('Stop', p.root, { last_assistant_message: '<receipt>Installed | files: b.txt</receipt>' }), p.home)
  assert.equal(stop.json.systemMessage, 'turnslip · Installed · 1 file · 📦 packages changed · /turnslip:undo')
})
