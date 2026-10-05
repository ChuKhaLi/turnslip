import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { openUrl } from '../plugin/lib/open.mjs'

// No real browser in a test: spawn is faked, and what it was asked to run is recorded.
function fakeSpawn(calls) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const c = new EventEmitter()
    c.unref = () => { c.unrefed = true }
    return c
  }
}

test('openUrl hands the URL to the platform opener as one argument, detached, no shell', () => {
  const url = 'https://checkout.dodopayments.com/buy/pdt_x?quantity=1&redirect_url=https%3A%2F%2Fturnslip.dev%2Fthanks'
  for (const [platform, cmd, args] of [
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', url]],
    ['darwin', 'open', [url]],
    ['linux', 'xdg-open', [url]],
  ]) {
    const calls = []
    assert.equal(openUrl(url, { platform, spawn: fakeSpawn(calls) }), true, platform)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cmd, cmd, platform)
    assert.deepEqual(calls[0].args, args, platform)
    assert.equal(calls[0].opts.detached, true)
    assert.equal(calls[0].opts.stdio, 'ignore')
    assert.ok(!calls[0].opts.shell, 'a URL with & must never reach a shell')
  }
})

test('openUrl says false when the opener cannot start, and never throws', () => {
  const spawn = () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) }
  assert.equal(openUrl('https://turnslip.dev', { platform: 'linux', spawn }), false)
})
