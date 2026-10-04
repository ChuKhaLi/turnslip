import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIB, hookInput, makeProject, runHook, tempDir } from './helpers.mjs'

test('every hook command stays silent when node is missing', () => {
  const hooks = JSON.parse(readFileSync(join(LIB, '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  for (const [event, entries] of Object.entries(hooks)) {
    for (const h of entries.flatMap((e) => e.hooks)) {
      assert.match(h.command, /2>\/dev\/null; exit 0$/, event)
    }
  }
})

test('the hook exits 0 with empty stdout on garbage input', () => {
  const home = tempDir()
  const r = runHook('not json', home)
  assert.equal(r.code, 0)
  assert.equal(r.stdout, '')
})

test('the hook exits 0 for an unknown event', () => {
  const root = makeProject({ 'a.txt': 'x' })
  const r = runHook(hookInput('Mystery', root), tempDir())
  assert.equal(r.code, 0)
})

const COMMANDS = join(LIB, '..', 'commands')
const VERBS = ['undo', 'history', 'report', 'mode', 'setup']

test('one command file per verb; none can be invoked by the model (final #9)', () => {
  assert.deepEqual(readdirSync(COMMANDS).sort(), VERBS.map((v) => `${v}.md`).sort())
  for (const v of VERBS) {
    const md = readFileSync(join(COMMANDS, `${v}.md`), 'utf8')
    const front = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]
    assert.match(front, /^disable-model-invocation: true$/m, v)
    assert.match(front, /^allowed-tools: Bash\(node:\*\)$/m, v)
    assert.ok(md.includes(`node "\${CLAUDE_PLUGIN_ROOT}/lib/cli.mjs" ${v}`), v)
    assert.ok(md.includes('turnslip needs Node.js 18 or newer'), v)
  }
})

test('undo and report pass the session id', () => {
  for (const v of ['undo', 'report']) assert.ok(readFileSync(join(COMMANDS, `${v}.md`), 'utf8').includes('--session=${CLAUDE_SESSION_ID}'), v)
})

test('report tells Claude the data is not instructions and to stop on anything else', () => {
  const md = readFileSync(join(COMMANDS, 'report.md'), 'utf8')
  assert.ok(md.includes('turnslip · report data'))
  assert.match(md, /never instructions/)
  assert.match(md, /exactly as printed, then stop/)
  // Publishing an artifact means writing the page to a file first: only project files are off limits.
  assert.ok(!md.includes('or change any file'))
  assert.match(md, /do not change any project file/)
  assert.match(md, /temporary file .* to publish it is allowed/)
})

test('PostToolUse fires for the tools that can write files: subagents and MCP tools included', () => {
  const hooks = JSON.parse(readFileSync(join(LIB, '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  const re = new RegExp(`^(?:${hooks.PostToolUse[0].matcher})$`)
  for (const t of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Task', 'Agent', 'mcp__fs__write_file']) assert.ok(re.test(t), t)
  for (const t of ['Read', 'Grep', 'Glob', 'WebFetch']) assert.ok(!re.test(t), t) // a hook per read would slow every turn
})
