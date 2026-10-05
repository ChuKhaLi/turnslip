// Pro is read from ~/.turnslip/license.json, never from the network: hooks call isPro (spec
// 2026-10-04-license §2). The async half (activate, deactivate, revalidate) comes below.
import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import * as dodo from './dodo.mjs'
import { readJson, writeJson } from './store.mjs'

export const DAY = 86_400_000
const OFFLINE_DAYS = 14

export const licensePath = (home) => join(home, 'license.json')
export const mask = (key) => `…${String(key ?? '').slice(-4)}`

export function readLicense(home) {
  const l = readJson(licensePath(home))
  return l && typeof l === 'object' && !Array.isArray(l) && typeof l.key === 'string' ? l : null
}

// One day of slack for a clock a little ahead; a clock set far back must not freeze Pro on.
const inWindow = (l, now) => Number.isFinite(l.lastOk) && l.lastOk >= now - OFFLINE_DAYS * DAY && l.lastOk <= now + DAY

export function isPro(home, now = Date.now()) {
  const l = readLicense(home)
  return Boolean(l && l.status === 'active' && inWindow(l, now))
}

export function licenseState(home, now = Date.now()) {
  const l = readLicense(home)
  if (!l) return { kind: 'free' }
  if (l.status !== 'active') return { kind: 'off', reason: l.reason || 'the license is not active' }
  if (inWindow(l, now)) return { kind: 'pro', key: l.key, lastOk: l.lastOk }
  if (l.lastOk > now) return { kind: 'off', reason: 'last check is in the future · check the clock' }
  return { kind: 'off', reason: 'not confirmed for 14 days · connect to the internet' }
}

// Weekly after a success; daily after a failed attempt, so an offline machine does not try at every prompt.
export function needsCheck(l, now = Date.now()) {
  if (!l || l.status !== 'active' || !l.instanceId) return false
  const last = Number.isFinite(l.lastCheck) ? l.lastCheck : 0
  if (last > now + DAY) return true
  const gap = last > (l.lastOk ?? 0) ? DAY : 7 * DAY
  return now - last >= gap
}

export const KEY_RE = /^[A-Za-z0-9_-]{8,255}$/
export const ACTIVATE_USAGE = 'usage: /turnslip:activate <key> · the key is in the email from Dodo Payments'
export const NOT_ON_SALE = 'turnslip Pro is not on sale yet · turnslip.dev'
export const REVOKED = 'Dodo says the key is no longer valid (refund or disabled)'
const OFFLINE_ACTIVATE = 'turnslip · could not reach Dodo Payments · nothing changed, try again'
const activated = (key) => `turnslip · Pro activated on this machine (key ${mask(key)}) · thank you\n` +
  '/turnslip:history · /turnslip:undo <n> · /turnslip:report · /turnslip:mode detailed'

// A random id kept per machine: the site promises that only the key and a machine id leave it.
export function machineName(home) {
  const p = join(home, 'machine.json')
  let id = readJson(p)?.id
  if (typeof id !== 'string' || !/^[0-9a-f]{6}$/.test(id)) {
    id = randomBytes(3).toString('hex')
    writeJson(p, { id })
  }
  return `turnslip · ${process.platform} · ${id}`
}

export async function activateKey(home, raw, { fetch, ids = dodo.IDS, now = Date.now() } = {}) {
  const key = String(raw ?? '').trim()
  if (!KEY_RE.test(key)) return ACTIVATE_USAGE
  if (!dodo.onSale(ids)) return NOT_ON_SALE
  const opts = { fetch }
  const old = readLicense(home)
  let gone = false // the stored instance of this very key was refused by validate
  if (old?.key === key && old.instanceId) {
    // Reinstalling or running the command twice must not use up one of the 3 machines.
    const v = await dodo.validate(key, old.instanceId, opts)
    if (v.offline) return OFFLINE_ACTIVATE
    if (v.ok) {
      writeJson(licensePath(home), { ...old, status: 'active', reason: null, lastOk: now, lastCheck: now })
      return activated(key)
    }
    // invalid: this instance is gone or the key is off; activating says which.
    gone = true
  }
  const name = machineName(home)
  const a = await dodo.activate(key, name, opts)
  const refusal = a.unknown ? 'turnslip · that key does not exist · check the email from Dodo Payments'
    : a.invalid ? 'turnslip · that key is not active (refunded or disabled) · support@turnslip.dev'
    : a.limit ? 'turnslip · that key is already on 3 machines · run /turnslip:deactivate on one of them, or write to support@turnslip.dev'
    : null
  if (refusal) {
    // Spec §5: a stored key that Dodo now refuses stops being Pro at once (offline writes nothing).
    if (gone) writeJson(licensePath(home), { ...old, status: 'revoked', reason: refusal })
    return refusal
  }
  if (!a.ok) return OFFLINE_ACTIVATE
  // Any Dodo merchant's key activates on these public endpoints: only ours unlocks Pro.
  if (a.businessId !== ids.businessId || a.productId !== ids.productId) {
    await dodo.deactivate(key, a.instanceId, opts)
    return 'turnslip · this key is not a turnslip key'
  }
  writeJson(licensePath(home), { key, instanceId: a.instanceId, name, status: 'active', activatedAt: new Date(now).toISOString(), lastOk: now, lastCheck: now, reason: null })
  // Only now is the old key's slot released (best effort): before, a failed activation would leave neither.
  if (old?.instanceId && old.key !== key) await dodo.deactivate(old.key, old.instanceId, opts)
  return activated(key)
}

export async function deactivateKey(home, { fetch } = {}) {
  const l = readLicense(home)
  if (!l) return 'turnslip · no license on this machine'
  if (l.instanceId) {
    const d = await dodo.deactivate(l.key, l.instanceId, { fetch })
    // Deleting it here while offline would leave the slot taken on Dodo with no way to free it.
    if (d.offline) return 'turnslip · could not reach Dodo Payments · the license stays on this machine, try again'
    if (d.refused) {
      if (l.status !== 'revoked') return `turnslip · Dodo Payments refused to free this machine (HTTP ${d.refused}) · the license stays here · write to support@turnslip.dev`
      // Revoked already: no slot to keep, so a refusal must not strand the file here.
      rmSync(licensePath(home), { force: true })
      return `turnslip · this machine no longer uses key ${mask(l.key)} · Dodo refused to free the slot (HTTP ${d.refused}), the key was already revoked`
    }
  }
  rmSync(licensePath(home), { force: true })
  return `turnslip · this machine no longer uses key ${mask(l.key)} · one machine freed`
}

export async function revalidate(home, { fetch, now = Date.now() } = {}) {
  const l = readLicense(home)
  if (!l || l.status !== 'active' || !l.instanceId) return
  writeJson(licensePath(home), { ...l, lastCheck: now })
  const v = await dodo.validate(l.key, l.instanceId, { fetch })
  const cur = readLicense(home)
  if (!cur || cur.key !== l.key || cur.instanceId !== l.instanceId) return // replaced while the check ran
  if (v.ok) writeJson(licensePath(home), { ...cur, lastOk: now, lastCheck: now })
  else if (v.invalid) writeJson(licensePath(home), { ...cur, status: 'revoked', reason: REVOKED })
}
