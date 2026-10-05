// ~/.turnslip/log: one line per internal failure (parent spec §10). Never throws. `secret`, when given
// (a license key typed by the user), is masked so no log line holds it whole.
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function logError(home, event, e, secret) {
  try {
    mkdirSync(home, { recursive: true })
    const p = join(home, 'log')
    if (existsSync(p) && statSync(p).size > 1_000_000) writeFileSync(p, '')
    let text = String(e?.stack ?? e)
    if (secret && secret.length >= 8) text = text.split(secret).join(`…${secret.slice(-4)}`)
    appendFileSync(p, `${new Date().toISOString()} ${event} ${text}\n`)
  } catch {}
}
