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
const VERBS = ['undo', 'history', 'report', 'mode', 'setup', 'activate', 'deactivate', 'buy']

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

// Anthropic's plugin directory (claude.ai/directory/manage) rejects a plugin folder without a README
// of 40 words or more outside code, warns on a missing author or marketplace description
// (`claude plugin validate --strict`), and its security scan holds undisclosed network calls.
const PLUGIN = join(LIB, '..')
const words = (md) => md.replace(/```[\s\S]*?```/g, ' ').replace(/^ {4}.*$/gm, ' ').split(/\s+/).filter((w) => /\w/.test(w)).length

test('the plugin folder has a README fit for the plugin directory, disclosing every network call', () => {
  const md = readFileSync(join(PLUGIN, 'README.md'), 'utf8')
  assert.ok(words(md) >= 40, `README has ${words(md)} words outside code`)
  assert.match(md, /^## Network and data$/m)
  for (const s of ['https://live.dodopayments.com/licenses/activate', '/licenses/validate', '/licenses/deactivate',
    'once a week', 'never sends your files', '~/.turnslip', 'FSL-1.1-MIT', 'https://turnslip.dev']) assert.ok(md.includes(s), `README lacks "${s}"`)
})

test('plugin.json and marketplace.json carry what validate --strict asks for', () => {
  const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.deepEqual(plugin.author, { name: 'ChuKhaLi', email: 'support@turnslip.dev', url: 'https://turnslip.dev' })
  assert.equal(plugin.homepage, 'https://turnslip.dev')
  const market = JSON.parse(readFileSync(join(PLUGIN, '..', '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.ok(market.description && market.description.length >= 20, 'marketplace description')
  assert.equal(market.plugins[0].homepage, 'https://turnslip.dev')
})
