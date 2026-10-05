// Detached weekly license check (spec 2026-10-04-license §5), started by UserPromptSubmit under
// ~/.turnslip/license.lock. Never run inside a hook: it waits for the network.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { revalidate } from './license.mjs'
import { logError } from './log.mjs'

const home = process.argv[2]
if (home) {
  try {
    await revalidate(home)
  } catch (e) {
    logError(home, 'license-check', e)
  } finally {
    rmSync(join(home, 'license.lock'), { force: true })
  }
}
