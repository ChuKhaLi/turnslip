import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { read, SITE } from './site-helpers.mjs'

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

// Figure rules for every guide (skill spec docs/specs/2026-10-07-write-guide-skill-design.md §5-6).
const guideFiles = () => readdirSync(join(SITE, 'guides')).filter((f) => f.endsWith('.html')).map((f) => `guides/${f}`)
const LEGACY_OG = new Set(['guides/undo-claude-code-changes.html', 'guides/what-did-claude-code-change.html'])
const mainOf = (html) => /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? ''

test('each guide has its own 1200x630 social image; the two first guides may keep /og.png', () => {
  for (const g of guideFiles()) {
    const og = /<meta property="og:image" content="([^"]+)">/.exec(read(g))?.[1]
    if (LEGACY_OG.has(g) && og === 'https://turnslip.dev/og.png') continue
    const slug = g.slice('guides/'.length, -'.html'.length)
    assert.equal(og, `https://turnslip.dev/og/${slug}.png`, `${g}: og:image`)
    const png = readFileSync(join(SITE, 'og', `${slug}.png`))
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], `${g}: image size`)
    assert.match(read(g), new RegExp(`<meta name="twitter:image" content="https://turnslip\.dev/og/${slug}\.png">`), `${g}: twitter:image`)
  }
})

