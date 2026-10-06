import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read } from './site-helpers.mjs'

// SEO pass (owner, 2026-10-05): the home head carries the queries people type, and two guides answer
// them honestly. Facts about Claude Code's own rewind are quoted from its documentation, linked.
const UNDO = 'guides/undo-claude-code-changes.html'
const CHANGED = 'guides/what-did-claude-code-change.html'
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))

test('the home head names Claude Code and undo, and its social tags are complete', () => {
  const html = read('index.html')
  assert.match(html, /<title>turnslip: see and undo what Claude Code changed<\/title>/)
  assert.match(html, /<meta property="og:title" content="turnslip: see and undo what Claude Code changed">/)
  const desc = /<meta name="description" content="([^"]+)">/.exec(html)[1]
  for (const s of ['Claude Code plugin', 'undo', 'Free']) assert.ok(desc.includes(s), `description lacks "${s}"`)
  for (const tag of ['og:site_name', 'og:image:alt', 'og:locale']) assert.match(html, new RegExp(`<meta property="${tag}" content="[^"]+">`), tag)
  for (const tag of ['twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) assert.match(html, new RegExp(`<meta name="${tag}" content="[^"]+">`), tag)
})

test('the home structured data states both offers, the price date, the repo and the requirements', () => {
  const app = ld(read('index.html')).find((x) => x['@type'] === 'SoftwareApplication')
  assert.ok(app)
  const prices = app.offers.map((o) => o.price).sort()
  assert.deepEqual(prices, ['0', '19'])
  const pro = app.offers.find((o) => o.price === '19')
  assert.equal(pro.priceValidUntil, '2026-11-05') // the site's "$19 until 5 November 2026"; update with the price
  assert.equal(pro.availability, 'https://schema.org/InStock')
  assert.deepEqual(app.sameAs, ['https://github.com/ChuKhaLi/turnslip'])
  assert.match(app.softwareRequirements, /Claude Code 2\.1\.289/)
  assert.ok(!('aggregateRating' in app) && !('review' in app), 'no ratings that were never given')
})

test('the home page links to both guides from the cards they expand on', () => {
  const html = read('index.html')
  assert.ok(html.includes('href="/guides/undo-claude-code-changes"'))
  assert.ok(html.includes('href="/guides/what-did-claude-code-change"'))
})

test('the undo guide is fair to Claude Code\'s rewind and to git, and honest about turnslip\'s limits', () => {
  const html = read(UNDO)
  const t = text(html)
  assert.match(html, /<h1>How to undo Claude Code changes<\/h1>/)
  assert.ok(html.includes('href="https://code.claude.com/docs/en/checkpointing"'), 'the rewind facts are not linked to their source')
  for (const s of ['/rewind', 'Esc', 'Checkpointing does not track files modified by Bash commands', '100 most recent checkpoints',
    'about 30 days', 'Not a replacement for version control', 'git stash', '.gitignore',
    '/turnslip:undo', 'changed since', 'not undone', 'outside the project', 'light mode']) assert.ok(t.includes(s), `undo guide does not say "${s}"`)
})

test('the what-changed guide shows the slip and what it catches, and links its sources', () => {
  const t = text(read(CHANGED))
  assert.match(read(CHANGED), /<h1>What did Claude Code just change\?<\/h1>/)
  for (const s of ['git status', 'git diff', 'not mentioned:', 'said but not changed:', 'Stop says:', '/turnslip:history']) assert.ok(t.includes(s), `what-changed guide does not say "${s}"`)
})

test('each guide has an article and a breadcrumb, links the other guide and the install steps', () => {
  for (const [p, other] of [[UNDO, CHANGED], [CHANGED, UNDO]]) {
    const html = read(p)
    const data = ld(html)
    const article = data.find((x) => x['@type'] === 'TechArticle')
    assert.ok(article && article.headline === /<h1>([^<]+)<\/h1>/.exec(html)[1].replace(/&amp;/g, '&'), `${p}: TechArticle headline is the h1`)
    assert.equal(article.dateModified, '2026-10-05')
    const crumbs = data.find((x) => x['@type'] === 'BreadcrumbList')
    assert.equal(crumbs?.itemListElement.at(-1).item, `https://turnslip.dev/${p.replace('.html', '')}`)
    assert.ok(html.includes(`href="/${other.replace('.html', '')}"`), `${p} does not link ${other}`)
    assert.ok(html.includes('href="/#install"'), `${p} has no install link`)
  }
})

test('the sitemap dates the home page and the guides by their last change', () => {
  const s = read('sitemap.xml')
  assert.match(s, /<loc>https:\/\/turnslip\.dev\/<\/loc><lastmod>2026-10-07<\/lastmod>/)
  for (const g of ['undo-claude-code-changes', 'what-did-claude-code-change']) {
    assert.match(s, new RegExp(`<loc>https://turnslip\\.dev/guides/${g}</loc><lastmod>2026-10-05</lastmod>`))
  }
})

test('/thanks also says noindex in a header, and llms.txt lists the guides', () => {
  assert.match(read('_headers'), /\/thanks\r?\n(?:  .*\r?\n)*  X-Robots-Tag: noindex/)
  const l = read('llms.txt')
  assert.ok(l.includes('https://turnslip.dev/guides/undo-claude-code-changes'))
  assert.ok(l.includes('https://turnslip.dev/guides/what-did-claude-code-change'))
})

test('every page footer links both guides', async () => {
  const { PAGES } = await import('./site-helpers.mjs')
  for (const p of PAGES) {
    const footer = /<footer class="site">([\s\S]*?)<\/footer>/.exec(read(p))?.[1] ?? ''
    assert.match(footer, /<nav aria-label="Guides">/, `${p}: no Guides nav in the footer`)
    for (const g of ['undo-claude-code-changes', 'what-did-claude-code-change']) assert.ok(footer.includes(`href="/guides/${g}"`), `${p} footer lacks ${g}`)
  }
})

test('the FAQ answers how turnslip differs from /rewind, and points to the undo guide', () => {
  const faq = /<section class="faq"[\s\S]*?<\/section>/.exec(read('index.html'))[0]
  assert.match(faq, /<h3>How is this different from Claude Code's \/rewind\?<\/h3>/)
  assert.ok(text(faq).includes('does not track files changed by shell commands'))
  assert.ok(faq.includes('href="/guides/undo-claude-code-changes"'))
})

test('the plugin README links the guides by their full address', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['plugin/README.md']) {
    const md = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    for (const g of ['undo-claude-code-changes', 'what-did-claude-code-change']) assert.ok(md.includes(`https://turnslip.dev/guides/${g}`), `${f} lacks ${g}`)
  }
})

// Captured 2026-10-06 (release item 14, Claude Max, the owner's settings): with Claude Code's
// "verbose": true the MessageDisplay replacement is ignored and the receipt line shows. Every place
// that says the line is hidden says so too.
test('wherever the receipt is said to be hidden, the verbose exception is named', async () => {
  const { readFileSync } = await import('node:fs')
  const texts = {
    'site/llms.txt': read('llms.txt'),
    'site/guides/what-did-claude-code-change.html': text(read(CHANGED)),
    'plugin/README.md': readFileSync(new URL('../plugin/README.md', import.meta.url), 'utf8').replace(/\s+/g, ' '),
  }
  for (const [f, t] of Object.entries(texts)) assert.ok(t.includes("unless Claude Code's verbose output is on"), `${f} does not name the verbose exception`)
})
