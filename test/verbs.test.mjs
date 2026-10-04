import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { onPostToolUse, onStop, onUserPromptSubmit } from '../plugin/lib/hook.mjs'
import { projectDir } from '../plugin/lib/paths.mjs'
import { snapshot, writeJson } from '../plugin/lib/store.mjs'
import { listHistory, listTurnIds, loadTurn } from '../plugin/lib/turns.mjs'
import { run } from '../plugin/lib/verbs.mjs'
import { hookInput, makeProject, tempDir } from './helpers.mjs'

// Two finished turns: the first wrote a.txt, the second b.txt.
function twoTurns() {
  const home = tempDir()
  const root = makeProject({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
  writeJson(join(projectDir(home, root), 'index.json'), snapshot({ home, root }).index)
  for (const f of ['a.txt', 'b.txt']) {
    onUserPromptSubmit({ home, input: hookInput('UserPromptSubmit', root) })
    writeFileSync(join(root, f), 'changed\n')
    onStop({ home, input: hookInput('Stop', root, { last_assistant_message: `<receipt>Changed ${f} | files: ${f}</receipt>` }) })
  }
  return { home, root, read: (f) => readFileSync(join(root, f), 'utf8') }
}
const R = (p, verb, args = [], pro = true) => run({ verb, args, home: p.home, root: p.root, pro })

test('history is Pro; with Pro it lists the turns', () => {
  const p = twoTurns()
  assert.equal(R(p, 'history', [], false), 'History is part of turnslip Pro.')
  const out = R(p, 'history').split('\n')
  assert.equal(out[0], 'turnslip · history (2 of 2)')
  assert.match(out[1], /^1 · just now · Changed b\.txt · 1 file$/)
  assert.match(R(p, 'history', ['1', '--ids']), /^turnslip · history \(1 of 2\)\n1 · .* · id [0-9a-z]+-[0-9a-f]{6}$/)
})

test('history rejects anything but one positive number and --ids', () => {
  const p = twoTurns()
  for (const args of [['abc'], ['0'], ['-1'], ['1', '2'], ['1.5']]) assert.equal(R(p, 'history', args), 'usage: /turnslip:history [n] [--ids]', args.join(' '))
  assert.match(R(p, 'history', ['99']), /^turnslip · history \(2 of 2\)/)
})

test('undo n undoes the n-th turn of history; undo <id> the turn with that id', () => {
  const p = twoTurns()
  assert.match(R(p, 'undo', ['2']), /^turnslip · undid "Changed a\.txt" \(just now\) · restored 1 file/)
  assert.equal(p.read('a.txt'), 'a\n')
  assert.equal(p.read('b.txt'), 'changed\n')
  const id = listHistory(projectDir(p.home, p.root)).find((t) => t.slip?.sentence === 'Changed b.txt').id
  assert.match(R(p, 'undo', [id]), /^turnslip · undid "Changed b\.txt"/)
  assert.equal(p.read('b.txt'), 'b\n')
})

test('a bad undo argument changes nothing (review focus 3)', () => {
  const p = twoTurns()
  for (const arg of ['0', '-1', '3.5', '99', 'zzz']) {
    assert.equal(R(p, 'undo', [arg]), `turnslip · no turn ${arg} in this project · /turnslip:history lists them`)
  }
  assert.equal(p.read('a.txt'), 'changed\n')
  assert.equal(p.read('b.txt'), 'changed\n')
})

test('undo with an argument is Pro; without one it is free', () => {
  const p = twoTurns()
  assert.equal(R(p, 'undo', ['1'], false), 'Undoing an earlier turn is part of turnslip Pro.')
  assert.match(R(p, 'undo', [], false), /^turnslip · undid "Changed b\.txt"/)
})

test('--session is taken out of the arguments and stored on the undo record', () => {
  const p = twoTurns()
  R(p, 'undo', ['--session=sess-7'], false)
  assert.equal(listHistory(projectDir(p.home, p.root))[0].sessionId, 'sess-7')
  // with a number too: the number, not the session, picks the turn (the list is now undo, b, a)
  assert.match(R(p, 'undo', ['--session=sess-8', '3']), /^turnslip · undid "Changed a\.txt"/)
  assert.equal(listHistory(projectDir(p.home, p.root))[0].sessionId, 'sess-8')
})

test('report: Pro gate, a missing or unexpanded session id, then the data (review focus 5)', () => {
  const p = twoTurns()
  assert.equal(R(p, 'report', ['--session=sess-1'], false), 'The session report is part of turnslip Pro.')
  const update = 'turnslip · this Claude Code version does not give the session id; update it'
  assert.equal(R(p, 'report', []), update)
  assert.equal(R(p, 'report', ['--session=']), update)
  assert.equal(R(p, 'report', ['--session=${CLAUDE_SESSION_ID}']), update)
  assert.match(R(p, 'report', ['--session=sess-1']), /^turnslip · report data\n/) // hookInput's session_id is sess-1
})

test('history, report and undo refuse the home directory', () => {
  const p = { home: tempDir(), root: homedir() }
  const refuse = 'turnslip does not track this folder (home directory or drive root).'
  assert.equal(R(p, 'history'), refuse)
  assert.equal(R(p, 'report', ['--session=s']), refuse)
  assert.equal(R(p, 'undo'), refuse)
})

test('an unknown verb prints the usage line', () => {
  assert.match(run({ verb: 'bogus', args: [], home: tempDir(), root: makeProject({}), pro: false }), /^usage: \/turnslip:undo \[n\|id\]/)
})

test('undo takes one argument; an empty one or an id prefix matches no turn (NEXT §7)', () => {
  const p = twoTurns()
  assert.equal(R(p, 'undo', ['2', '3']), 'usage: /turnslip:undo [n|id]')
  assert.equal(R(p, 'undo', ['']), 'turnslip · no turn "" in this project · /turnslip:history lists them')
  const id = listHistory(projectDir(p.home, p.root))[0].id
  assert.equal(R(p, 'undo', [id.slice(0, 8)]), `turnslip · no turn ${id.slice(0, 8)} in this project · /turnslip:history lists them`)
  assert.equal(p.read('a.txt'), 'changed\n')
  assert.equal(p.read('b.txt'), 'changed\n')
})

// Esc fires no Stop, and a slash command's ! line runs before any hook finishes the interrupted turn
// (captured, release item 7): undo finishes the session's open turn itself before choosing.
test('undo right after Esc undoes the interrupted turn, not the one before', () => {
  const p = twoTurns()
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  writeFileSync(join(p.root, 'a.txt'), 'esc\n')
  onPostToolUse({ home: p.home, input: hookInput('PostToolUse', p.root, { tool_name: 'Edit', tool_input: { file_path: join(p.root, 'a.txt') }, tool_response: { filePath: join(p.root, 'a.txt'), originalFile: 'changed\n' } }) })
  const out = R(p, 'undo', ['--session=sess-1'], false)
  assert.match(out, /interrupted/)
  assert.equal(p.read('a.txt'), 'changed\n')
  assert.equal(p.read('b.txt'), 'changed\n')
})

test('undo leaves alone an open turn with no tool events (the prompt that runs undo)', () => {
  const p = twoTurns()
  onUserPromptSubmit({ home: p.home, input: hookInput('UserPromptSubmit', p.root) })
  R(p, 'undo', ['--session=sess-1'], false)
  assert.equal(p.read('b.txt'), 'b\n')
  assert.equal(p.read('a.txt'), 'changed\n')
  const open = listTurnIds(projectDir(p.home, p.root)).map((id) => loadTurn(projectDir(p.home, p.root), id)).filter((t) => !t.finished)
  assert.equal(open.length, 1)
})

// One version: /turnslip:setup prints the one in plugin.json, the one Claude Code updates by.
test('setup prints the version plugin.json names', () => {
  const p = twoTurns()
  const { version } = JSON.parse(readFileSync(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  assert.ok(R(p, 'setup').startsWith(`turnslip ${version} · `))
})
