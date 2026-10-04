import { readFileSync } from 'node:fs'
import { hideReceipt } from './receipt.mjs'

// The MessageDisplay hook (spec §6, spike §16): Claude Code hands it each batch of finished lines of a
// streaming reply, and the batch is shown as answered. The receipt line is hidden there; the stored
// reply keeps it for Stop. It runs once per batch of every reply, so it loads nothing else and says
// nothing about a batch without a receipt.
try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const shown = input?.hook_event_name === 'MessageDisplay' ? hideReceipt(input.delta) : null
  if (shown !== null) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: shown } }))
} catch {}
process.exitCode = 0
