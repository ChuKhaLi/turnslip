import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIB, hookInput, makeProject, runHook, tempDir } from './helpers.mjs'

// Every hook but MessageDisplay keeps the shell wrapper, so a machine without Node stays silent (spec §10).
// MessageDisplay runs node in exec form, no shell (spike 2026-10-07-exec-form-hooks): the plugin directory's
// validator blocked its old shell filter (`d=$(cat)`), and Claude Code shows nothing when an exec-form
// MessageDisplay hook finds no node, so silence holds there too (owner, 2026-10-07).
test('every hook stays silent when node is missing; MessageDisplay runs in exec form', () => {
  const hooks = JSON.parse(readFileSync(join(LIB, '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  for (const [event, entries] of Object.entries(hooks)) {
    for (const h of entries.flatMap((e) => e.hooks)) {
      if (event === 'MessageDisplay') {
        assert.equal(h.command, 'node', event)
        assert.deepEqual(h.args, ['${CLAUDE_PLUGIN_ROOT}/lib/display.mjs'], event)
      } else {
        assert.equal(h.args, undefined, event)
        assert.equal(h.command, 'node "${CLAUDE_PLUGIN_ROOT}/lib/hook.mjs" 2>/dev/null; exit 0', event)
      }
    }
  }
})

test('the exec-form MessageDisplay hook, spawned as Claude Code spawns it, exits 0 and prints nothing on garbage input', () => {
  const h = JSON.parse(readFileSync(join(LIB, '..', 'hooks', 'hooks.json'), 'utf8')).hooks.MessageDisplay[0].hooks[0]
  const args = h.args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', join(LIB, '..')))
  const r = spawnSync(process.execPath, args, { input: 'not json', encoding: 'utf8', env: { ...process.env, TURNSLIP_HOME: tempDir() } })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
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
    // Only the plugin's own CLI, not any node command (directory hold ALLOWED_TOOLS_BROAD); this rule
    // still matches the `… || echo "…"` line without a prompt (spike 2026-10-07, finding 6).
    assert.match(front, /^allowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/lib\/cli\.mjs":\*\)$/m, v)
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

// The plugin directory's listing reads these four from plugin.json only, each an https URL; Claude Code
// ignores them (manifest reference, "Directory listing fields"). Each one on turnslip.dev must exist.
test('plugin.json names the listing links, each a live page of the site or the plugin README', () => {
  const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(plugin.privacyPolicyUrl, 'https://turnslip.dev/privacy')
  assert.equal(plugin.termsOfServiceUrl, 'https://turnslip.dev/terms')
  assert.equal(plugin.supportUrl, 'https://turnslip.dev/#support')
  assert.equal(plugin.documentationUrl, 'https://github.com/ChuKhaLi/turnslip/blob/main/plugin/README.md')
  const site = join(PLUGIN, '..', 'site')
  for (const p of ['privacy', 'terms']) assert.ok(readFileSync(join(site, `${p}.html`), 'utf8').length > 0, p)
  const home = readFileSync(join(site, 'index.html'), 'utf8')
  const support = home.match(/<h3 id="support">[\s\S]*?<\/p>/)?.[0] ?? ''
  assert.match(support, /mailto:support@turnslip\.dev/)
  assert.ok(readFileSync(join(PLUGIN, 'README.md'), 'utf8').includes('/turnslip:undo'))
  assert.equal(JSON.parse(readFileSync(join(PLUGIN, '..', '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].supportUrl, undefined)
})
