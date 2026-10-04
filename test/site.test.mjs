import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, PAGES, read, SITE, tokens } from './site-helpers.mjs'

const CSS = 'style.v1.css'

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
  const css = read('style.v1.css')
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
    '/turnslip:activate', 'Checkout opens soon']) {
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
  assert.match(read('style.v1.css'), /\.slip\s*{[^}]*color:\s*var\(--cc-dim\)/)
})

test('the JSON-LD offer matches the launch price', () => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read('index.html'))
  assert.ok(m, 'no JSON-LD')
  const ld = JSON.parse(m[1])
  assert.equal(ld['@type'], 'SoftwareApplication')
  assert.equal(ld.offers.price, '19')
  assert.equal(ld.offers.priceCurrency, 'USD')
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
  for (const t of [terms, privacy, refunds]) {
    assert.ok(t.includes('Dodo Payments'))
    assert.match(t, /Last updated: 3 October 2026/)
  }
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
  'privacy.html': 'https://turnslip.dev/privacy', 'refunds.html': 'https://turnslip.dev/refunds' }

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

test('nothing loads from another host and no script runs', () => {
  for (const p of PAGES) {
    const html = read(p)
    assert.doesNotMatch(html, /<script(?![^>]*type="application\/ld\+json")/, `${p}: a script that runs`)
    assert.doesNotMatch(html, /<link[^>]+rel="(stylesheet|preload|icon)"[^>]+href="https?:/, `${p}: external asset`)
    assert.doesNotMatch(html, /<img[^>]+src="https?:/, `${p}: external image`)
  }
  assert.doesNotMatch(read('style.v1.css'), /@import|url\("?https?:/)
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
    "a key written to a file your .gitignore doesn't exclude, or a new .env", 'Node.js 18']) {
    assert.ok(t.includes(s), `llms.txt does not say "${s}"`)
  }
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
