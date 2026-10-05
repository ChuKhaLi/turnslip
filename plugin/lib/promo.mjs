// The Pro prompt for free users (spec 2026-10-04-license §6): rare, at a moment Pro would have
// helped, never line 1, and gone for good after five showings.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDS, onSale } from './dodo.mjs'
import { licenseState } from './license.mjs'
import { logError } from './log.mjs'
import { writeJson } from './store.mjs'

export const PRO_HINT = 'Buy with /turnslip:buy (or at turnslip.dev/#pro), then /turnslip:activate <key>'
export const PROMO = 'Pro: history, undo any earlier turn, session report · turnslip.dev/#pro'
const WEEK = 7 * 86_400_000
const MAX_SHOWN = 5

// The hint shown by a gate: nothing before Pro is on sale, and never a sales line to someone who bought
// (a license file exists but is off: say why instead).
export function proHint(home, { ids = IDS } = {}) {
  if (!onSale(ids)) return ''
  const s = licenseState(home)
  if (s.kind === 'off') return `Pro off: ${s.reason}`
  return PRO_HINT
}

export function promoLine(home, { pro, now = Date.now(), ids = IDS }) {
  if (pro || !onSale(ids) || licenseState(home, now).kind === 'off') return ''
  const p = join(home, 'promo.json')
  let state
  try { state = JSON.parse(readFileSync(p, 'utf8')) } catch (e) {
    if (e?.code !== 'ENOENT') return '' // unreadable: a miss, never a nag
    state = { shown: 0, last: 0 }
  }
  if (!state || !Number.isInteger(state.shown) || state.shown < 0 || !Number.isFinite(state.last) || state.last < 0) return ''
  if (state.shown >= MAX_SHOWN || now - state.last < WEEK) return ''
  try { writeJson(p, { shown: state.shown + 1, last: now }) } catch (e) { logError(home, 'promo', e); return '' } // a prompt that cannot be recorded is not shown
  return PROMO
}
