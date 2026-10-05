// The site's one script (owner, 2026-10-05; design system): Dodo Payments returns the buyer to /thanks
// with the license key in the address. Put it in the activate command, then take the order details
// out of the address bar and the history; the email it was sent to goes in the first paragraph. No
// network, no HTML from the address: text only.
const KEY_RE = /^[A-Za-z0-9_-]{8,255}$/ // plugin/lib/license.mjs KEY_RE

export function keyFrom(search) {
  const key = new URLSearchParams(search).get('license_key')
  return key && KEY_RE.test(key) ? key : null
}

// Shown back to the buyer only, as text: one @, no spaces or angle brackets, at most 254 characters.
export function emailFrom(search) {
  const email = new URLSearchParams(search).get('email')
  return email && email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : null
}

if (typeof document !== 'undefined') {
  const email = emailFrom(location.search)
  if (email) { // bold, so the buyer sees at once whether it is their address
    const strong = document.createElement('strong')
    strong.textContent = email
    document.getElementById('email').replaceChildren(strong)
  }
  const key = keyFrom(location.search)
  if (key) {
    const command = `/turnslip:activate ${key}`
    document.getElementById('activate').textContent = command
    const copy = document.getElementById('copy')
    copy.hidden = false
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(command).then(
        () => { copy.textContent = 'Copied' },
        () => { copy.textContent = 'Select the line above and copy it' })
    })
    document.getElementById('paste').textContent = 'That is your key. The email from Dodo Payments has it too: keep it for your other machines.'
  }
  if (location.search) history.replaceState(null, '', location.pathname)
}