// The rules as one function, so they can be tried on samples: the pattern the skill tells a writer to draw
// must pass, and every way to fix a colour must fail.
function diagramProblems(svg) {
  const out = []
  if (!/role="img"/.test(svg)) out.push('no role="img"')
  if (!/<title\b[^>]*>[^<]+<\/title>/.test(svg)) out.push('no title')
  // Every colour attribute holds currentColor or none; an id reference such as url(#face) is no colour.
  for (const [, attr, value] of svg.matchAll(/\s((?:fill|stroke|color|stop-color|flood-color|lighting-color)(?=="))="([^"]*)"/g))
    if (!/^(?:currentColor|none)$/.test(value)) out.push(`${attr}="${value}"`)
  if (/rgba?\(|hsla?\(|style=/i.test(svg)) out.push('a fixed colour or style')
  if (/\s(?:width|height)="\d/.test(svg.slice(0, svg.indexOf('>')))) out.push('a fixed size')
  return out
}

test("the diagram rules pass the skill's own pattern and fail every fixed colour", () => {
  const ok = '<svg viewBox="0 0 400 220" role="img" aria-labelledby="d-title d-desc"><title id="d-title">Short title</title>'
    + '<desc id="d-desc">x</desc><defs><marker id="face"><path d="M0 0" fill="currentColor"/></marker></defs>'
    + '<rect x="10" y="20" width="180" height="60" rx="6" fill="currentColor" fill-opacity="0.08"/>'
    + '<path d="M0 0" fill="none" stroke="currentColor" marker-end="url(#face)"/></svg>'
  assert.deepEqual(diagramProblems(ok), [])
  for (const bad of ['fill="red"', 'stroke="black"', 'fill="#fff"', 'fill="var(--ink)"', 'color="navy"'])
    assert.ok(diagramProblems(ok.replace('fill="currentColor" fill-opacity', `${bad} fill-opacity`)).length > 0, bad)
})

test('every diagram in a guide is labelled and coloured only by currentColor', () => {
  for (const g of guideFiles()) {
    for (const [svg] of mainOf(read(g)).matchAll(/<svg[\s\S]*?<\/svg>/g)) assert.deepEqual(diagramProblems(svg), [], g)
  }
})

test('every drawn terminal in a guide says what it shows', () => {
  for (const g of guideFiles()) {
    for (const [div] of mainOf(read(g)).matchAll(/<div class="term"[^>]*>/g)) {
      assert.match(div, /role="img"/, `${g}: terminal without role="img"`)
      assert.match(div, /aria-label="[^"]{20,}"/, `${g}: terminal without an aria-label`)
    }
  }
})

// The /guides hub (spec 2026-10-07-content-seo-design §3.2 row 0, §4): it lists every guide the sitemap
// lists, and every page footer links it while keeping the two original guide links.
const HUB = 'guides.html'
const guideSlugs = () => [...read('sitemap.xml').matchAll(/<loc>https:\/\/turnslip\.dev\/guides\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1])

test('the hub lists every guide in the sitemap, and nothing else', () => {
  const html = read(HUB)
  assert.match(html, /<h1>Guides<\/h1>/)
  const listed = [...html.matchAll(/<li><a href="\/guides\/([a-z0-9-]+)">/g)].map((m) => m[1]).sort()
  assert.deepEqual(listed, guideSlugs().sort())
  assert.ok(guideSlugs().length >= 2)
  const data = ld(html)
  assert.ok(data.some((x) => x['@type'] === 'CollectionPage' && x.url === 'https://turnslip.dev/guides'))
  assert.equal(data.find((x) => x['@type'] === 'BreadcrumbList')?.itemListElement.at(-1).item, 'https://turnslip.dev/guides')
})

test('every page footer links the hub', async () => {
  const { PAGES } = await import('./site-helpers.mjs')
  for (const p of PAGES) {
    const nav = /<nav aria-label="Guides">([\s\S]*?)<\/nav>/.exec(read(p))?.[1] ?? ''
    assert.ok(nav.includes('href="/guides"'), `${p} footer lacks the hub`)
  }
})

test('the sitemap and llms.txt name the hub', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/turnslip\.dev\/guides<\/loc><lastmod>2026-10-07<\/lastmod>/)
  assert.ok(read('llms.txt').includes('(https://turnslip.dev/guides)'))
})

// Guide 1 (spec §3.3 page 1): useful without turnslip, in the order that brings files back most often,
// and honest in its first screen that turnslip helps only if it was installed before the turn.
const DELETED = 'guides/claude-code-deleted-my-files.html'

test('the deleted-files guide orders the ways back and says what each one cannot do', () => {
  const html = read(DELETED)
  assert.match(html, /<h1>Claude Code deleted my files: what can still come back<\/h1>/)
  const h2 = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])
  assert.deepEqual(h2, ['If turnslip was already installed', '1. git', "2. Claude Code's /rewind",
    "3. Your editor's local history", '4. Backups and synced folders', '5. Recovery software', 'Next time'])
  const t = text(html)
  const first = text(html.slice(0, html.indexOf('<h2>1. git</h2>')))
  assert.ok(first.includes('only if it was installed before the turn'), 'first screen lacks the honest limit')
  for (const s of ['git restore', 'from the index', 'git reflog', 'HEAD@{2}', 'git stash list',
    'Checkpointing does not track files modified by Bash commands', 'Local History: Find Entry to Restore',
    'Recovering data from a TRIM-erased drive is just not going to happen', '.gitignore', '/turnslip:undo', 'restored 2 files'])
    assert.ok(t.includes(s), `deleted-files guide does not say "${s}"`)
  for (const href of ['https://code.claude.com/docs/en/checkpointing', 'https://git-scm.com/docs/git-restore',
    'https://git-scm.com/docs/git-status', 'https://git-scm.com/docs/git-reflog', 'https://git-scm.com/docs/git-stash',
    'https://code.visualstudio.com/docs/getstarted/userinterface#_local-file-history',
    'https://techgage.com/article/too_trim_when_ssd_data_recovery_is_impossible/3',
    '/guides/stop-claude-code-destructive-commands', '/guides/undo-claude-code-changes', '/#install'])
    assert.ok(html.includes(`href="${href}"`), `deleted-files guide does not link ${href}`)
  const article = ld(html).find((x) => x['@type'] === 'TechArticle')
  assert.equal(article.headline, 'Claude Code deleted my files: what can still come back')
  assert.equal(article.dateModified, '2026-10-07')
  assert.match(read('sitemap.xml'), /<loc>https:\/\/turnslip\.dev\/guides\/claude-code-deleted-my-files<\/loc><lastmod>2026-10-07<\/lastmod>/)
  assert.ok(read('llms.txt').includes('(https://turnslip.dev/guides/claude-code-deleted-my-files)'))
})

// Guide 2 (spec §3.3 page 2): Claude Code's own controls first, each from its docs, with what they cannot
// catch; turnslip as detection after the fact. The settings example must be valid JSON a reader can paste.
const STOP = 'guides/stop-claude-code-destructive-commands.html'

test('the destructive-commands guide gives working rules, their limits, and turnslip as a backstop', () => {
  const html = read(STOP)
  assert.match(html, /<h1>Stop Claude Code from running rm -rf and git reset --hard<\/h1>/)
  const t = text(html)
  for (const s of ['v2.1.283', 'Explicit ask rules still force a prompt', 'Deny rules block in every mode, including bypassPermissions',
    'Rules are evaluated in order: deny, then ask, then allow.', 'apply when any subcommand matches them', "isn't a security boundary",
    '/bin/rm -rf build/', "bash -c 'rm -rf build/'", 'PowerShell(Remove-Item *)', 'permissionDecision', '"matcher": "Bash"',
    'containers or VMs', 'not prevention', '/turnslip:undo', '.claude/settings.json', '~/.claude/settings.json',
    "Claude requested permissions to use Bash, but you haven't granted it yet."])
    assert.ok(t.includes(s), `destructive-commands guide does not say "${s}"`)
  const json = /<pre class="cmd"><code>(\{\s*"permissions"[\s\S]*?)<\/code><\/pre>/.exec(html)?.[1]
  assert.ok(json, 'no permissions example')
  const settings = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
  for (const r of ['Bash(rm *)', 'Bash(git reset --hard *)', 'Bash(git clean *)', 'Bash(git checkout -- *)', 'Bash(git push --force *)', 'PowerShell(Remove-Item *)'])
    assert.ok(settings.permissions.ask.includes(r), `ask lacks ${r}`)
  for (const href of ['https://code.claude.com/docs/en/permissions', 'https://code.claude.com/docs/en/settings',
    'https://code.claude.com/docs/en/permission-modes', 'https://code.claude.com/docs/en/hooks#how-a-hook-resolves',
    '/guides/claude-code-deleted-my-files', '/#install'])
    assert.ok(html.includes(`href="${href}"`), `destructive-commands guide does not link ${href}`)
  const article = ld(html).find((x) => x['@type'] === 'TechArticle')
  assert.equal(article.headline, 'Stop Claude Code from running rm -rf and git reset --hard')
  assert.equal(article.dateModified, '2026-10-07')
  assert.match(read('sitemap.xml'), /<loc>https:\/\/turnslip\.dev\/guides\/stop-claude-code-destructive-commands<\/loc><lastmod>2026-10-07<\/lastmod>/)
  assert.ok(read('llms.txt').includes('(https://turnslip.dev/guides/stop-claude-code-destructive-commands)'))
})

// Final review fixes (2026-10-07): the hook example is the docs' own (How a hook resolves), its narrow
// match and the docs' advice are stated, ask rules still prompt in bypassPermissions; page 1 states
// turnslip's limits and the diagram's setup row reads one way; no unsourced "most likely" ordering claim.
test('guide 2 quotes the docs hook example verbatim and states what bypass mode and hooks do', () => {
  const html = read(STOP)
  const t = text(html)
  assert.ok(!t.includes('Destructive commands are not allowed'), 'a hook script the docs do not contain')
  for (const s of ['https://code.claude.com/docs/en/hooks#how-a-hook-resolves', '"if": "Bash(rm *)"', "grep -q 'rm -rf'",
    'Destructive command blocked by hook', 'chmod +x', 'use the permission system rather than a hook to enforce a hard allow or deny',
    'rm -fr build', 'Tools matched by an explicit ask rule'])
    assert.ok(html.includes(s) || t.includes(s), `guide 2 lacks "${s}"`)
})

test('guide 1 states turnslip limits and reads its setup row one way', () => {
  const t = text(read(DELETED))
  for (const s of ['if the deleting turn was the last one', '/turnslip:undo 3', 'light mode', '5 MB', 'a gitignored .env',
    'works without setup: no, commit first', 'works without setup: built in', 'works without setup: on by default',
    'works without setup: no, install first', 'rm-deleted files: if the turn was tracked'])
    assert.ok(t.includes(s), `guide 1 lacks "${s}"`)
  for (const s of ['most likely to bring files back', 'needs commits made beforehand', 'must be installed before the turn'])
    assert.ok(!t.includes(s), `guide 1 still says "${s}"`)
  assert.ok(!text(read('guides.html')).includes('works most often'), 'hub keeps an unsourced ordering claim')
})

// Deferred minors of the guides' final review, fixed 2026-10-07 (sources downloaded raw and grepped).
test('guide fixes: fsck for staged work, the full VS Code quote, PowerShell and force-push notes, hub card, sitemap coverage', () => {
  const g1 = read(DELETED), t1 = text(g1)
  assert.ok(t1.includes('git fsck --lost-found') && g1.includes('href="https://git-scm.com/docs/git-fsck"'), 'guide 1 lacks git fsck')
  assert.ok(g1.includes('href="https://git-scm.com/book/en/v2/Git-Internals-Git-Objects"') && t1.includes('stores blobs for the files that have changed'))
  assert.ok(t1.includes('Depending on your settings, every time you save an editor, a new entry is added'), 'VS Code quote trimmed')
  assert.ok(!t1.includes('It holds only the versions you saved'), 'an inference about VS Code history remains')
  const g2 = read(STOP), t2 = text(g2)
  assert.match(g2, /PowerShell permission rules use the same shape as Bash rules[^<]*\(<a href="https:\/\/code\.claude\.com\/docs\/en\/permissions#powershell">/)
  assert.ok(t2.includes('does not catch git push -f'), 'guide 2 does not say what the force-push rule misses')
  assert.match(read(HUB), /<meta name="twitter:image" content="https:\/\/turnslip\.dev\/og\.png">/)
  const inSitemap = new Set(guideSlugs())
  for (const f of readdirSync(join(SITE, 'guides')).filter((x) => x.endsWith('.html'))) assert.ok(inSitemap.has(f.slice(0, -5)), `${f} is not in the sitemap`)
})

// Guide 3 (spec §3.3 page 3), an evidence piece: a captured run on Claude Code 2.1.292
// (docs/spikes/2026-10-07-what-rewind-misses.md). Each result below is what the run left on disk; the
// method, version, date and sample size are on the page, and the docs' own limit is quoted and linked.
const MISSES = 'guides/what-rewind-misses.html'

test('the what-rewind-misses page states each measured result, its method, and the docs it matches', () => {
  const html = read(MISSES)
  assert.match(html, /<h1>What \/rewind misses: a measured test<\/h1>/)
  const t = text(html)
  const first = text(html.slice(0, html.indexOf('<h2>')))
  for (const s of ['2.1.292', '7 October 2026', 'restored the Write edit and none of the four shell commands'])
    assert.ok(first.includes(s), `first screen lacks "${s}"`)
  const results = [...html.matchAll(/<li class="result">([\s\S]*?)<\/li>/g)].map((m) => text(m[1]).trim().split(/\s*: (.*)/s).slice(0, 2))
  assert.deepEqual(results, [
    ['rm notes/old.txt', '/rewind did not restore it; /turnslip:undo did.'],
    ['mv src/config.js src/settings.js', '/rewind did not restore it; /turnslip:undo did.'],
    ["sed -i 's/3000/8080/' src/config.js", '/rewind did not restore it; /turnslip:undo did.'],
    ['npm install is-number', '/rewind did not restore it; /turnslip:undo restored package.json and removed package-lock.json, and left node_modules.'],
    ['A Write tool edit of README.md', 'both restored it.'],
  ])
  for (const s of ['one run per command', 'Windows 11', 'Opus 5.5', 'No code changes', 'The code will be unchanged.',
    'Rewinding does not affect files edited manually or via bash.', 'Update(src\\config.js)', 'PowerShell(npm install is-number)',
    'Checkpointing does not track files modified by Bash commands.',
    'The two code restore options appear only when the selected checkpoint has tracked file changes to revert.',
    'continue using version control, such as Git', 'turnslip 0.3.8',
    'not undone: packages: npm install is-number', 'installed before the turn', '.gitignore'])
    assert.ok(t.includes(s), `what-rewind-misses does not say "${s}"`)
  for (const href of ['https://code.claude.com/docs/en/checkpointing#bash-command-changes-not-tracked',
    'https://code.claude.com/docs/en/checkpointing#rewind-and-summarize',
    'https://code.claude.com/docs/en/checkpointing#not-a-replacement-for-version-control',
    '/guides/undo-claude-code-changes', '/guides/claude-code-deleted-my-files', '/guides/stop-claude-code-destructive-commands', '/#install'])
    assert.ok(html.includes(`href="${href}"`), `what-rewind-misses does not link ${href}`)
  const article = ld(html).find((x) => x['@type'] === 'TechArticle')
  assert.equal(article.headline, 'What /rewind misses: a measured test')
  assert.equal(article.dateModified, '2026-10-07')
  assert.match(read('sitemap.xml'), /<loc>https:\/\/turnslip\.dev\/guides\/what-rewind-misses<\/loc><lastmod>2026-10-07<\/lastmod>/)
  assert.ok(read('llms.txt').includes('(https://turnslip.dev/guides/what-rewind-misses)'))
})
