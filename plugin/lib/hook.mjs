import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffManifests, lineStats } from './diff.mjs'
import { makeIsTracked } from './gitignore.mjs'
import { isPro, needsCheck, readLicense } from './license.mjs'
import { logError } from './log.mjs'
import { promoLine } from './promo.mjs'
import { isTrackableRoot, normalizeAbs, projectDir, toRel, turnslipHome } from './paths.mjs'
import { RECEIPT_INSTRUCTION, compareClaims, parseReceipt } from './receipt.mjs'
import { renderSlip } from './render.mjs'
import { evaluateRules } from './rules.mjs'
import { getBlob, putBlob, readJson, secureHome, snapshot, writeJson } from './store.mjs'
import { appendEvent, clearCurrent, deleteTurn, gcBlobs, getCurrent, loadTurn, newTurnId, pruneTurns, readEvents, saveTurn, setCurrent } from './turns.mjs'

export const START_BUDGET_MS = 500
export const END_BUDGET_MS = 8000
const HERE = dirname(fileURLToPath(import.meta.url))
// Claude Code on Windows runs shell commands with a PowerShell tool (captured on 2.1.288).
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

// The lock is created with flag wx, so two prompts arriving together cannot both take it. A lock
// older than 10 minutes belonged to a walk that died; it is removed and taken once more.
function takeLock(lock) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); return true } catch {}
    try { if (Date.now() - statSync(lock).mtimeMs < 10 * 60_000) return false } catch {}
    rmSync(lock, { force: true })
  }
  return false
}

export function startIndexer(home, root, { execPath = process.execPath } = {}) {
  const pdir = projectDir(home, root)
  const lock = join(pdir, 'indexing.lock')
  mkdirSync(pdir, { recursive: true })
  if (!takeLock(lock)) return
  const child = spawn(execPath, [join(HERE, 'indexer.mjs'), home, root], { detached: true, stdio: 'ignore', windowsHide: true })
  // Unhandled, a failed spawn (no node at that path) would throw in the hook process.
  child.on('error', () => rmSync(lock, { force: true }))
  child.unref()
}

export function startLicenseCheck(home, { execPath = process.execPath, script = join(HERE, 'license-check.mjs'), now = Date.now() } = {}) {
  if (!needsCheck(readLicense(home), now)) return false
  mkdirSync(home, { recursive: true })
  const lock = join(home, 'license.lock')
  if (!takeLock(lock)) return false
  try {
    const child = spawn(execPath, [script, home], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => rmSync(lock, { force: true }))
    child.unref()
  } catch (e) {
    rmSync(lock, { force: true }) // a synchronous spawn failure must not hold the lock for 10 minutes
    throw e
  }
  return true
}

// A prompt whose snapshot runs over budget asks for a background walk. A stale index (a branch
// switch) needs one walk, so the first comes at once; a project too big for the budget even with a
// fresh index would otherwise walk the disk at every prompt, so each further walk waits twice as
// long as the last (1, 2, 4 ... minutes, at most 60) until a prompt fits the budget again.
export function nextIndexerRun(state, now = Date.now()) {
  if (!state?.streak) return true
  return now - state.lastSpawn >= Math.min(60, 2 ** (state.streak - 1)) * 60_000
}

function indexerOverBudget(home, root) {
  const file = join(projectDir(home, root), 'indexer.json')
  const state = readJson(file)
  const now = Date.now()
  if (!nextIndexerRun(state, now)) return
  writeJson(file, { streak: (state?.streak ?? 0) + 1, lastSpawn: now })
  startIndexer(home, root)
}

function indexerWithinBudget(home, root) {
  const file = join(projectDir(home, root), 'indexer.json')
  if (readJson(file)?.streak) writeJson(file, { streak: 0, lastSpawn: 0 }) // written only when it changes
}

export function onSessionStart({ home, input }) {
  const root = input.cwd
  if (!isTrackableRoot(root)) return null
  if (!readJson(join(projectDir(home, root), 'index.json'))) startIndexer(home, root)
  const stamp = join(home, 'gc.stamp')
  let last = 0
  try { last = statSync(stamp).mtimeMs } catch {}
  if (Date.now() - last > 24 * 3600_000) {
    mkdirSync(home, { recursive: true })
    writeFileSync(stamp, '')
    gcBlobs(home)
  }
  return null
}

