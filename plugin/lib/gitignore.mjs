import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Never tracked, whatever .gitignore says.
export const ALWAYS_IGNORED = ['.git', 'node_modules']

const escapeRe = (c) => c.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')

function globToRegex(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '\\' && i + 1 < glob.length) re += escapeRe(glob[++i]) // \# \! \* … are literal
    else if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '[' && glob.indexOf(']', i + 2) > i) {
      // [abc], [a-z], [!x] / [^x]: one character, never a slash. An unclosed [ stays literal.
      const end = glob.indexOf(']', i + 2)
      let body = glob.slice(i + 1, end)
      const not = body[0] === '!' || body[0] === '^'
      if (not) body = body.slice(1)
      re += `[${not ? '^/' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`
      i = end
    } else re += escapeRe(c)
  }
  return re
}

// ignoreCase: git's core.ignorecase, true by default on Windows and macOS.
export function parseGitignore(text, { ignoreCase = false } = {}) {
  const rules = []
  for (let line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    line = line.replace(/\s+$/, '')
    let negate = false
    if (line.startsWith('!')) { negate = true; line = line.slice(1) }
    let dirOnly = false
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1) }
    const anchored = line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    const body = globToRegex(line)
    rules.push({ negate, dirOnly, regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`, ignoreCase ? 'i' : '') })
  }
  return rules
}

// Every directory's .gitignore counts, as in git: its patterns are relative to that directory and
// apply only beneath it, and a deeper file's rules are checked after a shallower one's, so the
// deeper wins. Each directory's file is read once, when a path beneath it is first asked about.
// read(dir) returns that directory's .gitignore text; by default from disk, but a caller can read the
// rules as they were at some earlier moment (a turn's start manifest).
export function loadIgnore(root, platform = process.platform, read = (dir) => readFileSync(join(root, dir, '.gitignore'), 'utf8')) {
  const ignoreCase = platform === 'win32' || platform === 'darwin'
  const cache = new Map()
  const rulesOf = (dir) => {
    if (!cache.has(dir)) {
      let rules = []
      try { rules = parseGitignore(read(dir), { ignoreCase }) } catch {}
      cache.set(dir, rules)
    }
    return cache.get(dir)
  }
  return (rel, isDir) => {
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (ALWAYS_IGNORED.includes(ignoreCase ? name.toLowerCase() : name)) return true
    let ignored = false
    const segs = rel.split('/')
    for (let depth = 0; depth < segs.length; depth++) {
      const dir = segs.slice(0, depth).join('/')
      const sub = segs.slice(depth).join('/')
      for (const r of rulesOf(dir)) {
        if (r.dirOnly && !isDir) continue
        if (r.regex.test(sub)) ignored = !r.negate
      }
    }
    return ignored
  }
}

export function makeIsTracked(root, platform = process.platform, read = undefined) {
  const ignore = loadIgnore(root, platform, read)
  return (rel) => {
    const segs = rel.split('/')
    for (let i = 0; i < segs.length; i++) {
      if (ignore(segs.slice(0, i + 1).join('/'), i < segs.length - 1)) return false
    }
    return true
  }
}
