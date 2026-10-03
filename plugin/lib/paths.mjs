import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, resolve } from 'node:path'

export function turnslipHome(env = process.env) {
  return env.TURNSLIP_HOME ? resolve(env.TURNSLIP_HOME) : join(homedir(), '.turnslip')
}

// Windows paths compare case-insensitively; everything stored uses forward slashes.
export function normalizeAbs(p, platform = process.platform) {
  const s = (platform === 'win32' ? p : resolve(p)).replace(/\\/g, '/')
  return platform === 'win32' ? s.toLowerCase().replace(/\/$/, '') || '/' : s
}

export function projectId(root, platform = process.platform) {
  return createHash('sha1').update(normalizeAbs(root, platform)).digest('hex').slice(0, 16)
}

export function projectDir(home, root) {
  return join(home, 'projects', projectId(resolve(root)))
}

// A root that is the home directory or a filesystem root would mean snapshotting the whole disk.
export function isTrackableRoot(root, home = homedir(), platform = process.platform) {
  const r = normalizeAbs(resolve(root), platform)
  if (r === normalizeAbs(resolve(home), platform)) return false
  return normalizeAbs(parse(resolve(root)).root, platform) !== r
}

export function toRel(root, target) {
  const abs = isAbsolute(target) ? target : resolve(root, target)
  return relative(root, abs).replace(/\\/g, '/')
}