export function onUserPromptSubmit({ home, input, budgetMs = START_BUDGET_MS, startCheck = startLicenseCheck }) {
  try { startCheck(home) } catch (e) { logError(home, 'license', e) } // never costs the turn
  const root = input.cwd
  if (!isTrackableRoot(root)) {
    // No turn starts here, but one left open by Esc in a tracked folder still ends now (light: no
    // snapshot of this folder), and its pointer goes, so this folder's tool events land nowhere.
    finishInterrupted(home, input.session_id, root, null)
    clearCurrent(home, input.session_id)
    return null
  }
  const pdir = projectDir(home, root)
  const index = readJson(join(pdir, 'index.json'))
  let start = null
  if (index) {
    const snap = snapshot({ home, root, index, deadline: performance.now() + budgetMs })
    if (snap) {
      start = snap.manifest
      writeJson(join(pdir, 'index.json'), snap.index)
      indexerWithinBudget(home, root)
    } else indexerOverBudget(home, root) // a stale index (a branch switch) would otherwise keep every turn light
  } else indexerOverBudget(home, root)
  finishInterrupted(home, input.session_id, root, start)
  const turn = { id: newTurnId(), sessionId: input.session_id, root, startedAt: new Date().toISOString(), kind: 'agent', light: start === null, start, finished: false }
  saveTurn(pdir, turn)
  setCurrent(home, input.session_id, { root, id: turn.id })
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: RECEIPT_INSTRUCTION } }
}

export function onPostToolUse({ home, input }) {
  const ptr = getCurrent(home, input.session_id)
  if (!ptr) return null
  const pdir = projectDir(home, ptr.root)
  const tool = input.tool_name
  const ti = input.tool_input ?? {}
  const tr = input.tool_response ?? {}
  if (SHELL_TOOLS.has(tool)) {
    appendEvent(pdir, ptr.id, { tool, at: Date.now(), command: String(ti.command ?? '') })
    return null
  }
  const file = ti.file_path ?? ti.notebook_path ?? tr.filePath
  if (!file) { // a subagent or an MCP tool: it may write, so it marks the turn as still active
    appendEvent(pdir, ptr.id, { tool, at: Date.now() })
    return null
  }
  const rel = toRel(ptr.root, file)
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel === '..' || rel.startsWith('../')) {
    appendEvent(pdir, ptr.id, { tool, at: Date.now(), outside: String(file) })
    return null
  }
  const orig = tr.originalFile
  // Write has no original: null means a new file. An edit tool with none is unknown, never new.
  const unknownBefore = tool !== 'Write' && typeof orig !== 'string'
  appendEvent(pdir, ptr.id, { tool, at: Date.now(), path: rel, before: typeof orig === 'string' ? putBlob(home, Buffer.from(orig, 'utf8')) : null, ...(unknownBefore && { unknownBefore: true }) })
  return null
}

// Light mode: the turn has no start snapshot, so only files the tools touched are known.
export function changesFromEvents(home, root, events) {
  // An ignored path is never reported: a full turn could not see it, and undo would write it back.
  const isTracked = makeIsTracked(root)
  const firstBefore = new Map()
  for (const e of events) if (e.path && !firstBefore.has(e.path) && isTracked(e.path)) firstBefore.set(e.path, e)
  const out = []
  for (const [path, ev] of firstBefore) {
    const before = ev.before
    let after = null
    try { after = putBlob(home, readFileSync(join(root, path))) } catch {}
    if (ev.unknownBefore) {
      if (after !== null) out.push({ path, status: 'modified', before: null, after, unknownBefore: true })
      continue
    }
    if (before === after) continue
    const status = before === null ? 'added' : after === null ? 'deleted' : 'modified'
    out.push({ path, status, before, after })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1))
}

const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }
const mtimeOf = (p) => { try { return statSync(p).mtimeMs } catch { return null } }

// Every write by Claude's tools lands before that tool's PostToolUse, so a turn's activity ends at
// its last event (its start when it has none). A file written more than 2 s after that was changed
// by someone else: the user after Esc, a `!` line (which can make Claude answer in the same turn, so
// Stop ends it late; captured on 2.1.286), an editor during the turn. It is left out, so the slip
// never blames Claude for it and undo never takes it back. The cost is a miss: a late write by a
// background process. Null when an event predates the timestamps: nothing is cut off. A deletion
// has no mtime and stays in; undo names what it restores for an interrupted turn.
export function activityCutoff(turn, events) {
  let end = Date.parse(turn.startedAt)
  for (const e of events) {
    if (!Number.isFinite(e.at)) return null
    end = Math.max(end, e.at)
  }
  return Number.isFinite(end) ? end + 2000 : null
}

