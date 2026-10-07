import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site')
export const read = (rel) => readFileSync(join(SITE, rel), 'utf8')
export const PAGES = ['index.html', 'terms.html', 'privacy.html', 'refunds.html', '404.html', 'thanks.html',
  'guides.html', 'guides/claude-code-deleted-my-files.html', 'guides/stop-claude-code-destructive-commands.html',
  'guides/what-rewind-misses.html', 'guides/claude-code-api-key-in-code.html',
  'guides/undo-claude-code-changes.html', 'guides/what-did-claude-code-change.html']

// The declarations inside the first `:root { … }` that follows `from` in the text.
function rootBlock(css, from = 0) {
  const start = css.indexOf(':root', from)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

function decls(block) {
  const out = new Map()
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim())
  return out
}

function resolve(map) {
  const get = (v, depth = 0) => {
    const m = /^var\((--[\w-]+)\)$/.exec(v)
    if (!m || depth > 8) return v
    return get(map.get(m[1]) ?? v, depth + 1)
  }
  return new Map([...map].map(([k, v]) => [k, get(v)]))
}

export function tokens(css) {
  const light = decls(rootBlock(css))
  const media = css.indexOf('@media (prefers-color-scheme: dark)')
  const dark = new Map([...light, ...(media < 0 ? [] : decls(rootBlock(css, media)))])
  return { light: resolve(light), dark: resolve(dark) }
}

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
function luminance(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
