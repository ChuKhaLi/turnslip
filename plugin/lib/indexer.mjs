import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { projectDir } from './paths.mjs'
import { readJson, snapshot, writeJson } from './store.mjs'

// Run detached from SessionStart or the first UserPromptSubmit: the first snapshot of a project
// took 22-42 s on a cold disk (spike §5) and must never block a hook.
const [home, root] = process.argv.slice(2)
const pdir = projectDir(home, root)
try {
  // A rebuild after a stale index reuses the hashes of files whose mtime and size held.
  const snap = snapshot({ home, root, index: readJson(join(pdir, 'index.json')) ?? {} })
  if (snap) writeJson(join(pdir, 'index.json'), snap.index)
} catch (e) {
  try { mkdirSync(home, { recursive: true }); appendFileSync(join(home, 'log'), `${new Date().toISOString()} indexer ${e?.stack ?? e}\n`) } catch {}
} finally {
  rmSync(join(pdir, 'indexing.lock'), { force: true })
}