// Stop, or the next prompt when Stop never fired. endManifest() is the end snapshot, null when over budget.
function finishTurn({ home, pdir, turn, message, endManifest, interrupted = false }) {
  const root = turn.root
  const events = readEvents(pdir, turn.id)
  let changes = null
  if (!turn.light) {
    const end = endManifest()
    // Missing from the end manifest but still a file on disk is excluded (newly ignored, grown past
    // MAX_FILE_BYTES), not deleted. A directory now at that path still means the file is gone.
    if (end) {
      changes = diffManifests(turn.start, end).filter((c) => c.status !== 'deleted' || !isFile(join(root, c.path)))
      // The mirror case: a file the turn's .gitignore edits un-ignored was there all along, unseen at
      // the start, so it is not "added". Judged by the .gitignore files as the start manifest holds them.
      const trackedAtStart = makeIsTracked(root, process.platform, (dir) => getBlob(home, turn.start[dir ? `${dir}/.gitignore` : '.gitignore']).toString('utf8'))
      changes = changes.filter((c) => c.status !== 'added' || trackedAtStart(c.path))
    } else turn.light = true
  }
  if (turn.light) changes = changesFromEvents(home, root, events)
  const cutoff = activityCutoff(turn, events)
  if (cutoff !== null) changes = changes.filter((c) => !(mtimeOf(join(root, c.path)) > cutoff))
  const toolPaths = new Set(events.filter((e) => e.path).map((e) => e.path))
  const blob = (h) => (h ? getBlob(home, h) : null)
  const rich = changes.map((c) => ({ ...c, source: toolPaths.has(c.path) ? 'tool' : 'shell', ...lineStats(blob(c.before), blob(c.after)), ...(c.unknownBefore && { plus: null, minus: null, added: [] }) }))
  const commands = events.filter((e) => SHELL_TOOLS.has(e.tool)).map((e) => e.command)
  const flags = evaluateRules({ changes: rich, commands, root })
  for (const e of events) if (e.outside) flags.push({ kind: 'outside', path: e.outside })
  const receipt = parseReceipt(message)
  const claims = receipt ? compareClaims({ changes: rich, files: receipt.files, root, isTracked: makeIsTracked(root) }) : { unmentioned: [], claimedUnchanged: [] }
  const slim = rich.map(({ added, ...c }) => c)
  const slip = { sentence: receipt?.sentence ?? null, changes: slim, flags, ...claims, light: turn.light }
  // Undo needs only changes; the manifests would make every turn.json the size of the project.
  delete turn.start
  delete turn.end
  Object.assign(turn, { finished: true, ...(interrupted && { interrupted: true }), finishedAt: new Date().toISOString(), changes: slim, flags, slip })
  saveTurn(pdir, turn)
  pruneTurns(pdir, 50)
  return slip
}

// Stop does not fire when the user presses Esc, and undo takes back only finished turns. So a turn
// still open at the next prompt is finished then, silently. This moment is its end: the start
// snapshot just taken serves as its end snapshot, keeping the prompt within its budget. A turn in
// another root (cwd changed) has no snapshot here and finishes light.
function finishInterrupted(home, sessionId, root, manifest) {
  try {
    const ptr = getCurrent(home, sessionId)
    if (!ptr) return
    const pdir = projectDir(home, ptr.root)
    const turn = loadTurn(pdir, ptr.id)
    if (!turn || turn.finished) return
    if (dropUnusedContinuation(pdir, turn)) return
    const sameRoot = normalizeAbs(resolve(ptr.root)) === normalizeAbs(resolve(root))
    finishTurn({ home, pdir, turn, message: undefined, endManifest: () => (sameRoot ? manifest : null), interrupted: true })
  } catch (e) {
    logError(home, 'UserPromptSubmit', e) // the new turn starts regardless
  }
}

// Esc fires no Stop, and a slash command's ! line runs before the next prompt's hook would finish
// the interrupted turn (captured, release item 7). So undo and history finish it first, with an end
// snapshot taken now. An open turn with no tool event is left alone: it may be the very prompt
// running the command, and an interrupted one with none has nothing in it to undo.
export function finishOpenTurn(home, sessionId, root, budgetMs = END_BUDGET_MS) {
  if (!sessionId) return
  const ptr = getCurrent(home, sessionId)
  if (!ptr) return
  const pdir = projectDir(home, ptr.root)
  const turn = loadTurn(pdir, ptr.id)
  if (!turn || turn.finished || !readEvents(pdir, turn.id).length) return
  const sameRoot = normalizeAbs(resolve(ptr.root)) === normalizeAbs(resolve(root))
  finishTurn({ home, pdir, turn, message: undefined, interrupted: true, endManifest: () => {
    if (!sameRoot) return null
    const snap = snapshot({ home, root: turn.root, index: readJson(join(pdir, 'index.json'), {}), deadline: performance.now() + budgetMs })
    if (snap) writeJson(join(pdir, 'index.json'), snap.index)
    return snap?.manifest ?? null
  } })
}

