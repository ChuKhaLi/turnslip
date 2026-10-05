import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkoutUrl, onSale } from './dodo.mjs'
import { finishOpenTurn } from './hook.mjs'
import { ago, formatHistory, reportData } from './history.mjs'
import { NOT_ON_SALE, licenseState, mask } from './license.mjs'
import { openUrl } from './open.mjs'
import { isTrackableRoot, projectDir } from './paths.mjs'
import { promoLine, proHint, PRO_HINT } from './promo.mjs'
import { TRIAL_USED, spendTrial, trialLine, trialOpen, trialSpent } from './trial.mjs'
import { readJson, writeJson } from './store.mjs'
import { findTurn, listHistory } from './turns.mjs'
import { undoLatest, undoTurn } from './undo.mjs'

// The one version: plugin.json's, which Claude Code compares to decide an update.
const VERSION = readJson(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json'))?.version ?? 'unknown'
export const USAGE = 'usage: /turnslip:undo [n|id] · /turnslip:history [n] [--ids] · /turnslip:report · /turnslip:mode simple|detailed · /turnslip:setup · /turnslip:buy · /turnslip:activate <key> · /turnslip:deactivate'
const NOT_TRACKED = 'turnslip does not track this folder (home directory or drive root).'

// Commands pass the session as --session=${CLAUDE_SESSION_ID}. A Claude Code that does not expand it
// leaves either nothing (bash expands an unset variable to "") or the literal text.
function takeSession(args) {
  let session = null
  const rest = []
  for (const a of args) {
    if (!a.startsWith('--session=')) { rest.push(a); continue }
    const v = a.slice('--session='.length)
    session = v && !v.includes('${') ? v : null
  }
  return { session, rest }
}

function licenseLine(home) {
  const s = licenseState(home)
  if (s.kind === 'pro') return `Pro (key ${mask(s.key)}, checked ${ago(new Date(s.lastOk).toISOString())})`
  if (s.kind === 'off') return `Pro off: ${s.reason}`
  return 'Free · Pro at turnslip.dev/#pro'
}

export function run({ verb, args = [], home, root, pro, ids, spend = spendTrial, open = openUrl }) {
  const trial = !pro && trialOpen(home, { ids })
  // counted: one of the three trial commands; once the trial is spent its gate says so (§6b).
  const gate = (msg, counted = true) => {
    const h = proHint(home, { ids })
    if (!h) return msg
    const used = counted && h === PRO_HINT && trialSpent(home) ? ` ${TRIAL_USED}` : ''
    return `${msg}${used}\n${h}`
  }
  // A counted command whose own checks passed: Pro goes on; a free user with runs left spends one,
  // recorded before the result (or not given); everyone else gets the gate.
  let note = ''
  const admit = (msg) => {
    if (pro) return null
    const used = trial ? spend(home) : null
    if (used === null) return gate(msg)
    note = trialLine(used)
    return null
  }
  const withNote = (out) => (note ? `${out}\n${note}` : out)
  const UNDO_PRO = 'Undoing an earlier turn is part of turnslip Pro.'
  const HISTORY_PRO = 'History is part of turnslip Pro.'
  const REPORT_PRO = 'The session report is part of turnslip Pro.'
  const { session, rest } = takeSession(args)
  switch (verb) {
    case 'undo': {
      if (rest.length > 1) return 'usage: /turnslip:undo [n|id]' // `undo 2 3` must not quietly undo only 2
      if (rest.length && !pro && !trial) return gate(UNDO_PRO)
      if (!isTrackableRoot(root)) return NOT_TRACKED
      finishOpenTurn(home, session, root)
      if (!rest.length) {
        const out = undoLatest({ home, root, sessionId: session })
        const promo = out.startsWith('turnslip · undid ') ? promoLine(home, { pro, ids }) : ''
        return promo ? `${out}\n${promo}` : out
      }
      const turn = findTurn(listHistory(projectDir(home, root)), rest[0])
      if (!turn) return `turnslip · no turn ${rest[0] || '""'} in this project · /turnslip:history lists them`
      const shut = admit(UNDO_PRO)
      if (shut) return shut
      return withNote(undoTurn({ home, root, turn, sessionId: session }))
    }
    case 'history': {
      if (!pro && !trial) return gate(HISTORY_PRO)
      if (!isTrackableRoot(root)) return NOT_TRACKED
      finishOpenTurn(home, session, root) // so its numbers match what undo n will see
      const ids = rest.includes('--ids')
      const nums = rest.filter((a) => a !== '--ids')
      if (nums.length > 1 || (nums.length && !/^[1-9]\d*$/.test(nums[0]))) return 'usage: /turnslip:history [n] [--ids]'
      const all = listHistory(projectDir(home, root))
      const out = formatHistory(all.slice(0, Math.min(Number(nums[0] ?? 10), 50)), { total: all.length, ids })
      if (!all.length) return out // an empty list is not a result: no run is spent on it
      const shut = admit(HISTORY_PRO)
      if (shut) return shut
      return withNote(out)
    }
    case 'report': {
      if (!pro && !trial) return gate(REPORT_PRO)
      if (!isTrackableRoot(root)) return NOT_TRACKED
      if (!session) return 'turnslip · this Claude Code version does not give the session id; update it'
      const data = reportData({ home, root, sessionId: session })
      if (!data.startsWith('turnslip · report data')) return data // nothing to report yet: no run spent
      const shut = admit(REPORT_PRO)
      if (shut) return shut
      return withNote(data)
    }
    case 'mode': {
      if (rest[0] === 'detailed' && !pro) return gate('Detailed mode is part of turnslip Pro.', false)
      if (rest[0] !== 'simple' && rest[0] !== 'detailed') return USAGE
      writeJson(join(home, 'config.json'), { ...readJson(join(home, 'config.json'), {}), mode: rest[0] })
      return `turnslip · mode: ${rest[0]}`
    }
    case 'setup': {
      const mode = readJson(join(home, 'config.json'), {})?.mode ?? 'simple'
      const indexed = readJson(join(projectDir(home, root), 'index.json')) ? 'indexed' : 'not indexed yet'
      const major = Number(process.versions.node.split('.')[0])
      const warn = major < 18 ? ' · Node 18 or newer is required' : ''
      return `turnslip ${VERSION} · Node ${process.version} · data in ${home} · mode ${mode} · this project ${indexed}${warn} · ${licenseLine(home)}`
    }
    case 'buy': {
      if (!onSale(ids)) return NOT_ON_SALE
      if (pro) return 'turnslip · Pro is already on this machine · /turnslip:setup shows the key'
      const url = checkoutUrl(ids)
      const head = open(url) ? 'opened the checkout in your browser' : 'open this link to buy Pro'
      return `turnslip · ${head}: ${url}\nAfter paying, run /turnslip:activate <key> (the thanks page has the line to copy)`
    }
    default:
      return USAGE
  }
}
