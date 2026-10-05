import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'lib')

export function tempDir(prefix = 'ts-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function makeProject(files = {}) {
  const root = tempDir('ts-proj-')
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}

// Every hook run gets its own TURNSLIP_HOME: no test may reach the real ~/.turnslip.
export function runHook(payload, home) {
  if (!home) throw new Error('runHook needs a temp home')
  const r = spawnSync(process.execPath, [join(LIB, 'hook.mjs')], {
    input: JSON.stringify(payload),
    env: { ...process.env, TURNSLIP_HOME: home },
    encoding: 'utf8',
    timeout: 20000,
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout ? JSON.parse(r.stdout) : null }
}

// Key set captured from real Claude Code 2.1.285 hooks (spike §1).
export function hookInput(event, root, extra = {}) {
  return {
    session_id: 'sess-1', transcript_path: join(root, 't.jsonl'), cwd: root, prompt_id: 'p-1',
    permission_mode: 'acceptEdits', hook_event_name: event, ...extra,
  }
}

// A stand-in for Dodo: no test may reach the network. routes: { activate: { status, json } | 'throw' | (body) => … }.
export function fakeFetch(routes) {
  const calls = []
  const f = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, method: init.method, body })
    const name = url.split('/licenses/')[1]
    let r = routes[name]
    if (typeof r === 'function') r = r(body)
    if (r === undefined) throw new Error(`fakeFetch: no route for ${name}`)
    if (r === 'throw') throw new TypeError('fetch failed')
    return { status: r.status, json: async () => { if (r.json === undefined) throw new SyntaxError('not json'); return r.json } }
  }
  f.calls = calls
  return f
}
