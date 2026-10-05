import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, PAGES, read, SITE, tokens } from './site-helpers.mjs'

const CSS = 'style.v2.css'

// [foreground, background, floor]. 4.5 for text, 3.0 for a boundary that carries meaning.
const PAIRS = [
  ['--fg', '--bg', 4.5], ['--fg', '--card', 4.5], ['--head', '--bg', 4.5],
  ['--muted', '--bg', 4.5], ['--muted', '--card', 4.5],
  ['--link', '--bg', 4.5], ['--link', '--card', 4.5], ['--callout', '--bg', 4.5],
  ['--focus', '--bg', 3], ['--focus', '--card', 3],
  ['--control-edge', '--bg', 3], ['--control-edge', '--card', 3],
  ['--on-primary', '--primary', 4.5], ['--on-primary', '--primary-hover', 4.5],
  ['--cc-fg', '--term', 4.5], ['--cc-dim', '--term', 4.5], ['--cc-file', '--term', 4.5],
  ['--cc-reply', '--term', 4.5], ['--cc-tool', '--term', 3],
]

test('every declared pair clears its floor in both themes', () => {
  const t = tokens(read(CSS))
  for (const theme of ['light', 'dark']) {
    for (const [fg, bg, floor] of PAIRS) {
      const a = t[theme].get(fg), b = t[theme].get(bg)
      assert.ok(a && b, `${theme}: ${fg} or ${bg} is not defined`)
      const c = contrast(a, b)
      assert.ok(c >= floor, `${theme}: ${fg} ${a} on ${bg} ${b} is ${c.toFixed(2)}, needs ${floor}`)
    }
  }
})

test('the terminal stands off the page: dark ink on paper, a carbon frame on the dark ground', () => {
  const t = tokens(read(CSS))
  assert.ok(contrast(t.light.get('--term'), t.light.get('--bg')) >= 3)
  assert.ok(contrast(t.dark.get('--term-frame'), t.dark.get('--bg')) >= 3)
})

test('the drawn terminal uses the colours Claude Code prints (spike §15)', () => {
  const t = tokens(read(CSS))
  for (const theme of ['light', 'dark']) {
    assert.equal(t[theme].get('--cc-dim').toUpperCase(), '#999999')
    assert.equal(t[theme].get('--cc-tool').toUpperCase(), '#4EBA65')
    assert.equal(t[theme].get('--cc-reply').toUpperCase(), '#FFFFFF')
    assert.equal(t[theme].get('--cc-file').toUpperCase(), '#B1B9F9')
  }
})

test('colours appear only in custom property declarations', () => {
  const lines = read(CSS).split('\n')
  const stray = lines.filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(l) && !/^\s*--[\w-]+\s*:/.test(l))
  assert.deepEqual(stray, [])
})

test('no green token', () => {
  const t = tokens(read(CSS))
  const green = [...t.light.keys()].filter((k) => /green/i.test(k))
  assert.deepEqual(green, [])
})

test('every @font-face file exists, is versioned, and the OFL licence ships with them', () => {
  const css = read('style.v2.css')
  const urls = [...css.matchAll(/url\("?(\/fonts\/[^")]+)"?\)/g)].map((m) => m[1])
  assert.equal(urls.length, 3)
  for (const u of urls) {
    assert.ok(existsSync(join(SITE, u)), `${u} is missing`)
    assert.match(u, /\.v\d+\.woff2$/)
  }
  assert.ok(existsSync(join(SITE, 'fonts', 'OFL.txt')))
  const total = readdirSync(join(SITE, 'fonts')).filter((f) => f.endsWith('.woff2'))
    .reduce((n, f) => n + statSync(join(SITE, 'fonts', f)).size, 0)
  assert.ok(total < 80_000, `fonts are ${total} bytes`)
})

const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

test('the home page states the facts the Dodo form will repeat', () => {
  const t = text(read('index.html'))
  for (const s of ['$19', '$29', 'No subscription.', '14 days', 'up to 3 machines', 'Dodo Payments',
    'merchant of record', 'support@turnslip.dev', 'turnslip, by ChuKhaLi', '© 2026 ChuKhaLi', 'FSL-1.1-MIT',
    '/turnslip:activate', 'Buy Pro', 'Try history, undo of an earlier turn and the session report free, 3 runs in all, before you buy.', 'one-time until 5 November 2026, then']) {
    assert.ok(t.includes(s), `index.html does not say "${s}"`)
  }
})

