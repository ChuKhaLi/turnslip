// The Pro trial (spec 2026-10-04-license §6b): three runs of history, undo <n|id> or report, shared,
// per machine, at the moment a free user needs one. Not a lock: deleting trial.json gives three more.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDS, onSale } from './dodo.mjs'
import { licenseState } from './license.mjs'
import { logError } from './log.mjs'
import { PRO_HINT } from './promo.mjs'
import { writeJson } from './store.mjs'

export const TRIAL_RUNS = 3
export const TRIAL_USED = `Your ${TRIAL_RUNS} trial runs are used.`
const trialPath = (home) => join(home, 'trial.json')

// Runs used so far. A missing file is none; an unreadable or malformed one is all of them (a miss,
// never a free Pro).
export function trialUsed(home) {
  let state
  try { state = JSON.parse(readFileSync(trialPath(home), 'utf8')) } catch (e) {
    return e?.code === 'ENOENT' ? 0 : TRIAL_RUNS
  }
  const used = state?.used
  return Number.isInteger(used) && used >= 0 && used <= TRIAL_RUNS ? used : TRIAL_RUNS
}

// True only when the file records all three runs: a malformed one blocks the trial (above) but must
// not tell a user who never ran it that their runs are used.
export function trialSpent(home) {
  try { return JSON.parse(readFileSync(trialPath(home), 'utf8'))?.used === TRIAL_RUNS } catch { return false }
}

// Only a free user, only while Pro is on sale: a stale or revoked license holder paid, and is told why
// Pro is off instead (§6).
export function trialOpen(home, { ids = IDS } = {}) {
  return onSale(ids) && licenseState(home).kind === 'free' && trialUsed(home) < TRIAL_RUNS
}

// Records one more run and returns the new count, or null when none can be given. Recorded before the
// result: a write that failed silently would make the trial endless.
export function spendTrial(home, { write = writeJson } = {}) {
  const used = trialUsed(home) + 1
  if (used > TRIAL_RUNS) return null
  try { write(trialPath(home), { used }) } catch (e) { logError(home, 'trial', e); return null }
  return used
}

export function trialLine(used) {
  return used < TRIAL_RUNS
    ? `Pro trial · ${used} of ${TRIAL_RUNS} used · turnslip.dev/#pro`
    : `Pro trial · that was the last of ${TRIAL_RUNS} · ${PRO_HINT}`
}
