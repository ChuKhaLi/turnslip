import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { hideReceipt, parseReceipt } from '../plugin/lib/receipt.mjs'
import { LIB, tempDir } from './helpers.mjs'

const RECEIPT = '<receipt>Added a login page | files: src/login.tsx</receipt>'

test('hideReceipt drops the lines Stop parses as a receipt, and only those', () => {
  assert.equal(hideReceipt(`Done.\n${RECEIPT}`), 'Done.')
  assert.equal(hideReceipt(`Done.\n\n${RECEIPT}\n`), 'Done.\n')
  assert.equal(hideReceipt(RECEIPT), '')
  assert.equal(hideReceipt(`**${RECEIPT}**`), '')
  // A mention inside prose is no receipt line: Stop does not parse it, so the screen keeps it.
  const prose = 'The hook asks for a <receipt>…</receipt> line at the end.\n'
  assert.equal(hideReceipt(prose), null)
  assert.equal(parseReceipt(prose), null)
  assert.equal(hideReceipt('alpha line\n'), null)
})

// Captured on 2.1.289 (spike §16): one call per batch of finished lines, the last with final: true.
function display(delta, extra = {}) {
  const input = { session_id: 's', transcript_path: 't', cwd: '.', hook_event_name: 'MessageDisplay', turn_id: 't1', message_id: 'm1', index: 2, final: true, delta, ...extra }
  return spawnSync(process.execPath, [join(LIB, 'display.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, TURNSLIP_HOME: tempDir() } })
}

test('display.mjs answers a batch holding a receipt with the batch minus that line', () => {
  const r = display(`beta line\n${RECEIPT}`)
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: 'beta line' } })
})

test('display.mjs prints nothing for a batch without a receipt, other events or bad input', () => {
  for (const r of [display('alpha line\n'), display(RECEIPT, { hook_event_name: 'Stop' })]) {
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
  const bad = spawnSync(process.execPath, [join(LIB, 'display.mjs')], { input: 'not json', encoding: 'utf8' })
  assert.equal(bad.status, 0)
  assert.equal(bad.stdout, '')
})

test('display.mjs loads nothing but receipt.mjs: it runs once per batch of every reply', () => {
  const src = readFileSync(join(LIB, 'display.mjs'), 'utf8')
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(imports, ['./receipt.mjs', 'node:fs'])
})

test('hooks.json sends MessageDisplay to display.mjs', () => {
  const hooks = JSON.parse(readFileSync(join(LIB, '..', 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.match(hooks.MessageDisplay[0].hooks[0].command, /\| node "\$\{CLAUDE_PLUGIN_ROOT\}\/lib\/display\.mjs";; esac 2>\/dev\/null; exit 0$/)
})

// The hooks.json command itself, run as Claude Code runs it (sh on some systems, bash on others):
// node starts only for a batch that may hold a receipt (spike §16: 82 ms a call with node, 16 without).
const PLUGIN = join(LIB, '..')
function viaHooksJson(shell, delta, path) {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks
  const input = JSON.stringify({ hook_event_name: 'MessageDisplay', session_id: 's', cwd: '.', turn_id: 't', message_id: 'm', index: 0, final: true, delta })
  return spawnSync(shell, ['-c', hooks.MessageDisplay[0].hooks[0].command], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, ...(path && { PATH: path }) } })
}

for (const shell of ['bash', 'sh']) {
  test(`the hooks.json command under ${shell}: hides a receipt, prints nothing otherwise`, () => {
    const hit = viaHooksJson(shell, `done\n${RECEIPT}`)
    assert.equal(hit.status, 0)
    assert.equal(JSON.parse(hit.stdout).hookSpecificOutput.displayContent, 'done')
    const miss = viaHooksJson(shell, 'alpha line\n')
    assert.equal(miss.status, 0)
    assert.equal(miss.stdout, '')
  })

  test(`the hooks.json command under ${shell}: node runs only for a batch naming the receipt tag`, () => {
    const dir = tempDir()
    const marker = join(dir, 'ran').replace(/\\/g, '/')
    writeFileSync(join(dir, 'node'), `#!/bin/sh\ncat > /dev/null\necho x >> "${marker}"\n`)
    chmodSync(join(dir, 'node'), 0o755)
    const path = `${dir}${delimiter}${process.env.PATH}`
    viaHooksJson(shell, 'alpha line\nbeta line\n', path)
    assert.equal(existsSync(marker), false)
    viaHooksJson(shell, RECEIPT, path)
    assert.equal(existsSync(marker), true)
  })
}

test('the hooks.json command stays silent and exits 0 when node is missing', () => {
  const noNode = process.env.PATH.split(delimiter).filter((d) => !['node', 'node.exe'].some((n) => existsSync(join(d, n)))).join(delimiter)
  const r = viaHooksJson('bash', RECEIPT, noNode)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, '')
})