test("the key flag is described as the rule fires: any file .gitignore doesn't exclude, or a new .env (rules.mjs)", () => {
  const t = text(read('index.html'))
  assert.doesNotMatch(t, /tracked file/)
  assert.ok(t.includes("a key written to a file your .gitignore doesn't exclude, or a new .env"))
})

test('Cloudflare email obfuscation is switched off around every support address', () => {
  for (const p of PAGES) {
    const html = read(p)
    const on = html.indexOf('<!--email_off-->'), off = html.lastIndexOf('<!--/email_off-->')
    assert.ok(on >= 0 && off > on, `${p}: no email_off block`)
    for (const m of html.matchAll(/support@turnslip\.dev/g)) assert.ok(m.index > on && m.index < off, `${p}: an address outside email_off`)
  }
})

test('the install commands are exact and copyable', () => {
  const html = read('index.html')
  const cmds = [...html.matchAll(/<pre class="cmd"><code>([^<]*)<\/code><\/pre>/g)].map((m) => m[1])
  assert.deepEqual(cmds, ['claude plugin marketplace add ChuKhaLi/turnslip', 'claude plugin install turnslip@turnslip'])
  for (const c of cmds) assert.doesNotMatch(c, /[ ‘’“”]/)
})

test('the drawn terminal ends with the slip, in the slip colour, and the callout points at it', () => {
  const html = read('index.html')
  const term = /<div class="term"[\s\S]*?<\/div>\s*<\/figure>/.exec(html)?.[0] ?? ''
  assert.match(term, /<span class="slip">\s*⎿ {2}Stop says: turnslip · [^<]+· \/turnslip:undo<\/span>/)
  assert.match(html, /<p class="callout"[^>]*>This line is turnslip\./)
  assert.match(read('style.v2.css'), /\.slip\s*{[^}]*color:\s*var\(--cc-dim\)/)
})

// Spec §6: Claude Code no longer shows the receipt line (a MessageDisplay hook hides it), so a drawn
// terminal that shows it would be untrue to the screen (design system: a picture of the real thing).
test('the drawn terminals show no receipt line: the reply sits right above the slip', () => {
  for (const f of ['index.html', 'og.html']) {
    const term = /<div class="term"[\s\S]*?<\/div>/.exec(read(f))?.[0] ?? ''
    assert.doesNotMatch(term, /receipt/i, f)
    assert.match(term, /config\.js<\/span>\.\r?\n<span class="slip">/, f)
  }
})

test('the JSON-LD offer matches the launch price', () => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read('index.html'))
  assert.ok(m, 'no JSON-LD')
  const ld = JSON.parse(m[1])
  assert.equal(ld['@type'], 'SoftwareApplication')
  const pro = ld.offers.find((o) => o.name === 'turnslip Pro') // the free core is an offer of its own (test/seo.test.mjs)
  assert.equal(pro.price, '19')
  assert.equal(pro.priceCurrency, 'USD')
})

test('no page carries a style attribute', () => {
  for (const p of PAGES) assert.doesNotMatch(read(p), /\sstyle=/, p)
})

test('the legal pages agree with the home page', () => {
  const terms = text(read('terms.html')), privacy = text(read('privacy.html')), refunds = text(read('refunds.html'))
  assert.ok(refunds.includes('a full refund within 14 days of buying it'))
  assert.ok(terms.includes('a full refund within 14 days of buying Pro'))
  for (const t of [terms, privacy, refunds]) assert.doesNotMatch(t, /\b(?!14\b)\d+ days of buying/)
  assert.ok(terms.includes('up to 3 machines'))
  assert.ok(terms.includes('FSL-1.1-MIT'))
  for (const t of [terms, privacy, refunds]) assert.ok(t.includes('Dodo Payments'))
  for (const t of [terms, refunds]) assert.match(t, /Last updated: 3 October 2026/)
  assert.match(privacy, /Last updated: 4 October 2026/) // the /thanks address paragraph
  assert.ok(privacy.includes('no cookies'))
  assert.ok(privacy.includes('~/.turnslip'))
})

