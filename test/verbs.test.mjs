import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { onPostToolUse, onStop, onUserPromptSubmit } from '../plugin/lib/hook.mjs'
import { projectDir } from '../plugin/lib/paths.mjs'
import { snapshot, writeJson } from '../plugin/lib/store.mjs'
import { listHistory, listTurnIds, loadTurn } from '../plugin/lib/turns.mjs'
import { PRO_HINT, PROMO } from '../plugin/lib/promo.mjs'
import { run, USAGE } from '../plugin/lib/verbs.mjs'
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
const SALE = { businessId: 'bus_ts', productId: 'pdt_ts' }
const R = (p, verb, args = [], pro = true, ids = SALE) => run({ verb, args, home: p.home, root: p.root, pro, ids })
// The gate a free user sees once the trial is spent (spec §6b): tests of the gate itself start there.
const spent = (p) => { writeJson(join(p.home, 'trial.json'), { used: 3 }); return p }
const USED = ' Your 3 trial runs are used.'

test('history is Pro; with Pro it lists the turns', () => {
  const p = spent(twoTurns())
  assert.equal(R(p, 'history', [], false), `History is part of turnslip Pro.${USED}\n${PRO_HINT}`)
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
  const p = spent(twoTurns())
  assert.equal(R(p, 'undo', ['1'], false), `Undoing an earlier turn is part of turnslip Pro.${USED}\n${PRO_HINT}`)
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
  const p = spent(twoTurns())
  assert.equal(R(p, 'report', ['--session=sess-1'], false), `The session report is part of turnslip Pro.${USED}\n${PRO_HINT}`)
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

test('USAGE lists the license verbs', () => {
  assert.ok(USAGE.includes('/turnslip:activate <key>') && USAGE.includes('/turnslip:deactivate') && USAGE.includes('/turnslip:buy'))
})

test('the gate hint names the site and the activate command', () => {
  assert.equal(PRO_HINT, 'Buy with /turnslip:buy (or at turnslip.dev/#pro), then /turnslip:activate <key>')
  const p = twoTurns()
  assert.equal(R(p, 'mode', ['detailed'], false), `Detailed mode is part of turnslip Pro.\n${PRO_HINT}`)
  assert.equal(R(spent(twoTurns()), 'mode', ['detailed'], false), `Detailed mode is part of turnslip Pro.\n${PRO_HINT}`)
})

test('a free undo that undid something carries the prompt once; Pro and empty undos never do', () => {
  const p = twoTurns()
  const first = R(p, 'undo', [], false).split('\n')
  assert.match(first[0], /^turnslip · undid "Changed b\.txt"/)
  assert.equal(first.at(-1), PROMO)
  assert.ok(!R(p, 'undo', [], false).includes(PROMO)) // within the week
  const q = twoTurns()
  assert.ok(!R(q, 'undo', [], true).includes(PROMO))
  assert.ok(!R({ home: tempDir(), root: makeProject({}) }, 'undo', [], false).includes(PROMO)) // nothing to undo
})

test('setup ends with the license state', () => {
  const p = twoTurns()
  assert.match(R(p, 'setup', [], false), / · Free · Pro at turnslip\.dev\/#pro$/)
  writeJson(join(p.home, 'license.json'), { key: 'TS-AAAA-BBBB-WXYZ', instanceId: 'lki_1', status: 'active', lastOk: Date.now() - 3 * 86_400_000, lastCheck: Date.now() })
  assert.match(R(p, 'setup', [], true), / · Pro \(key …WXYZ, checked 3 d ago\)$/)
  writeJson(join(p.home, 'license.json'), { key: 'TS-AAAA-BBBB-WXYZ', status: 'revoked', reason: 'Dodo says the key is no longer valid (refund or disabled)', lastOk: 0, lastCheck: 0 })
  assert.match(R(p, 'setup', [], false), / · Pro off: Dodo says the key is no longer valid \(refund or disabled\)$/)
})

const GATES = [['history', [], 'History is part of turnslip Pro.'], ['undo', ['1'], 'Undoing an earlier turn is part of turnslip Pro.'],
  ['report', ['--session=sess-1'], 'The session report is part of turnslip Pro.'], ['mode', ['detailed'], 'Detailed mode is part of turnslip Pro.']]

test('before Pro is on sale: gates carry no hint, a free undo and the hooks no prompt', () => {
  const p = twoTurns()
  for (const [verb, args, msg] of GATES) assert.equal(R(p, verb, args, false, {}), msg, verb)
  assert.equal(R(p, 'history', [], false, { businessId: 'bus_ts', productId: '' }), 'History is part of turnslip Pro.')
  assert.ok(!R(p, 'undo', [], false, {}).includes(PROMO))
  assert.equal(R(p, 'undo', [], false, {}).split('\n').length, 1)
  assert.ok(!existsSync(join(p.home, 'promo.json'))) // no showing was used up
})

test('a holder of a revoked or stale license sees why Pro is off, not the sales line', () => {
  const cases = [
    [{ status: 'revoked', reason: 'Dodo says the key is no longer valid (refund or disabled)', lastOk: Date.now(), lastCheck: Date.now() }, 'Pro off: Dodo says the key is no longer valid (refund or disabled)'],
    [{ status: 'active', lastOk: Date.now() - 14 * 86_400_000 - 1000, lastCheck: Date.now() }, 'Pro off: not confirmed for 14 days · connect to the internet'],
  ]
  for (const [lic, line] of cases) {
    const p = twoTurns()
    writeJson(join(p.home, 'license.json'), { key: 'TS-AAAA-BBBB-WXYZ', instanceId: 'lki_1', ...lic })
    for (const [verb, args, msg] of GATES) assert.equal(R(p, verb, args, false), `${msg}\n${line}`, verb)
    assert.ok(!R(p, 'undo', [], false).includes(PROMO))
    assert.ok(!existsSync(join(p.home, 'promo.json')))
  }
})

const LAST = `Pro trial · that was the last of 3 · ${PRO_HINT}`

test('trial: three runs shared by history, undo n and report, then the used gate', () => {
  const p = twoTurns()
  const h = R(p, 'history', [], false).split('\n')
  assert.equal(h[0], 'turnslip · history (2 of 2)')
  assert.equal(h.at(-1), 'Pro trial · 1 of 3 used · turnslip.dev/#pro')
  const u = R(p, 'undo', ['2'], false).split('\n')
  assert.match(u[0], /^turnslip · undid "Changed a\.txt"/)
  assert.equal(p.read('a.txt'), 'a\n')
  assert.equal(u.at(-1), 'Pro trial · 2 of 3 used · turnslip.dev/#pro')
  const r = R(p, 'report', ['--session=sess-1'], false).split('\n')
  assert.equal(r[0], 'turnslip · report data')
  assert.equal(r.at(-1), LAST)
  assert.equal(R(p, 'history', [], false), `History is part of turnslip Pro. Your 3 trial runs are used.\n${PRO_HINT}`)
  assert.deepEqual(JSON.parse(readFileSync(join(p.home, 'trial.json'), 'utf8')), { used: 3 })
})

test('trial: refusals spend nothing (usage, untracked folder, no such turn, no session)', () => {
  const p = twoTurns()
  assert.equal(R(p, 'history', ['0'], false), 'usage: /turnslip:history [n] [--ids]')
  assert.equal(R(p, 'undo', ['99'], false), 'turnslip · no turn 99 in this project · /turnslip:history lists them')
  assert.equal(R(p, 'undo', ['1', '2'], false), 'usage: /turnslip:undo [n|id]')
  assert.equal(R(p, 'report', [], false), 'turnslip · this Claude Code version does not give the session id; update it')
  const home = { home: p.home, root: homedir() }
  assert.equal(R(home, 'history', [], false), 'turnslip does not track this folder (home directory or drive root).')
  assert.equal(R(home, 'undo', ['1'], false), 'turnslip does not track this folder (home directory or drive root).')
  assert.ok(!existsSync(join(p.home, 'trial.json')), 'a refusal spent a run')
})

// Final review I1: an empty list is not a result; a vibe coder tries the command before there is
// anything to show, and must not lose a third of the trial to "nothing yet".
test('trial: an empty history or report spends nothing', () => {
  const p = { home: tempDir(), root: makeProject({ 'a.txt': 'a\n' }) }
  assert.equal(R(p, 'history', [], false), 'turnslip · no turns with changes in this project yet')
  assert.equal(R(p, 'report', ['--session=sess-1'], false), 'turnslip · nothing to report in this session yet')
  assert.ok(!existsSync(join(p.home, 'trial.json')), 'an empty result spent a run')
})

test('trial: a malformed trial.json gives the plain gate, never "your runs are used"', () => {
  const p = twoTurns()
  writeFileSync(join(p.home, 'trial.json'), 'not json')
  assert.equal(R(p, 'history', [], false), `History is part of turnslip Pro.\n${PRO_HINT}`)
})

test('trial: none for Pro, before sale, or for a stale or revoked license; never for mode detailed', () => {
  const p = twoTurns()
  assert.ok(!R(p, 'history', [], true).includes('Pro trial'))
  assert.equal(R(p, 'history', [], false, {}), 'History is part of turnslip Pro.')
  assert.equal(R(p, 'mode', ['detailed'], false), `Detailed mode is part of turnslip Pro.\n${PRO_HINT}`)
  assert.ok(!existsSync(join(p.home, 'trial.json')))
  const q = twoTurns()
  writeJson(join(q.home, 'trial.json'), { used: 2 })
  writeJson(join(q.home, 'license.json'), { key: 'TS-AAAA-BBBB-WXYZ', status: 'revoked', reason: 'Dodo says the key is no longer valid (refund or disabled)', lastOk: 0, lastCheck: 0 })
  assert.equal(R(q, 'history', [], false), 'History is part of turnslip Pro.\nPro off: Dodo says the key is no longer valid (refund or disabled)')
  assert.deepEqual(JSON.parse(readFileSync(join(q.home, 'trial.json'), 'utf8')), { used: 2 })
})

test('trial: a run that cannot be recorded is not given; a trial run carries no promo line', () => {
  const p = twoTurns()
  const fail = () => null
  assert.equal(run({ verb: 'undo', args: ['2'], home: p.home, root: p.root, pro: false, ids: SALE, spend: fail }),
    `Undoing an earlier turn is part of turnslip Pro.\n${PRO_HINT}`)
  assert.equal(p.read('a.txt'), 'changed\n', 'the undo ran though the run was not recorded')
  const out = R(p, 'undo', ['2'], false)
  assert.ok(!out.includes(PROMO))
  assert.equal(out.split('\n').filter((l) => l.includes('turnslip.dev')).length, 1)
})

test('trial: after it runs out, the free undo still works and follows the promo rules', () => {
  const p = spent(twoTurns())
  const out = R(p, 'undo', [], false).split('\n')
  assert.match(out[0], /^turnslip · undid "Changed b\.txt"/)
  assert.equal(out.at(-1), PROMO)
})

// /turnslip:buy (owner, 2026-10-05): open the checkout from the terminal, and print it too.
test('buy opens the checkout of the product the plugin accepts, and prints the link and the next step', () => {
  const p = twoTurns()
  const opened = []
  const out = run({ verb: 'buy', args: [], home: p.home, root: p.root, pro: false, ids: SALE, open: (u) => { opened.push(u); return true } })
  const url = 'https://checkout.dodopayments.com/buy/pdt_ts?quantity=1&redirect_url=https%3A%2F%2Fturnslip.dev%2Fthanks'
  assert.deepEqual(opened, [url])
  assert.equal(out, `turnslip · opened the checkout in your browser: ${url}\nAfter paying, run /turnslip:activate <key> (the thanks page has the line to copy)`)
  const failed = run({ verb: 'buy', args: [], home: p.home, root: p.root, pro: false, ids: SALE, open: () => false })
  assert.equal(failed.split('\n')[0], `turnslip · open this link to buy Pro: ${url}`)
})

test('buy: not before it is on sale, and not for a machine that already has Pro', () => {
  const p = twoTurns()
  const opened = []
  const open = (u) => { opened.push(u); return true }
  assert.equal(run({ verb: 'buy', args: [], home: p.home, root: p.root, pro: false, ids: {}, open }), 'turnslip Pro is not on sale yet · turnslip.dev')
  assert.equal(run({ verb: 'buy', args: [], home: p.home, root: p.root, pro: true, ids: SALE, open }), 'turnslip · Pro is already on this machine · /turnslip:setup shows the key')
  assert.deepEqual(opened, [])
})
