// Opens a URL in the default browser for /turnslip:buy. No shell: the URL holds '&', so it goes to the
// platform's opener as one argument. Never throws; false when the opener could not start (the caller
// prints the URL either way). Not network code: the browser does the fetching.
import { spawn as nodeSpawn } from 'node:child_process'

export function openUrl(url, { platform = process.platform, spawn = nodeSpawn } = {}) {
  const [cmd, args] = platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {}) // xdg-open missing: the printed link still works
    child.unref()
    return true
  } catch {
    return false
  }
}
