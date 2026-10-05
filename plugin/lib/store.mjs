import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadIgnore } from './gitignore.mjs'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

// ~/.turnslip holds the license key and snapshots of the user's files (.env included): on Unix only
// its owner may enter it. Windows guards it with the user profile's ACLs; modes mean nothing there.
// Never throws: a hook must not fail over it.
export function secureHome(home, { platform = process.platform, fs = { mkdirSync, statSync, chmodSync } } = {}) {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    if (platform !== 'win32' && fs.statSync(home).mode & 0o077) fs.chmodSync(home, 0o700)
    return true
  } catch {
    return false
  }
}

export function hashBytes(buf) {
  return createHash('sha1').update(buf).digest('hex')
}

export function blobPath(home, hash) {
  return join(home, 'store', 'objects', hash.slice(0, 2), hash.slice(2))
}

// Windows refuses a rename for a moment when another process renames onto the same file (a hook and
// the detached indexer both write index.json): EPERM, EACCES or EBUSY. Ten short retries, 55 ms at most;
// a probe of two processes renaming 3,000 times each needed 3.
const REFUSED = new Set(['EPERM', 'EACCES', 'EBUSY'])
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export function writeAtomic(p, data, { platform = process.platform, rename = renameSync, wait = sleepSync } = {}) {
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, data)
    for (let tries = 0; ; tries++) {
      try { rename(tmp, p); break } catch (e) {
        if (platform !== 'win32' || !REFUSED.has(e.code) || tries >= 10) throw e
        wait(tries + 1)
      }
    }
  } catch (e) {
    rmSync(tmp, { force: true }) // a failed rename (a directory or a locked file in the way) leaves no orphan
    throw e
  }
}

export function putBlob(home, buf) {
  const hash = hashBytes(buf)
  const p = blobPath(home, hash)
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true })
    writeAtomic(p, buf)
  }
  return hash
}

export function getBlob(home, hash) {
  return readFileSync(blobPath(home, hash))
}

export function readJson(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback }
}

export function writeJson(p, value) {
  mkdirSync(dirname(p), { recursive: true })
  writeAtomic(p, JSON.stringify(value))
}

class OverBudget extends Error {}

// One unreadable directory (EPERM, a locked volume) is left out rather than failing the project;
// an unreadable root still throws.
function walk(root, ignore, deadline, readDir, out, relDir = '') {
  let entries
  try { entries = readDir(join(root, relDir), { withFileTypes: true }) } catch (e) { if (!relDir) throw e; return out }
  for (const e of entries) {
    if (performance.now() > deadline) throw new OverBudget()
    const rel = relDir ? `${relDir}/${e.name}` : e.name
    if (e.isDirectory()) { if (!ignore(rel, true)) walk(root, ignore, deadline, readDir, out, rel) }
    else if (e.isFile() && !ignore(rel, false)) out.push(rel)
  }
  return out
}

// null when the deadline passes: a partial manifest would report every unvisited file as deleted.
// The warm path trusts mtime+size, so a same-size rewrite that keeps its mtime is not seen.
export function snapshot({ home, root, index = {}, deadline = Infinity, readDir = readdirSync }) {
  try {
    const files = walk(root, loadIgnore(root), deadline, readDir, [])
    const manifest = {}
    const nextIndex = {}
    for (const rel of files) {
      if (performance.now() > deadline) throw new OverBudget()
      let st
      try { st = statSync(join(root, rel)) } catch { continue } // vanished mid-walk
      if (st.size > MAX_FILE_BYTES) continue
      const prev = index[rel]
      let hash
      if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) hash = prev.hash
      else {
        try { hash = putBlob(home, readFileSync(join(root, rel))) } catch { continue }
      }
      manifest[rel] = hash
      nextIndex[rel] = { mtime: st.mtimeMs, size: st.size, hash }
    }
    return { manifest, index: nextIndex }
  } catch (e) {
    if (e instanceof OverBudget) return null
    throw e
  }
}
