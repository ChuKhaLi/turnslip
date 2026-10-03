export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function list(paths, max = 3) {
  return paths.length <= max ? paths.join(', ') : `${paths.slice(0, max).join(', ')} +${paths.length - max} more`
}

// What may never reach a printed line: C0 controls, DEL, NEL, the Unicode line and paragraph
// separators, and the bidi marks and overrides that could reorder what the reader sees.
export const UNSAFE = /[\u0000-\u001f\u007f\u0085\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

// Cuts count characters, not UTF-16 units, so an emoji is never split in half.
const cut = (s, max) => Array.from(s).slice(0, max).join('')

export function shortCmd(cmd, max = 40) {
  const s = String(cmd ?? '').replace(/\s+/g, ' ').trim()
  return Array.from(s).length > max ? `${cut(s, max - 1)}…` : s
}

export function cleanSentence(s) {
  if (s == null) return null
  const t = String(s).replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return t ? cut(t, 120) : null
}

const SIMPLE = {
  secret: (fs) => `🔑 key added in ${list([...new Set(fs.map((f) => f.path))])}`,
  delete: (fs) => {
    const files = fs.filter((f) => f.path).length
    return files ? `🗑 ${plural(files, 'file')} deleted` : '🗑 ran a delete command'
  },
  database: () => '🗄 database change',
  ship: () => '🚀 pushed or deployed',
  outside: () => '⚠ changed files outside the project (undo cannot restore them)',
  packages: () => '📦 packages changed',
}
const ORDER = ['secret', 'delete', 'database', 'ship', 'outside', 'packages']
const EMOJI = { delete: '🗑', database: '🗄', packages: '📦', ship: '🚀', outside: '⚠' }

// The slip's flag wording, shared with /turnslip:history.
export function simpleFlagParts(flags) {
  return ORDER.flatMap((kind) => {
    const fs = flags.filter((f) => f.kind === kind)
    return fs.length ? [SIMPLE[kind](fs)] : []
  })
}

// For the session report: where a flag points, never a command's text, which can hold a secret.
export function reportFlag(f) {
  if (f.kind === 'secret') return `🔑 ${f.path}${f.line ? `:${f.line}` : ''}`
  // A command's outside paths are pieces of its text (spec: a command flag shows its kind only).
  if (f.kind === 'outside') return f.command ? '⚠ changed files outside the project' : `⚠ outside the project: ${f.path}`
  if (f.path) return `${EMOJI[f.kind]} ${f.path}`
  return SIMPLE[f.kind]([f])
}

// One line: VS Code prefixes every line of a systemMessage with "Stop says:" (spike §6).
export function renderSlip(slip, mode = 'simple') {
  const { changes, flags } = slip
  if (!changes.length && !flags.length) return ''
  const parts = ['turnslip']
  if (mode === 'detailed') {
    for (const ch of changes.slice(0, 6)) {
      const counts = ch.plus == null ? ' (binary)' : ` +${ch.plus} −${ch.minus}`
      parts.push(`${ch.path}${counts}${ch.source === 'shell' ? ' (shell)' : ''}${ch.status === 'deleted' ? ' (deleted)' : ''}`)
    }
    if (changes.length > 6) parts.push(`+${changes.length - 6} more`)
    for (const f of flags) {
      parts.push(f.kind === 'secret' ? `🔑 ${f.path}${f.line ? `:${f.line}` : ''}` : `${EMOJI[f.kind]} ${f.path ?? shortCmd(f.command)}`)
    }
    if (slip.unmentioned.length) parts.push(`unmentioned: ${list(slip.unmentioned)}`)
    if (slip.claimedUnchanged.length) parts.push(`claimed, unchanged: ${list(slip.claimedUnchanged)}`)
  } else {
    parts.push(cleanSentence(slip.sentence) ?? 'Claude gave no summary')
    if (changes.length) parts.push(plural(changes.length, 'file'))
    parts.push(...simpleFlagParts(flags))
    if (slip.unmentioned.length) parts.push(`not mentioned: ${list(slip.unmentioned)}`)
    if (slip.claimedUnchanged.length) parts.push(`said but not changed: ${list(slip.claimedUnchanged)}`)
  }
  if (slip.light) parts.push('shell changes not tracked yet')
  if (changes.length) parts.push('/turnslip:undo') // plugin commands are known only by their namespaced name (spike §9)
  const output = parts.join(' · ')
  return output.replace(UNSAFE, ' ')
}
