import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectDir } from './paths.mjs'
import { ago, oneLine } from './history.mjs'
import { cleanSentence, plural, shortCmd } from './render.mjs'
import { getBlob, hashBytes } from './store.mjs'
import { inProgressTurns, listHistory, newTurnId, saveTurn } from './turns.mjs'

export function currentHashFn(root) {
  return (rel) => { try { return hashBytes(readFileSync(join(root, rel))) } catch { return null } }
}

// A file whose content is no longer what the turn left is skipped: undo never overwrites later work.
// A tool edit whose pre-edit content was never captured (unknownBefore) has before === null but the
// file existed: removing it would destroy it and there is nothing to restore, so it is kept and named.
//
// before === null does not mean "created by the turn": a file that existed at turn start but was
// left out of the start snapshot (gitignored then un-ignored, over MAX_FILE_BYTES) has it too. So a
// file is removed only when it was born at or after the turn started (2 s slack); unknown or older
// birth times keep the file. An undo record's before:null is exact (the path was absent when undo
// ran, knownAbsent), and skips the birth check: NTFS gives a recreated file its old creation time.
export function planUndo({ turn, currentHash, birthtimeOf = () => null }) {
  const startedMs = Date.parse(turn.startedAt)
  const restore = []
  const remove = []
  const conflicts = []
  const noEarlierCopy = []
  for (const c of turn.changes ?? []) {
    if (currentHash(c.path) !== c.after) { conflicts.push(c.path); continue }
    if (c.unknownBefore) { noEarlierCopy.push(c.path); continue }
    if (c.before === null && c.knownAbsent) remove.push(c.path)
    else if (c.before === null) {
      const born = birthtimeOf(c.path)
      if (Number.isFinite(startedMs) && born > 0 && born >= startedMs - 2000) remove.push(c.path)
      else noEarlierCopy.push(c.path)
    } else restore.push({ path: c.path, hash: c.before })
  }
  // A delete command is a file effect: listed only when undo restores none of the turn's deletions, which
  // then fell where no snapshot reaches (a path .gitignore excludes, outside the project). A miss in a
  // mixed case beats calling restored files "not undone" (spec §8).
  const restoresDeletion = (turn.changes ?? []).some((c) => c.status === 'deleted' && restore.some((r) => r.path === c.path))
  const notUndone = (turn.flags ?? [])
    .filter((f) => !(f.kind === 'delete' && f.command && restoresDeletion))
    .filter((f) => f.command || (f.kind === 'outside' && !f.command))
    .map((f) => (f.kind === 'outside' ? `outside the project: ${(f.paths ?? [f.path]).join(', ')}` : `${f.kind}: ${shortCmd(f.command)}`))
  return { restore, remove, conflicts, noEarlierCopy, notUndone }
}

// Each item is applied on its own: one that cannot be (a directory where a file goes, a file where a
// parent directory goes, a missing blob) is reported in skipped and does not stop the others.
export function applyUndo({ home, root, plan }) {
  const restored = []
  const removed = []
  const skipped = []
  for (const r of plan.restore) {
    const p = join(root, r.path)
    try {
      const bytes = getBlob(home, r.hash)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, bytes)
      restored.push(r.path)
    } catch { skipped.push(r.path) }
  }
  for (const rel of plan.remove) {
    try { rmSync(join(root, rel), { force: true }); removed.push(rel) } catch { skipped.push(rel) }
  }
  return { restored, removed, skipped }
}

const birthtimeFn = (root) => (rel) => { try { return statSync(join(root, rel)).birthtimeMs } catch { return null } }

// The turn as /turnslip:history names it, so the two can be matched: an interrupted turn has no sentence.
const turnName = (turn) => `${cleanSentence(turn.slip?.sentence) ?? 'Claude gave no summary'}${turn.interrupted ? ' (interrupted)' : ''}`

export function undoLatest({ home, root, sessionId = null }) {
  const turn = listHistory(projectDir(home, root))[0]
  if (!turn) return 'turnslip · nothing to undo yet'
  return undoTurn({ home, root, turn, sessionId })
}

// Takes back one recorded turn, the latest or an older one. planUndo keeps every file whose content
// is no longer what the turn left, whoever changed it since (a later turn, the user).
export function undoTurn({ home, root, turn, sessionId = null, now = Date.now() }) {
  const pdir = projectDir(home, root)
  const currentHash = currentHashFn(root)
  const startedAt = new Date().toISOString()
  const plan = planUndo({ turn, currentHash, birthtimeOf: birthtimeFn(root) })
  const planned = [
    ...plan.restore.map((r) => ({ path: r.path, status: currentHash(r.path) === null ? 'added' : 'modified', before: currentHash(r.path), after: r.hash, ...(currentHash(r.path) === null && { knownAbsent: true }) })),
    ...plan.remove.map((path) => ({ path, status: 'deleted', before: currentHash(path), after: null })),
  ]
  let result = { restored: [], removed: [], skipped: [] }
  try {
    result = applyUndo({ home, root, plan })
  } finally {
    // Recorded from what was actually applied, even when a late error escapes.
    const done = new Set([...result.restored, ...result.removed])
    const changes = planned.filter((c) => done.has(c.path))
    if (changes.length) {
      // A turn in progress (the one running /turnslip) must not report the undo as its own change.
      for (const { pdir: pd, turn: t } of inProgressTurns(home, root)) {
        if (!t.start) continue
        for (const c of changes) { if (c.after === null) delete t.start[c.path]; else t.start[c.path] = c.after }
        saveTurn(pd, t)
      }
      saveTurn(pdir, { id: newTurnId(), kind: 'undo', undoes: turn.id, ...(sessionId && { sessionId }), root, startedAt, finished: true, light: false, start: null, changes, flags: [], slip: { sentence: `Undid: ${turnName(turn)}`, changes, flags: [], unmentioned: [], claimedUnchanged: [], light: false } })
    }
  }
  const sentence = turnName(turn)
  const when = ago(turn.startedAt, now)
  const parts = [result.restored.length + result.removed.length
    ? `turnslip · undid "${sentence}" (${when}) · restored ${plural(result.restored.length, 'file')}, removed ${result.removed.length}`
    : `turnslip · nothing undone for "${sentence}" (${when})`]
  // An interrupted turn was finished at a later prompt, so its edges are less certain: name the files.
  if (turn.interrupted && result.restored.length + result.removed.length) parts.push(`files: ${[...result.restored, ...result.removed].join(', ')}`)
  if (plan.conflicts.length) parts.push(`kept ${plural(plan.conflicts.length, 'file')} changed since: ${plan.conflicts.join(', ')}`)
  if (plan.noEarlierCopy.length) parts.push(`kept ${plural(plan.noEarlierCopy.length, 'file')} (no earlier copy): ${plan.noEarlierCopy.join(', ')}`)
  if (result.skipped.length) parts.push(`could not restore: ${result.skipped.join(', ')}`)
  if (plan.notUndone.length) parts.push(`not undone: ${plan.notUndone.join('; ')}`)
  return oneLine(parts.join(' · '))
}