test('every page has the support address and the legal links in its footer', () => {
  for (const p of PAGES) {
    const footer = /<footer class="site">([\s\S]*?)<\/footer>/.exec(read(p))?.[1] ?? ''
    assert.ok(footer.includes('support@turnslip.dev'), `${p} footer has no support address`)
    for (const href of ['/terms', '/privacy', '/refunds']) assert.ok(footer.includes(`href="${href}"`), `${p} footer lacks ${href}`)
  }
})

const CANON = { 'index.html': 'https://turnslip.dev/', 'terms.html': 'https://turnslip.dev/terms',
  'privacy.html': 'https://turnslip.dev/privacy', 'refunds.html': 'https://turnslip.dev/refunds',
  'guides/undo-claude-code-changes.html': 'https://turnslip.dev/guides/undo-claude-code-changes',
  'guides/what-did-claude-code-change.html': 'https://turnslip.dev/guides/what-did-claude-code-change' }

test('every page has a complete head and exactly one h1', () => {
  const titles = new Set()
  for (const p of PAGES) {
    const html = read(p)
    assert.match(html, /<html lang="en">/, p)
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, p)
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1]
    assert.ok(title && !titles.has(title), `${p}: missing or repeated title`); titles.add(title)
    assert.match(html, /<meta name="description" content="[^"]{20,160}">/, p)
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${p}: h1 count`)
    const canon = /<link rel="canonical" href="([^"]+)">/.exec(html)?.[1]
    assert.equal(canon, CANON[p], `${p}: canonical`)
  }
})

test('the sitemap lists exactly the canonical URLs, and robots names it', () => {
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort()
  assert.deepEqual(locs, Object.values(CANON).sort())
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/turnslip\.dev\/sitemap\.xml\r?$/m)
})

test('every internal link and asset resolves to a file in site/', () => {
  const ids = new Set([...read('index.html').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  for (const p of PAGES) {
    for (const [, url] of read(p).matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:)/.test(url)) continue
      const [path, hash] = url.split('#')
      if (hash) assert.ok(ids.has(hash), `${p}: #${hash} has no target on the home page`)
      if (!path) continue
      const file = path === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(path) ? path.slice(1) : `${path.slice(1)}.html`
      assert.ok(existsSync(join(SITE, file)), `${p}: ${url} → ${file} does not exist`)
    }
  }
})

// The one exception (owner, 2026-10-05; design system): /thanks runs its own /thanks.js, nothing else.
const THANKS_SCRIPT = '<script type="module" src="/thanks.js"></script>'
test('nothing loads from another host and no script runs, but /thanks.js on /thanks', () => {
  for (const p of PAGES) {
    const html = p === 'thanks.html' ? read(p).replace(THANKS_SCRIPT, '') : read(p)
    assert.doesNotMatch(html, /<script(?![^>]*type="application\/ld\+json")/, `${p}: a script that runs`)
    assert.doesNotMatch(html, /<link[^>]+rel="(stylesheet|preload|icon)"[^>]+href="https?:/, `${p}: external asset`)
    assert.doesNotMatch(html, /<img[^>]+src="https?:/, `${p}: external image`)
  }
  assert.doesNotMatch(read('style.v2.css'), /@import|url\("?https?:/)
})

test('the social image exists at 1200x630', () => {
  const png = readFileSync(join(SITE, 'og.png'))
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)
  assert.match(read('.assetsignore'), /^og\.html\r?$/m)
})

function headerRules(text) {
  const rules = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: [] })
    else rules.at(-1).headers.push(line.trim())
  }
  return rules
}

test('_headers sets the security headers on every path', () => {
  const all = headerRules(read('_headers')).find((r) => r.path === '/*')
  assert.ok(all, 'no /* rule')
  for (const h of [
    "Content-Security-Policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Strict-Transport-Security: max-age=31536000; includeSubDomains',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=()',
  ]) assert.ok(all.headers.includes(h), `missing: ${h}`)
  assert.ok(!all.headers.some((h) => h.startsWith('Cache-Control')), 'HTML must keep the default revalidation')
})

