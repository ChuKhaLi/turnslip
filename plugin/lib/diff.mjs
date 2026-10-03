export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0)
}

export function diffManifests(start, end) {
  const out = []
  for (const [path, after] of Object.entries(end)) {
    const before = Object.hasOwn(start, path) ? start[path] : undefined
    if (before === undefined) out.push({ path, status: 'added', before: null, after })
    else if (before !== after) out.push({ path, status: 'modified', before, after })
  }
  for (const [path, before] of Object.entries(start)) {
    if (!Object.hasOwn(end, path)) out.push({ path, status: 'deleted', before, after: null })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function lines(buf) {
  if (!buf || !buf.length) return []
  // A BOM is not content, and a lone \r (old Mac) ends a line like \n and \r\n do.
  const l = buf.toString('utf8').replace(/^﻿/, '').split(/\r\n|\r|\n/)
  if (l.at(-1) === '') l.pop()
  return l
}

// Multiset comparison: cheap and order-insensitive. A moved line counts as unchanged, which
// undercounts but never invents a change.
export function lineStats(beforeBuf, afterBuf) {
  if ((beforeBuf && isBinary(beforeBuf)) || (afterBuf && isBinary(afterBuf))) return { plus: null, minus: null, added: [] }
  const pool = new Map()
  for (const l of lines(beforeBuf)) pool.set(l, (pool.get(l) ?? 0) + 1)
  const added = []
  lines(afterBuf).forEach((text, i) => {
    const n = pool.get(text) ?? 0
    if (n > 0) pool.set(text, n - 1)
    else added.push({ no: i + 1, text })
  })
  let minus = 0
  for (const n of pool.values()) minus += n
  return { plus: added.length, minus, added }
}
