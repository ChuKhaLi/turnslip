import { posix, win32 } from 'node:path'

export const RECEIPT_INSTRUCTION =
  'End your final reply with exactly one line of the form ' +
  '<receipt>one plain-language sentence of what you did | files: comma-separated paths you changed, or none</receipt>. ' +
  'List every file you changed, including through shell commands.'

// Anchored to a line of its own: a mention of the tag inside prose must not start a match.
const RECEIPT_LINE = /^[ \t>*_`-]*<receipt>([^<\n]*)<\/receipt>[ \t*_`.\r]*$/gm

// The screen's copy of a reply without its receipt lines (a blank line just before one goes too, so
// no gap is left), or null when it holds none. The same anchored pattern as parseReceipt: what Stop
// reads is what the screen hides, and a mention in prose stays visible.
const RECEIPT_ONE = new RegExp(RECEIPT_LINE.source)
export function hideReceipt(text) {
  const out = []
  let hid = false
  for (const line of String(text ?? '').split('\n')) {
    if (!RECEIPT_ONE.test(line)) { out.push(line); continue }
    hid = true
    if (out.length && !out.at(-1).trim()) out.pop()
  }
  return hid ? out.join('\n') : null
}

export function parseReceipt(text) {
  let last = null
  for (const m of String(text ?? '').matchAll(RECEIPT_LINE)) last = m[1]
  if (last === null) return null
  const at = last.lastIndexOf('| files:')
  const sentence = (at < 0 ? last : last.slice(0, at)).trim()
  if (at < 0) return { sentence, files: null }
  const raw = last.slice(at + '| files:'.length).trim()
  const files = /^none\.?$/i.test(raw) ? [] : claims(raw)
  return { sentence, files }
}

// Splits on commas outside parentheses, drops a trailing remark (" (new)", " (not checked)") but keeps
// a name's own number (" (1)"), and drops a claim left with an unmatched parenthesis: a remark taken
// for a path would report a file Claude never named.
function claims(raw) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of raw) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  return parts
    .map((s) => s.trim().replace(/\s+\((?!\d+\))[^()]*\)$/, '').trim().replace(/^[`'"]|[`'"]$/g, ''))
    .filter((s) => s && (s.match(/\(/g) ?? []).length === (s.match(/\)/g) ?? []).length)
}

function norm(p, root, platform) {
  const path = platform === 'win32' ? win32 : posix
  let s = p
  if (path.isAbsolute(s)) s = path.relative(root, s)
  return s.replace(/\\/g, '/').replace(/^\.\//, '')
}

// isTracked(rel) says whether turnslip could have seen the path change at all; a claim about an
// ignored path (node_modules/, a .gitignored build dir) is neither confirmed nor contradicted.
export function compareClaims({ changes, files, root, isTracked, platform = process.platform }) {
  if (files === null) return { unmentioned: [], claimedUnchanged: [] }
  const key = (p) => (platform === 'win32' ? p.toLowerCase() : p)
  // isTracked gets the claim in its own case: .gitignore patterns are case-sensitive on Linux.
  const rels = files.map((f) => norm(f, root, platform))
  const claims = rels.map(key)
  const covered = (p) => claims.some((c) => c === key(p) || c.endsWith('/') && key(p).startsWith(c) || key(p).startsWith(c + '/'))
  const unmentioned = changes.filter((c) => !covered(c.path)).map((c) => c.path)
  const changed = new Set(changes.map((c) => key(c.path)))
  const claimCovers = (i) => changes.some((ch) => {
    const c = claims[i]
    return c === key(ch.path) || c.endsWith('/') && key(ch.path).startsWith(c) || key(ch.path).startsWith(c + '/')
  })
  const claimedUnchanged = files.filter((_, i) => {
    const c = claims[i]
    return !c.endsWith('/') && !c.startsWith('..') && isTracked(rels[i]) && !changed.has(c) && !claimCovers(i)
  })
  return { unmentioned, claimedUnchanged }
}
