import { basename } from 'node:path'
import { projectDir } from './paths.mjs'
import { cleanSentence, plural, reportFlag, simpleFlagParts, UNSAFE } from './render.mjs'
import { listTurnIds, loadTurn } from './turns.mjs'

// One printed line: a file name or a sentence can hold any text, and must never start a new line.
export const oneLine = (s) => String(s).replace(UNSAFE, ' ')

export function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

// /turnslip:history: one line per turn, numbered as /turnslip:undo <n> counts them.
export function formatHistory(turns, { total = turns.length, ids = false, now = Date.now() } = {}) {
  if (!turns.length) return 'turnslip · no turns with changes in this project yet'
  const lines = [`turnslip · history (${turns.length} of ${total})`]
  turns.forEach((t, i) => {
    const sentence = `${cleanSentence(t.slip?.sentence) ?? 'Claude gave no summary'}${t.interrupted ? ' (interrupted)' : ''}`
    const parts = [String(i + 1), ago(t.startedAt, now), sentence, plural(t.changes.length, 'file'), ...simpleFlagParts(t.flags ?? [])]
    if (ids) parts.push(`id ${t.id}`)
    lines.push(oneLine(parts.join(' · ')))
  })
  return lines.join('\n')
}

// Local time with its offset, so the report matches the user's clock: 2026-10-02 16:00 (UTC+7).
function stamp(iso) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return String(iso)
  const p = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const zone = `UTC${off < 0 ? '-' : '+'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${p(Math.abs(off) % 60)}` : ''}`
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${zone})`
}

function fileNote(c) {
  const counts = c.plus == null ? '' : ` +${c.plus} −${c.minus}`
  return `${c.status} ${c.path}${counts}${c.source ? ` (${c.source})` : ''}`
}

// /turnslip:report: the facts Claude builds the report page from. Paths, counts and flag kinds only:
// never file contents, never a command line (it can hold a secret).
export function reportData({ home, root, sessionId }) {
  const pdir = projectDir(home, root)
  const all = listTurnIds(pdir).map((id) => loadTurn(pdir, id))
    .filter((t) => t?.finished && t.sessionId === sessionId && (t.changes?.length || t.flags?.length))
  if (!all.length) return 'turnslip · nothing to report in this session yet'
  const turns = all.slice(-50)
  const files = new Set(all.flatMap((t) => (t.changes ?? []).map((c) => c.path)))
  const counts = {}
  for (const t of all) for (const f of t.flags ?? []) counts[f.kind] = (counts[f.kind] ?? 0) + 1
  const flagSummary = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'
  const lines = [
    'turnslip · report data',
    `project: ${basename(root)}`,
    `session: ${stamp(all[0].startedAt)} to ${stamp(all.at(-1).startedAt)}`,
    `turns: ${all.length}${all.length > turns.length ? ` (the last ${turns.length} shown)` : ''} · files changed: ${files.size} · flags: ${flagSummary}`,
  ]
  turns.forEach((t, i) => {
    lines.push('---', `turn ${i + 1} · ${stamp(t.startedAt)} · ${cleanSentence(t.slip?.sentence) ?? 'Claude gave no summary'}`)
    const ch = t.changes ?? []
    if (ch.length) lines.push(`  files: ${ch.slice(0, 30).map(fileNote).join('; ')}${ch.length > 30 ? `; +${ch.length - 30} more` : ''}`)
    if (t.flags?.length) lines.push(`  flags: ${t.flags.map(reportFlag).join('; ')}`)
    if (t.slip?.unmentioned?.length) lines.push(`  not mentioned: ${t.slip.unmentioned.join(', ')}`)
    if (t.slip?.claimedUnchanged?.length) lines.push(`  claimed but unchanged: ${t.slip.claimedUnchanged.join(', ')}`)
    if (t.interrupted) lines.push('  interrupted')
    if (t.kind === 'undo') {
      const undone = t.undoes ? loadTurn(pdir, t.undoes) : null
      lines.push(`  undo of ${undone ? stamp(undone.startedAt) : 'an earlier turn'}`)
    }
  })
  return lines.map(oneLine).join('\n')
}
