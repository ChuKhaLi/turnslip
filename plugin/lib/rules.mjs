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

// Text that only names a command is not that command: a commit message, a PR body, an echo into a
// note, a heredoc or a PowerShell here-string written to a file (a commit message raised a 📦 on
// 2026-10-04). It is blanked before the command rules read the line, but only where it cannot run:
// a heredoc only when cat, tee, git or gh reads it (never psql, python, bash, ssh, sudo …), and
// nothing that holds a command substitution the shell would expand. A quoted bash -c "…" or
// psql -c "…" is no message or print argument, so it is never blanked.
const INERT = /^(?:cat|tee|git|gh)$/i
const HEREDOC = /(<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\2[^\n]*\n)([\s\S]*?)(\n[ \t]*\3[ \t]*(?=\n|$)|$)/g
const HERE_STRING = /@(['"])\r?\n([\s\S]*?)\r?\n\1@/g
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g
const MESSAGE_ARG = /(\s(?:-m|-b|-t|--message|--body|--title|--notes|--subject)(?:\s+|=))("(?:[^"\\]|\\.)*"|'[^']*')/g
const PRINT_CMD = /\b(echo|printf|Write-Host|Write-Output)\b([^;&|<>\n]*)/gi
const SUBST = /\$\(|\x60/

// The program a statement starts with, path and .exe dropped.
const program = (statement) => (statement.trim().split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '')
// Single quotes never expand; double quotes (and an unquoted heredoc) expand $( ) and backticks.
const blank = (q) => (q.startsWith("'") ? "''" : SUBST.test(q) ? q : '""')

// Text piped on (`| bash`) or sent into a process substitution (`> >(sh)`, `tee >(bash)`) runs after
// all, so its statement is checked whole; `||` is no pipe.
const RUNS_ON = /(?<!\|)\|(?!\|)|[<>]\(/
const STATEMENT_END = /\n|;|&&|\|\|/
const HEREDOC_OPEN = /^<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/

// The levels the end of `prefix` sits in, outermost first: the top level, then each quote, $( ),
// backtick or parenthesis still open, each with its statement so far (for a level that holds
// another, up to where that one opens). Heredoc bodies are skipped. Null inside a heredoc body.
export function levels(prefix) {
  const stack = [{ kind: 'top', start: 0, open: 0 }]
  const push = (kind, at, start) => stack.push({ kind, open: at, start })
  const pending = []
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i]
    const top = stack.at(-1).kind
    if (top === "'") { if (c === "'") stack.pop(); continue }
    if (c === '\\') { i++; continue }
    if (top === '"') {
      if (c === '"') stack.pop()
      else if (c === '`') push('`', i, i + 1)
      else if (c === '$' && prefix[i + 1] === '(') { push('(', i, i + 2); i++ }
      continue
    }
    if (c === "'" || c === '"') push(c, i, i + 1)
    else if (c === '`') { if (top === '`') stack.pop(); else push('`', i, i + 1) }
    else if (c === '$' && prefix[i + 1] === '(') { push('(', i, i + 2); i++ }
    else if (c === '(') push('(', i, i + 1)
    else if (c === ')') { if (top === '(') stack.pop() }
    else if (c === '<' && prefix[i + 1] === '<' && prefix[i + 2] !== '<' && HEREDOC_OPEN.test(prefix.slice(i))) {
      const m = HEREDOC_OPEN.exec(prefix.slice(i))
      pending.push(m[2])
      i += m[0].length - 1
    } else if (c === '\n' && pending.length) {
      for (const tag of pending.splice(0)) {
        const end = new RegExp(`\\n[ \\t]*${tag}[ \\t]*(?=\\n|$)`).exec(prefix.slice(i))
        if (!end) return null
        i += end.index + end[0].length
      }
      i-- // the newline after the terminator is read next
    } else {
      const sep = STATEMENT_END.exec(prefix.slice(i, i + 2))
      if (sep?.index === 0) { i += sep[0].length - 1; stack.at(-1).start = i + 1 }
    }
  }
  return stack.map((l, k) => ({ kind: l.kind, statement: prefix.slice(l.start, k + 1 < stack.length ? stack[k + 1].open : prefix.length) }))
}

// Text at the end of `prefix` cannot run when every statement around it (a quoted string is judged
// by the statement it is an argument of) starts with a program that only reads or records text (`git commit -m "$(cat <<'EOF'`,
// the way Claude Code writes commit messages), none of them piping on. `own` judges the innermost
// statement; `after` is what follows the text on its line, which a nested text's pipe sits in.
const RECORDS = /^(?:cat|tee|git|gh|echo|printf|Write-Host|Write-Output)$/i
function cannotRun(prefix, own, after) {
  const ls = levels(prefix)
  if (!ls) return false
  const statements = ls.filter((l) => l.kind !== '"' && l.kind !== "'").map((l) => l.statement)
  const outer = statements.slice(0, -1)
  if (outer.some((s) => !RECORDS.test(program(s)) || RUNS_ON.test(s))) return false
  if (outer.length && RUNS_ON.test(after)) return false
  return own(statements.at(-1))
}

export function commandText(cmd) {
  const out = String(cmd)
    .replace(HEREDOC, (m, open, q, tag, body, close, at, all) => {
      const after = all.slice(at + m.length).replace(/^\n/, '').split('\n')[0]
      const own = (s) => INERT.test(program(s)) && !RUNS_ON.test(s + open)
      return (q === "'" || !SUBST.test(body)) && cannotRun(all.slice(0, at), own, after) ? open + close : m
    })
    .replace(HERE_STRING, (m, q, body) => (q === "'" || !SUBST.test(body) ? "''" : m))
    .replace(MESSAGE_ARG, (m, flag, q) => flag + blank(q))
  // A print is text only when it starts its statement: after `eval` or `x=$(`, or inside
  // `bash -c "…"`, its output may run.
  return out.replace(PRINT_CMD, (m, verb, args, at, all) => {
    const rest = all.slice(at + m.length)
    const own = (s) => !s.trim() && !RUNS_ON.test(rest.split(STATEMENT_END)[0])
    return cannotRun(all.slice(0, at), own, rest.split('\n')[0]) ? verb + args.replace(QUOTED, blank) : m
  })
}

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
    const text = commandText(command)
    if (any(DELETE_CMD, text)) flags.push({ kind: 'delete', command })
    if (any(DB_CMD, text)) flags.push({ kind: 'database', command })
    if (any(PKG_CMD, text)) flags.push({ kind: 'packages', command })
    if (any(SHIP_CMD, text)) flags.push({ kind: 'ship', command })
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