// Another plugin's Stop hook can block, and Claude then carries on in the same turn until Stop fires
// again (stop_hook_active). So each Stop opens a continuation that starts where the turn ended: work
// done after a block lands in it and gets its own slip and undo. One that saw no tool event is
// dropped (at the next prompt or SessionEnd) or simply kept open (at a further Stop): it never
// claims what the user changes between turns, deletions included.
function openContinuation(home, sessionId, turn, end) {
  const pdir = projectDir(home, turn.root)
  const next = { id: newTurnId(), sessionId, root: turn.root, startedAt: new Date().toISOString(), kind: 'continuation', continues: turn.id, light: end === null, start: end, finished: false }
  saveTurn(pdir, next)
  setCurrent(home, sessionId, { root: turn.root, id: next.id })
}

function dropUnusedContinuation(pdir, turn) {
  if (turn.kind !== 'continuation' || readEvents(pdir, turn.id).length) return false
  deleteTurn(pdir, turn.id)
  return true
}

export function onStop({ home, input, ids }) {
  const ptr = getCurrent(home, input.session_id)
  if (!ptr) return null
  const pdir = projectDir(home, ptr.root)
  const turn = loadTurn(pdir, ptr.id)
  if (!turn || turn.finished) return null
  if (turn.kind === 'continuation' && !readEvents(pdir, turn.id).length) return null // nothing done since the last Stop
  let end = null
  const slip = finishTurn({ home, pdir, turn, message: input.last_assistant_message, endManifest: () => {
    const snap = snapshot({ home, root: turn.root, index: readJson(join(pdir, 'index.json'), {}), deadline: performance.now() + END_BUDGET_MS })
    if (snap) writeJson(join(pdir, 'index.json'), snap.index)
    end = snap?.manifest ?? null
    return end
  } })
  openContinuation(home, input.session_id, turn, end)
  const pro = isPro(home)
  const mode = readJson(join(home, 'config.json'), {})?.mode === 'detailed' && pro ? 'detailed' : 'simple'
  const text = renderSlip(slip, mode)
  if (!text) return null
  const promo = slip.flags.length ? promoLine(home, { pro, ids }) : '' // line 1 carries everything that matters (spec §7)
  return { systemMessage: promo ? `${text}\n${promo}` : text }
}

// /exit or Ctrl+C mid-turn fires no Stop, and no next prompt will come: the open turn ends here, or it
// could never be undone. SessionEnd gets about a second (spike §14), so the end snapshot is capped
// and the turn ends light (tool events only) when it does not fit. Nothing is printed.
export const SESSION_END_BUDGET_MS = 400

export function onSessionEnd({ home, input, budgetMs = SESSION_END_BUDGET_MS }) {
  const ptr = getCurrent(home, input.session_id)
  if (!ptr) return null
  const pdir = projectDir(home, ptr.root)
  const turn = loadTurn(pdir, ptr.id)
  if (turn && !turn.finished && !dropUnusedContinuation(pdir, turn)) {
    finishTurn({ home, pdir, turn, message: undefined, interrupted: true, endManifest: () => {
      const snap = snapshot({ home, root: turn.root, index: readJson(join(pdir, 'index.json'), {}), deadline: performance.now() + budgetMs })
      if (snap) writeJson(join(pdir, 'index.json'), snap.index)
      return snap?.manifest ?? null
    } })
  }
  clearCurrent(home, input.session_id)
  return null
}

const HANDLERS = { SessionStart: onSessionStart, UserPromptSubmit: onUserPromptSubmit, PostToolUse: onPostToolUse, Stop: onStop, SessionEnd: onSessionEnd }

export function main() {
  let input = {}
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const home = turnslipHome()
  const handler = HANDLERS[input?.hook_event_name]
  if (!handler || typeof input.cwd !== 'string' || !existsSync(input.cwd)) return
  secureHome(home)
  try {
    const out = handler({ home, input })
    if (out) process.stdout.write(JSON.stringify(out))
  } catch (e) {
    logError(home, input.hook_event_name, e)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
  process.exitCode = 0
}
