import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeAbs, projectDir } from './paths.mjs'
import { blobPath, readJson, writeJson } from './store.mjs'

// Ids sort by time, and history and undo trust that order. Two turns made in the same millisecond (an
// undo and its redo on a fast machine; seen on CI macOS) would otherwise sort by their random tail,
// so within a process the stamp never repeats: it moves on by a millisecond instead.
let lastStamp = 0

export function newTurnId(now = Date.now()) {
  const stamp = Math.max(now, lastStamp + 1)
  lastStamp = stamp
  return `${stamp.toString(36).padStart(9, '0')}-${randomBytes(3).toString('hex')}`
}

const turnDir = (pdir, id) => join(pdir, 'turns', id)

export function saveTurn(pdir, turn) {
  writeJson(join(turnDir(pdir, turn.id), 'turn.json'), turn)
}

export function loadTurn(pdir, id) {
  return readJson(join(turnDir(pdir, id), 'turn.json'))
}

// One line per event: parallel tool calls may append at once, and a line is written whole.
export function appendEvent(pdir, id, event) {
  mkdirSync(turnDir(pdir, id), { recursive: true })
  appendFileSync(join(turnDir(pdir, id), 'events.jsonl'), JSON.stringify(event) + '\n')
}

export function readEvents(pdir, id) {
  let text
  try { text = readFileSync(join(turnDir(pdir, id), 'events.jsonl'), 'utf8') } catch { return [] }
  return text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
}

const sessionFile = (home, sessionId) => join(home, 'sessions', `${String(sessionId ?? 'none').replace(/[^A-Za-z0-9_-]/g, '_')}.json`)

export function setCurrent(home, sessionId, pointer) {
  writeJson(sessionFile(home, sessionId), pointer)
}

export function getCurrent(home, sessionId) {
  return readJson(sessionFile(home, sessionId))
}

export function clearCurrent(home, sessionId) {
  rmSync(sessionFile(home, sessionId), { force: true })
}

export function listTurnIds(pdir) {
  try { return readdirSync(join(pdir, 'turns')).sort() } catch { return [] }
}

export function deleteTurn(pdir, id) {
  rmSync(turnDir(pdir, id), { recursive: true, force: true })
}

export function pruneTurns(pdir, keep = 50) {
  const ids = listTurnIds(pdir)
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) rmSync(turnDir(pdir, id), { recursive: true, force: true })
}

// The turns /turnslip:history lists, newest first: finished and with at least one change, undo
// records included, every session. History and undo number this one list, so `undo 3` is the third
// line of `history`.
export function listHistory(pdir, max = 50) {
  const out = []
  for (const id of listTurnIds(pdir).reverse()) {
    const t = loadTurn(pdir, id)
    if (t?.finished && t.changes?.length) out.push(t)
    if (out.length >= max) break
  }
  return out
}

// `undo 3` or `undo <turn id>`. A number is 1-based with no sign, point or leading zero.
export function findTurn(list, arg) {
  if (/^[1-9]\d*$/.test(arg)) return list[Number(arg) - 1] ?? null
  return list.find((t) => t.id === arg) ?? null
}

export function inProgressTurns(home, root) {
  const out = []
  let files = []
  try { files = readdirSync(join(home, 'sessions')) } catch { return out }
  for (const f of files) {
    const ptr = readJson(join(home, 'sessions', f))
    if (!ptr || normalizeAbs(ptr.root) !== normalizeAbs(root)) continue
    const pdir = projectDir(home, root)
    const turn = loadTurn(pdir, ptr.id)
    if (turn && !turn.finished) out.push({ pdir, turn })
  }
  return out
}

function referencedHashes(home) {
  const refs = new Set()
  const add = (h) => { if (h) refs.add(h) }
  let projects = []
  try { projects = readdirSync(join(home, 'projects')) } catch {}
  for (const p of projects) {
    const pdir = join(home, 'projects', p)
    for (const e of Object.values(readJson(join(pdir, 'index.json'), {}))) add(e.hash)
    for (const id of listTurnIds(pdir)) {
      const t = loadTurn(pdir, id) ?? {}
      // A finished turn keeps only its changes; an unfinished one still needs its start to diff against.
      if (!t.finished) for (const h of Object.values(t.start ?? {})) add(h)
      for (const c of t.changes ?? []) { add(c.before); add(c.after) }
      for (const e of readEvents(pdir, id)) add(e.before)
    }
  }
  return refs
}

// Blobs younger than minAgeMs are kept: an in-flight snapshot may have written them before
// anything references them. It runs inside SessionStart's 5 s timeout, so it stops deleting once
// budgetMs has passed; the rest waits for the next day's run.
export function gcBlobs(home, { now = Date.now(), minAgeMs = 3600_000, budgetMs = 1500 } = {}) {
  const deadline = performance.now() + budgetMs
  const refs = referencedHashes(home)
  const objects = join(home, 'store', 'objects')
  let removed = 0
  let dirs = []
  try { dirs = readdirSync(objects) } catch { return 0 }
  for (const d of dirs) {
    let files = []
    try { files = readdirSync(join(objects, d)) } catch { continue } // a stray file, not a fan-out dir
    for (const f of files) {
      if (performance.now() > deadline) return removed
      const hash = d + f
      if (refs.has(hash)) continue
      const p = blobPath(home, hash)
      try {
        if (now - statSync(p).mtimeMs < minAgeMs) continue
        rmSync(p, { force: true })
        removed++
      } catch {}
    }
  }
  return removed
}
