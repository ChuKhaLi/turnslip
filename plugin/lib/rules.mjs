import { homedir, tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

const SECRET = [
  // \b would match after a hyphen, so `task-sk-…` read as a key: the key must start its own token.
  /(?<![A-Za-z0-9_-])sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/,
  /\bsk_live_[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\bxox[bpas]-[A-Za-z0-9-]{10,}/,
]
const ENV_FILE = /^\.env(\..+)?$/
const ENV_TEMPLATE = /\.(example|sample|template)$/
const DELETE_CMD = [/\brm\s+-[a-zA-Z]*[rR]/, /\brm\s+--recursive\b/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+clean\s+-[a-zA-Z]*f/, /\bgit\s+checkout\s+--\s+\./, /\bRemove-Item\b[^|;&]*-Recurse/i, /\brmdir\s+\/s\b/i]
const DB_PATH = [/(^|\/)migrations?\//i, /(^|\/)schema\.prisma$/, /\.sql$/i]
const DB_CMD = [/\bprisma\s+(migrate|db\s+push)\b/, /\bdrizzle-kit\s+(push|migrate)\b/, /\bknex\s+migrate/, /\balembic\s+upgrade\b/, /\bmanage\.py\s+migrate\b/, /\brails\s+db:migrate\b/, /\bDROP\s+TABLE\b/, /\bTRUNCATE\s+(TABLE\s+)?[A-Za-z_"]/]
const PKG_FILES = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock'])
const PKG_FILE_RE = /^requirements.*\.txt$/
const PKG_CMD = [/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b/, /\bpip3?\s+install\b/, /\buv\s+(add|pip\s+install)\b/, /\bcargo\s+add\b/, /\bgo\s+get\b/, /\bgem\s+install\b/, /\bbrew\s+install\b/]
const SHIP_PATH = [/^\.github\/workflows\//, /(^|\/)Dockerfile$/, /(^|\/)vercel\.json$/, /(^|\/)netlify\.toml$/, /(^|\/)fly\.toml$/]
const SHIP_CMD = [/\bgit\s+push\b/, /\bnpm\s+publish\b/, /\bvercel\b[^|;&]*--prod\b/, /\bfirebase\s+deploy\b/, /\bnetlify\s+deploy\b[^|;&]*--prod\b/, /\bfly\s+deploy\b/]

const base = (p) => p.slice(p.lastIndexOf('/') + 1)
const any = (res, s) => res.some((r) => r.test(s))

export function evaluateRules({ changes, commands, root }) {
  const flags = []
  for (const c of changes) {
    if (c.status !== 'deleted') {
      const hit = (c.added ?? []).find((a) => any(SECRET, a.text))
      if (hit) flags.push({ kind: 'secret', path: c.path, line: hit.no })
      else if (c.status === 'added' && ENV_FILE.test(base(c.path)) && !ENV_TEMPLATE.test(c.path)) flags.push({ kind: 'secret', path: c.path, line: null })
    }
    if (c.status === 'deleted') flags.push({ kind: 'delete', path: c.path })
    if (any(DB_PATH, c.path)) flags.push({ kind: 'database', path: c.path })
    if (PKG_FILES.has(base(c.path)) || PKG_FILE_RE.test(base(c.path))) flags.push({ kind: 'packages', path: c.path })
    if (any(SHIP_PATH, c.path)) flags.push({ kind: 'ship', path: c.path })
  }
  for (const command of commands) {
    if (any(DELETE_CMD, command)) flags.push({ kind: 'delete', command })
    if (any(DB_CMD, command)) flags.push({ kind: 'database', command })
    if (any(PKG_CMD, command)) flags.push({ kind: 'packages', command })
    if (any(SHIP_CMD, command)) flags.push({ kind: 'ship', command })
    const paths = outsideTargets(command, root)
    if (paths.length) flags.push({ kind: 'outside', command, paths })
  }
  return flags
}

const unquote = (s) => s.replace(/^["']|["']$/g, '')

function writeTargets(cmd) {
  const t = []
  for (const m of cmd.matchAll(/>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) t.push(unquote(m[1]))
  for (const m of cmd.matchAll(/\b(mv|cp|rm)\s+([^;&|]+)/g)) {
    const args = m[2].trim().split(/\s+/).filter((a) => !a.startsWith('-')).map(unquote)
    if (!args.length) continue
    if (m[1] === 'rm') t.push(...args)
    else t.push(args.at(-1))
  }
  return t
}

const inside = (dir, abs) => {
  const r = relative(dir, abs)
  return !r.startsWith('..') && !isAbsolute(r)
}

// Only absolute, ~ and ../ targets are judged, and nothing after a `cd`: the working directory is
// then unknown, and a wrong "outside" is worse than a missed one.
export function outsideTargets(command, root) {
  if (/(^|[;&|]\s*)cd\s/.test(command)) return []
  const safe = [tmpdir(), '/tmp', '/dev'].map((p) => resolve(p))
  const out = []
  for (const t of writeTargets(command)) {
    if (!(isAbsolute(t) || t.startsWith('~') || t.startsWith('..'))) continue
    if (t.startsWith('/dev/') || t === '/dev/null' || t === '/dev/stdout' || t === '/dev/stderr') continue
    const abs = resolve(root, t.startsWith('~') ? homedir() + t.slice(1) : t)
    if (inside(root, abs) || safe.some((s) => inside(s, abs))) continue
    out.push(t)
  }
  return out
}