test('only versioned files are cached as immutable', () => {
  for (const r of headerRules(read('_headers'))) {
    if (!r.headers.some((h) => h.includes('immutable'))) continue
    if (r.path === '/fonts/*') {
      for (const f of readdirSync(join(SITE, 'fonts')).filter((f) => f.endsWith('.woff2'))) assert.match(f, /\.v\d+\.woff2$/)
    } else assert.match(r.path, /\.v\d+\.[a-z0-9]+$/, `${r.path} is immutable but carries no version`)
  }
})

test('wrangler serves site/ with clean URLs and the 404 page', () => {
  const cfg = JSON.parse(readFileSync(join(SITE, '..', 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  assert.equal(cfg.assets.directory, './site')
  assert.equal(cfg.assets.html_handling, 'auto-trailing-slash')
  assert.equal(cfg.assets.not_found_handling, '404-page')
})

test('the 404 says what happened and offers a way back', () => {
  const html = read('404.html')
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.ok(text(html).includes("This page doesn't exist"))
  assert.match(html, /href="\/"/)
})

test('llms.txt follows llmstxt.org: a title, a summary, sections of links that resolve', () => {
  const t = read('llms.txt')
  assert.match(t, /^# turnslip\r?\n\r?\n> \S/)
  assert.ok(/^## /m.test(t))
  const links = [...t.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1])
  assert.ok(links.length >= 5)
  for (const url of links) {
    if (url.startsWith('https://github.com/')) { assert.equal(url, 'https://github.com/ChuKhaLi/turnslip'); continue }
    const path = url.replace(/^https:\/\/turnslip\.dev/, '')
    assert.notEqual(path, url, `${url} is not on turnslip.dev`)
    const file = path === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(path) ? path.slice(1) : `${path.slice(1)}.html`
    assert.ok(existsSync(join(SITE, file)), `${url} has no file`)
  }
})

test('llms.txt repeats the home page facts and the install commands exactly', () => {
  const t = read('llms.txt')
  for (const s of ['$19', '$29', 'No subscription.', '14 days', 'up to 3 machines', 'Dodo Payments', 'FSL-1.1-MIT',
    'support@turnslip.dev', '`claude plugin marketplace add ChuKhaLi/turnslip`', '`claude plugin install turnslip@turnslip`',
    "a key written to a file your .gitignore doesn't exclude, or a new .env", 'Node.js 18', 'Claude Code 2.1.289 or later',
    'Try history, undo of an earlier turn and the session report free, 3 runs in all, before you buy.', 'one-time until 5 November 2026, then']) {
    assert.ok(t.includes(s), `llms.txt does not say "${s}"`)
  }
  // Spec §12.2: the MessageDisplay hook needs 2.1.289; the home page says so too.
  assert.ok(read('index.html').includes('Needs Claude Code 2.1.289 or later'))
})

test('llms.txt explains the receipt check in the words the slip prints (render.mjs)', () => {
  const t = read('llms.txt')
  const render = readFileSync(join(SITE, '..', 'plugin', 'lib', 'render.mjs'), 'utf8')
  const line = '<receipt>one plain-language sentence of what you did | files: comma-separated paths you changed, or none</receipt>'
  assert.ok(readFileSync(join(SITE, '..', 'plugin', 'lib', 'receipt.mjs'), 'utf8').includes(line), 'receipt.mjs changed its instruction')
  assert.ok(t.includes(line))
  for (const s of ['not mentioned: ', 'said but not changed: ', 'Claude gave no summary']) {
    assert.ok(render.includes(s), `render.mjs no longer prints "${s}"`)
    assert.ok(t.includes(s.trim()), `llms.txt does not say "${s.trim()}"`)
  }
})

test('a text file with non-ASCII characters is served as UTF-8 (Cloudflare sends text/plain without a charset)', () => {
  const rules = headerRules(read('_headers'))
  const files = readdirSync(SITE).filter((f) => f.endsWith('.txt') && /[^\x00-\x7f]/.test(read(f)))
  assert.ok(files.includes('llms.txt'))
  for (const f of files) {
    const rule = rules.find((r) => r.path === `/${f}`)
    assert.ok(rule?.headers.includes('Content-Type: text/plain; charset=utf-8'), `/${f} has no UTF-8 Content-Type`)
  }
})

// The mark (owner's pick, 2026-10-04): the corner Claude Code prints before "Stop says:", which the
// slip hangs from, plus the slip's one line. One geometry everywhere.
const MARK_PATH = 'M8 7v17h3'
const MARK_BAR = '<rect x="15" y="21.5" width="11" height="5" rx="2.5"'
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)] }

test('every page header carries the mark beside the name, hidden from screen readers', () => {
  for (const p of PAGES) {
    const brand = /<a class="brand" href="\/">([\s\S]*?)<\/a>/.exec(read(p))?.[1] ?? ''
    assert.match(brand, /^<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">/, p)
    assert.ok(brand.includes(MARK_PATH) && brand.includes(MARK_BAR), `${p}: not the mark`)
    assert.match(brand, /<\/svg>turnslip$/, p)
  }
  assert.match(read(CSS), /\.brand\s*{[^}]*display:\s*inline-flex/)
  assert.match(read(CSS), /\.mark\s*{[^}]*color:\s*var\(--link\)/)
})

test('the favicon is the mark in carbon, lighter on a dark tab', () => {
  const svg = read('favicon.svg')
  assert.ok(svg.includes(MARK_PATH) && svg.includes(MARK_BAR))
  const t = tokens(read(CSS))
  // The tab draws the mark in the link colour of each theme, as the header does.
  assert.ok(svg.includes(t.light.get('--link')), 'light: the link colour')
  assert.match(svg, new RegExp(`prefers-color-scheme: dark\\)[^}]*${t.dark.get('--link')}`), 'dark: the link colour')
})

test('the touch icon and the plugin icon exist at their sizes and are linked', () => {
  assert.deepEqual(pngSize(join(SITE, 'apple-touch-icon.png')), [180, 180])
  for (const p of PAGES) assert.match(read(p), /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/, p)
  const manifest = JSON.parse(readFileSync(join(SITE, '..', 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(manifest.icon, './icon.png')
  assert.deepEqual(pngSize(join(SITE, '..', 'plugin', 'icon.png')), [512, 512])
})

// The buy button sells the product the plugin accepts: the same id as plugin/lib/dodo.mjs IDS.
test('the Pro button links to the Dodo checkout of the product the plugin accepts', async () => {
  const { IDS, checkoutUrl } = await import('../plugin/lib/dodo.mjs')
  const html = read('index.html')
  const url = `https://checkout.dodopayments.com/buy/${IDS.productId}?quantity=1&amp;redirect_url=https%3A%2F%2Fturnslip.dev%2Fthanks`
  assert.ok(html.includes(`<a class="btn btn-primary" href="${url}">Buy Pro, $19</a>`), 'index.html has no buy link for the plugin product')
  assert.equal(checkoutUrl().replace('&', '&amp;'), url, '/turnslip:buy opens another link than the button')
  assert.doesNotMatch(html, /disabled>/)
  assert.doesNotMatch(html, /opens soon/i)
  assert.ok(read('llms.txt').includes(url.replace('&amp;', '&')), 'llms.txt does not give the checkout link')
})

// Dodo sends the buyer to /thanks after paying, with the order (license key and email included) in
// the query string. /thanks.js puts the key in the command; without it the page says where the key is.
test('the thanks page says where the key is and how to activate it, and is not indexed', () => {
  const html = read('thanks.html')
  const t = text(html)
  assert.match(html, /<meta name="robots" content="noindex">/)
  assert.doesNotMatch(html, /rel="canonical"/)
  assert.equal(html.split(THANKS_SCRIPT).length, 2, 'thanks.html loads /thanks.js once')
  assert.match(html, /<code id="activate">\/turnslip:activate &lt;key&gt;<\/code>/)
  assert.match(html, /<p id="paste">/)
  assert.ok(existsSync(join(SITE, 'thanks.js')))
  for (const s of ['Thank you', 'Dodo Payments', 'email', 'spam', '/turnslip:activate <key>', 'up to 3 machines',
    'support@turnslip.dev', '14 days']) assert.ok(t.includes(s), `thanks.html does not say "${s}"`)
  for (const href of ['/#install', '/refunds', 'mailto:support@turnslip.dev']) assert.ok(html.includes(`href="${href}"`), `thanks.html lacks ${href}`)
})

test('the privacy page says the order details reach /thanks in its address', () => {
  const t = text(read('privacy.html'))
  assert.ok(t.includes('turnslip.dev/thanks'))
  assert.ok(t.includes('license key and email address in the page address'))
})

// Dodo returns the buyer to /thanks with the license key and email in the query string: no cache
// (Cloudflare's edge would keep one entry per URL) and no Referer carrying that address onward.
// Cloudflare then sends Referrer-Policy twice (the /* one first; seen with wrangler dev); the
// browser takes the last valid value, no-referrer.
test('/thanks is never cached and sends no Referer', () => {
  const r = headerRules(read('_headers')).find((x) => x.path === '/thanks')
  assert.ok(r, 'no /thanks rule')
  assert.ok(r.headers.includes('Cache-Control: no-store'))
  assert.ok(r.headers.includes('Referrer-Policy: no-referrer'))
})

// /thanks drops the site-wide CSP and Referrer-Policy ("! Name", Cloudflare's detach) and sends its
// own: the same CSP plus script-src 'self' for /thanks.js, and only no-referrer.
test('/thanks has its own CSP: the site one plus script-src self, nothing else loosened', () => {
  const rules = headerRules(read('_headers'))
  const all = rules.find((x) => x.path === '/*').headers.find((h) => h.startsWith('Content-Security-Policy:'))
  const r = rules.find((x) => x.path === '/thanks').headers
  assert.ok(r.includes('! Content-Security-Policy') && r.includes('! Referrer-Policy'))
  const csp = r.filter((h) => h.startsWith('Content-Security-Policy:'))
  assert.deepEqual(csp, [all.replace("default-src 'none';", "default-src 'none'; script-src 'self';")])
})

test('thanks.js takes only a well-formed license_key and email from the address', async () => {
  const { keyFrom } = await import('../site/thanks.js')
  const k = '1baecd51-1d48-47a5-b7eb-b67fc015c897'
  assert.equal(keyFrom(`?payment_id=pay_1&status=succeeded&license_key=${k}&email=a%40b.c`), k)
  for (const q of ['', '?status=succeeded', '?license_key=', '?license_key=short', '?license_key=a%20b%20c%20d%20e',
    '?license_key=%3Cimg%20src%3Dx%3E12345', `?license_key=${'a'.repeat(256)}`]) assert.equal(keyFrom(q), null, q)
  const { emailFrom } = await import('../site/thanks.js')
  assert.equal(emailFrom('?license_key=x&email=snow.worm%2Btag%40gmail.com'), 'snow.worm+tag@gmail.com')
  for (const q of ['', '?email=', '?email=nobody', '?email=a%20b%40c.d', '?email=%3Cb%3E%40x.y', '?email=a%40b%40c',
    `?email=${'a'.repeat(250)}%40b.cd`]) assert.equal(emailFrom(q), null, q)
  assert.match(read('thanks.html'), /to <span id="email">the address you paid with<\/span>\./)
  const src = read('thanks.js')
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|fetch\(|XMLHttpRequest|eval\(/)
  assert.match(src, /history\.replaceState/)
  // The filled email is bold (a strong made in the DOM, its text set as text); unfilled, it reads plain.
  assert.match(src, /createElement\('strong'\)/)
  assert.match(src, /replaceChildren\(/)
  // A Copy button for the filled command (owner, 2026-10-05): hidden until the key is there, so a page
  // without JavaScript or without a key shows no dead button; it copies text only.
  assert.match(read('thanks.html'), /<button type="button" id="copy" class="btn btn-secondary" hidden>Copy<\/button>/)
  assert.match(src, /navigator\.clipboard\.writeText\(/)
  assert.match(src, /\.hidden = false/)
})
