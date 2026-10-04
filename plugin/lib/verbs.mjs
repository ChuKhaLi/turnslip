import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finishOpenTurn } from './hook.mjs'
import { formatHistory, reportData } from './history.mjs'
import { isTrackableRoot, projectDir } from './paths.mjs'
import { readJson, writeJson } from './store.mjs'
import { findTurn, listHistory } from './turns.mjs'
import { undoLatest, undoTurn } from './undo.mjs'

// The one version: plugin.json's, which Claude Code compares to decide an update.
const VERSION = readJson(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json'))?.version ?? 'unknown'
export const USAGE = 'usage: /turnslip:undo [n|id] · /turnslip:history [n] [--ids] · /turnslip:report · /turnslip:mode simple|detailed · /turnslip:setup'
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

export function run({ verb, args = [], home, root, pro }) {
  const { session, rest } = takeSession(args)
  switch (verb) {
    case 'undo': {
      if (rest.length > 1) return 'usage: /turnslip:undo [n|id]' // `undo 2 3` must not quietly undo only 2
      if (rest.length && !pro) return 'Undoing an earlier turn is part of turnslip Pro.'
      if (!isTrackableRoot(root)) return NOT_TRACKED
      finishOpenTurn(home, session, root)
      if (!rest.length) return undoLatest({ home, root, sessionId: session })
      const turn = findTurn(listHistory(projectDir(home, root)), rest[0])
      if (!turn) return `turnslip · no turn ${rest[0] || '""'} in this project · /turnslip:history lists them`
      return undoTurn({ home, root, turn, sessionId: session })
    }
    case 'history': {
      if (!pro) return 'History is part of turnslip Pro.'
      if (!isTrackableRoot(root)) return NOT_TRACKED
      finishOpenTurn(home, session, root) // so its numbers match what undo n will see
      const ids = rest.includes('--ids')
      const nums = rest.filter((a) => a !== '--ids')
      if (nums.length > 1 || (nums.length && !/^[1-9]\d*$/.test(nums[0]))) return 'usage: /turnslip:history [n] [--ids]'
      const all = listHistory(projectDir(home, root))
      return formatHistory(all.slice(0, Math.min(Number(nums[0] ?? 10), 50)), { total: all.length, ids })
    }
    case 'report': {
      if (!pro) return 'The session report is part of turnslip Pro.'
      if (!isTrackableRoot(root)) return NOT_TRACKED
      if (!session) return 'turnslip · this Claude Code version does not give the session id; update it'
      return reportData({ home, root, sessionId: session })
    }
    case 'mode': {
      if (rest[0] === 'detailed' && !pro) return 'Detailed mode is part of turnslip Pro.'
      if (rest[0] !== 'simple' && rest[0] !== 'detailed') return USAGE
      writeJson(join(home, 'config.json'), { ...readJson(join(home, 'config.json'), {}), mode: rest[0] })
      return `turnslip · mode: ${rest[0]}`
    }
    case 'setup': {
      const mode = readJson(join(home, 'config.json'), {})?.mode ?? 'simple'
      const indexed = readJson(join(projectDir(home, root), 'index.json')) ? 'indexed' : 'not indexed yet'
      const major = Number(process.versions.node.split('.')[0])
      const warn = major < 18 ? ' · Node 18 or newer is required' : ''
      return `turnslip ${VERSION} · Node ${process.version} · data in ${home} · mode ${mode} · this project ${indexed}${warn}`
    }
    default:
      return USAGE
  }
}
