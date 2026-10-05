import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { ACTIVATE_USAGE, DAY, NOT_ON_SALE, REVOKED, activateKey, deactivateKey, isPro, licenseState, machineName, mask, needsCheck, readLicense, revalidate } from '../plugin/lib/license.mjs'
import { writeJson } from '../plugin/lib/store.mjs'
import { fakeFetch, tempDir } from './helpers.mjs'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const lic = (over = {}) => ({ key: 'ABCD-EFGH-WXYZ', instanceId: 'lki_1', status: 'active', lastOk: NOW, lastCheck: NOW, reason: null, ...over })
const homeWith = (l) => { const home = tempDir(); writeJson(join(home, 'license.json'), l); return home }

test('no license file is free', () => {
  assert.equal(isPro(tempDir(), NOW), false)
  assert.deepEqual(licenseState(tempDir(), NOW), { kind: 'free' })
})

test('an active license is Pro for 14 days after the last success, not one ms more', () => {
  assert.equal(isPro(homeWith(lic()), NOW), true)
  assert.equal(isPro(homeWith(lic({ lastOk: NOW - 14 * DAY })), NOW), true)
  assert.equal(isPro(homeWith(lic({ lastOk: NOW - 14 * DAY - 1 })), NOW), false)
})

test('a lastOk more than a day in the future does not freeze Pro on (clock set back)', () => {
  assert.equal(isPro(homeWith(lic({ lastOk: NOW + DAY })), NOW), true)
  assert.equal(isPro(homeWith(lic({ lastOk: NOW + DAY + 1 })), NOW), false)
})

test('a revoked license is not Pro, and setup can say why', () => {
  const home = homeWith(lic({ status: 'revoked', reason: 'Dodo says the key is no longer valid (refund or disabled)' }))
  assert.equal(isPro(home, NOW), false)
  assert.deepEqual(licenseState(home, NOW), { kind: 'off', reason: 'Dodo says the key is no longer valid (refund or disabled)' })
})

test('a stale or future license is off with a reason; an active one is pro', () => {
  assert.deepEqual(licenseState(homeWith(lic({ lastOk: NOW - 15 * DAY })), NOW), { kind: 'off', reason: 'not confirmed for 14 days · connect to the internet' })
  assert.deepEqual(licenseState(homeWith(lic({ lastOk: NOW + 2 * DAY })), NOW), { kind: 'off', reason: 'last check is in the future · check the clock' })
  assert.deepEqual(licenseState(homeWith(lic()), NOW), { kind: 'pro', key: 'ABCD-EFGH-WXYZ', lastOk: NOW })
})

test('a corrupt or foreign license file reads as free', () => {
  for (const body of ['{"key":', '[]', '"x"', '{"key":42,"status":"active","lastOk":0}', 'null']) {
    const home = tempDir()
    writeFileSync(join(home, 'license.json'), body)
    assert.equal(readLicense(home), null, body)
    assert.equal(isPro(home, NOW), false, body)
    assert.deepEqual(licenseState(home, NOW), { kind: 'free' }, body)
  }
})

test('mask keeps only the last 4 characters', () => {
  assert.equal(mask('ABCD-EFGH-WXYZ'), '…WXYZ')
  assert.equal(mask(undefined), '…')
})

test('needsCheck: weekly after a success, daily after a failure, never for a revoked or missing license', () => {
  assert.equal(needsCheck(null, NOW), false)
  assert.equal(needsCheck(lic({ lastCheck: NOW - 7 * DAY + 1, lastOk: NOW - 7 * DAY + 1 }), NOW), false)
  assert.equal(needsCheck(lic({ lastCheck: NOW - 7 * DAY, lastOk: NOW - 7 * DAY }), NOW), true)
  assert.equal(needsCheck(lic({ lastOk: NOW - 3 * DAY, lastCheck: NOW - DAY + 1 }), NOW), false)
  assert.equal(needsCheck(lic({ lastOk: NOW - 3 * DAY, lastCheck: NOW - DAY }), NOW), true)
  assert.equal(needsCheck(lic({ status: 'revoked', lastCheck: 0, lastOk: 0 }), NOW), false)
})

test('needsCheck never fires for an active license without an instanceId', () => {
  assert.equal(needsCheck({ key: 'TS-AAAA-BBBB-WXYZ', status: 'active', lastCheck: 0, lastOk: 0 }, NOW), false)
  assert.equal(needsCheck(lic({ lastCheck: 0, lastOk: 0 }), NOW), true)
})

test('needsCheck runs when the last check is more than a day in the future (clock set back)', () => {
  assert.equal(needsCheck(lic({ lastCheck: NOW + DAY + 1, lastOk: NOW + DAY + 1 }), NOW), true)
  assert.equal(needsCheck(lic({ lastCheck: NOW + DAY, lastOk: NOW + DAY }), NOW), false)
})

const IDS = { businessId: 'bus_ts', productId: 'pdt_ts' }
const KEY = 'TS-AAAA-BBBB-WXYZ'
const ok201 = (over = {}) => ({ status: 201, json: { id: 'lki_new', business_id: 'bus_ts', product: { product_id: 'pdt_ts' }, ...over } })
const read = (home) => JSON.parse(readFileSync(join(home, 'license.json'), 'utf8'))

test('activate: a malformed key prints the usage line and calls nobody; spaces around a key are trimmed', async () => {
  const fetch = fakeFetch({})
  for (const k of ['', 'short', '"TS-AAAA-BBBB-WXYZ"', 'TS AAAA BBBB WXYZ', 'a;rm -rf x']) {
    assert.equal(await activateKey(tempDir(), k, { fetch, ids: IDS, now: NOW }), ACTIVATE_USAGE, k)
  }
  assert.equal(fetch.calls.length, 0)
  const home = tempDir()
  assert.match(await activateKey(home, `  ${KEY}\n`, { fetch: fakeFetch({ activate: ok201() }), ids: IDS, now: NOW }), /Pro activated/)
  assert.equal(read(home).key, KEY)
})

test('activate: not on sale while the ids are empty', async () => {
  const fetch = fakeFetch({})
  assert.equal(await activateKey(tempDir(), KEY, { fetch, ids: { businessId: '', productId: '' }, now: NOW }), NOT_ON_SALE)
  assert.equal(NOT_ON_SALE, 'turnslip Pro is not on sale yet · turnslip.dev')
  assert.equal(fetch.calls.length, 0)
})

test('activate: success writes the license, names the machine without the hostname, prints the masked key', async () => {
  const home = tempDir()
  const fetch = fakeFetch({ activate: ok201() })
  const out = await activateKey(home, KEY, { fetch, ids: IDS, now: NOW })
  assert.equal(out, 'turnslip · Pro activated on this machine (key …WXYZ) · thank you\n/turnslip:history · /turnslip:undo <n> · /turnslip:report · /turnslip:mode detailed')
  const l = read(home)
  assert.deepEqual({ ...l, activatedAt: undefined }, { key: KEY, instanceId: 'lki_new', name: machineName(home), status: 'active', activatedAt: undefined, lastOk: NOW, lastCheck: NOW, reason: null })
  assert.match(machineName(home), new RegExp(`^turnslip · ${process.platform} · [0-9a-f]{6}$`))
  assert.equal(machineName(home), machineName(home)) // kept in machine.json
  assert.ok(!machineName(home).includes(hostname()))
  assert.equal(fetch.calls[0].body.name, machineName(home))
  assert.equal(isPro(home, NOW), true)
})

test('activate: each Dodo refusal prints its line and writes nothing', async () => {
  const cases = [
    [{ status: 404, json: {} }, 'turnslip · that key does not exist · check the email from Dodo Payments'],
    [{ status: 403, json: {} }, 'turnslip · that key is not active (refunded or disabled) · support@turnslip.dev'],
    [{ status: 422, json: {} }, 'turnslip · that key is already on 3 machines · run /turnslip:deactivate on one of them, or write to support@turnslip.dev'],
    ['throw', 'turnslip · could not reach Dodo Payments · nothing changed, try again'],
    [{ status: 201, json: { business_id: 'bus_ts' } }, 'turnslip · could not reach Dodo Payments · nothing changed, try again'],
  ]
  for (const [route, line] of cases) {
    const home = tempDir()
    assert.equal(await activateKey(home, KEY, { fetch: fakeFetch({ activate: route }), ids: IDS, now: NOW }), line)
    assert.equal(existsSync(join(home, 'license.json')), false, line)
  }
})

test('activate: a key of another Dodo business or product is refused and its activation undone', async () => {
  for (const json of [{ business_id: 'bus_other' }, { product: { product_id: 'pdt_other' } }]) {
    const home = tempDir()
    const fetch = fakeFetch({ activate: ok201(json), deactivate: { status: 200, json: {} } })
    assert.equal(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), 'turnslip · this key is not a turnslip key')
    assert.equal(existsSync(join(home, 'license.json')), false)
    assert.deepEqual(fetch.calls.at(-1).body, { license_key: KEY, license_key_instance_id: 'lki_new' })
  }
  // No product id in the response at all: refused too, and undone (spec §3.6, settled by the test-mode spike).
  const home = tempDir()
  const fetch = fakeFetch({ activate: { status: 201, json: { id: 'lki_new', business_id: 'bus_ts' } }, deactivate: { status: 200, json: {} } })
  assert.equal(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), 'turnslip · this key is not a turnslip key')
  assert.equal(existsSync(join(home, 'license.json')), false)
  assert.deepEqual(fetch.calls.map((c) => c.url.split('/licenses/')[1]), ['activate', 'deactivate'])
})

test('activate: the same key again validates instead of using up another machine', async () => {
  const home = tempDir()
  writeJson(join(home, 'license.json'), lic({ key: KEY, lastOk: NOW - 10 * DAY, lastCheck: NOW - 10 * DAY }))
  const fetch = fakeFetch({ validate: { status: 200, json: { valid: true } } })
  assert.match(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), /Pro activated/)
  assert.deepEqual(fetch.calls.map((c) => c.url.split('/licenses/')[1]), ['validate'])
  assert.equal(read(home).lastOk, NOW)
  assert.equal(read(home).instanceId, 'lki_1')
})

test('activate: the same key whose instance is gone activates anew; offline changes nothing', async () => {
  const home = tempDir()
  writeJson(join(home, 'license.json'), lic({ key: KEY, status: 'revoked', reason: REVOKED }))
  const fetch = fakeFetch({ validate: { status: 200, json: { valid: false } }, activate: ok201(), deactivate: { status: 200, json: {} } })
  assert.match(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), /Pro activated/)
  assert.deepEqual(fetch.calls.map((c) => c.url.split('/licenses/')[1]), ['validate', 'activate'])
  assert.equal(read(home).instanceId, 'lki_new')
  assert.equal(read(home).status, 'active')
  const home2 = tempDir()
  writeJson(join(home2, 'license.json'), lic({ key: KEY }))
  assert.equal(await activateKey(home2, KEY, { fetch: fakeFetch({ validate: 'throw' }), ids: IDS, now: NOW }), 'turnslip · could not reach Dodo Payments · nothing changed, try again')
  assert.deepEqual(read(home2), lic({ key: KEY }))
})

test('activate: a different key frees the old machine slot only after the new key succeeded', async () => {
  const home = tempDir()
  writeJson(join(home, 'license.json'), lic({ key: 'OLD-KEY-1111' }))
  const fail = fakeFetch({ activate: { status: 404, json: {} }, deactivate: { status: 200, json: {} } })
  await activateKey(home, KEY, { fetch: fail, ids: IDS, now: NOW })
  assert.deepEqual(fail.calls.map((c) => c.url.split('/licenses/')[1]), ['activate'])
  assert.equal(read(home).key, 'OLD-KEY-1111')
  const fetch = fakeFetch({ activate: ok201(), deactivate: 'throw' }) // the old slot's release is best effort
  assert.match(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), /Pro activated/)
  assert.deepEqual(fetch.calls.map((c) => c.url.split('/licenses/')[1]), ['activate', 'deactivate'])
  assert.deepEqual(fetch.calls[1].body, { license_key: 'OLD-KEY-1111', license_key_instance_id: 'lki_1' })
  assert.equal(read(home).key, KEY)
})

test('activate works over a corrupt license file', async () => {
  const home = tempDir()
  writeFileSync(join(home, 'license.json'), '{"key":')
  assert.match(await activateKey(home, KEY, { fetch: fakeFetch({ activate: ok201() }), ids: IDS, now: NOW }), /Pro activated/)
})

test('deactivate: none, done (200, 403, 404 all delete), offline keeps', async () => {
  assert.equal(await deactivateKey(tempDir(), { fetch: fakeFetch({}) }), 'turnslip · no license on this machine')
  for (const route of [{ status: 200, json: {} }, { status: 403, json: {} }, { status: 404, json: {} }]) {
    const home = homeWith(lic({ key: KEY }))
    assert.equal(await deactivateKey(home, { fetch: fakeFetch({ deactivate: route }) }), 'turnslip · this machine no longer uses key …WXYZ · one machine freed')
    assert.equal(existsSync(join(home, 'license.json')), false)
  }
  const home = homeWith(lic({ key: KEY }))
  assert.equal(await deactivateKey(home, { fetch: fakeFetch({ deactivate: 'throw' }) }), 'turnslip · could not reach Dodo Payments · the license stays on this machine, try again')
  assert.equal(read(home).key, KEY)
})

test('revalidate: valid refreshes lastOk; invalid revokes at once; offline only moves lastCheck', async () => {
  const old = NOW - 8 * DAY
  const h1 = homeWith(lic({ lastOk: old, lastCheck: old }))
  await revalidate(h1, { fetch: fakeFetch({ validate: { status: 200, json: { valid: true } } }), now: NOW })
  assert.equal(read(h1).lastOk, NOW)
  assert.equal(read(h1).lastCheck, NOW)
  const h2 = homeWith(lic({ lastOk: old, lastCheck: old }))
  await revalidate(h2, { fetch: fakeFetch({ validate: { status: 200, json: { valid: false } } }), now: NOW })
  assert.equal(read(h2).status, 'revoked')
  assert.equal(read(h2).reason, REVOKED)
  assert.equal(isPro(h2, NOW), false)
  const h3 = homeWith(lic({ lastOk: old, lastCheck: old }))
  await revalidate(h3, { fetch: fakeFetch({ validate: 'throw' }), now: NOW })
  assert.equal(read(h3).lastOk, old)
  assert.equal(read(h3).lastCheck, NOW)
  assert.equal(read(h3).status, 'active')
})

test('revalidate never overwrites a license the user replaced while it ran', async () => {
  const home = homeWith(lic({ key: 'OLD-KEY-1111', lastOk: NOW - 8 * DAY, lastCheck: NOW - 8 * DAY }))
  const fetch = fakeFetch({ validate: () => { writeJson(join(home, 'license.json'), lic({ key: KEY, instanceId: 'lki_new' })); return { status: 200, json: { valid: false } } } })
  await revalidate(home, { fetch, now: NOW })
  assert.equal(read(home).key, KEY)
  assert.equal(read(home).status, 'active')
})

test('no command result holds the whole key', async () => {
  const outs = [
    await activateKey(tempDir(), KEY, { fetch: fakeFetch({ activate: ok201() }), ids: IDS, now: NOW }),
    await deactivateKey(homeWith(lic({ key: KEY })), { fetch: fakeFetch({ deactivate: { status: 200, json: {} } }) }),
    await activateKey(tempDir(), KEY, { fetch: fakeFetch({ activate: { status: 422, json: {} } }), ids: IDS, now: NOW }),
  ]
  for (const o of outs) assert.ok(!o.includes(KEY), o)
})

test('activate: the same key refused by validate then by activate is revoked on disk; offline changes nothing', async () => {
  const line = 'turnslip · that key is not active (refunded or disabled) · support@turnslip.dev'
  const home = homeWith(lic({ key: KEY }))
  const fetch = fakeFetch({ validate: { status: 200, json: { valid: false } }, activate: { status: 403, json: {} } })
  assert.equal(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), line)
  assert.equal(read(home).status, 'revoked')
  assert.equal(read(home).reason, line)
  assert.equal(isPro(home, NOW), false)
  const h2 = homeWith(lic({ key: KEY }))
  const f2 = fakeFetch({ validate: { status: 200, json: { valid: false } }, activate: 'throw' })
  assert.match(await activateKey(h2, KEY, { fetch: f2, ids: IDS, now: NOW }), /could not reach/)
  assert.deepEqual(read(h2), lic({ key: KEY }))
  // A different key refused leaves the stored license alone.
  const h3 = homeWith(lic({ key: 'OLD-KEY-1111' }))
  await activateKey(h3, KEY, { fetch: fakeFetch({ activate: { status: 403, json: {} } }), ids: IDS, now: NOW })
  assert.deepEqual(read(h3), lic({ key: 'OLD-KEY-1111' }))
})

test('activate: a foreign key never frees the old key slot', async () => {
  const home = homeWith(lic({ key: 'OLD-KEY-1111' }))
  const fetch = fakeFetch({ activate: ok201({ business_id: 'bus_other' }), deactivate: { status: 200, json: {} } })
  assert.equal(await activateKey(home, KEY, { fetch, ids: IDS, now: NOW }), 'turnslip · this key is not a turnslip key')
  assert.deepEqual(read(home), lic({ key: 'OLD-KEY-1111' }))
  assert.ok(!fetch.calls.some((c) => c.body.license_key === 'OLD-KEY-1111'))
})

test('deactivate: a Dodo refusal keeps an active license and says Dodo refused, not unreachable', async () => {
  const home = homeWith(lic({ key: KEY }))
  assert.equal(await deactivateKey(home, { fetch: fakeFetch({ deactivate: { status: 422, json: {} } }) }),
    'turnslip · Dodo Payments refused to free this machine (HTTP 422) · the license stays here · write to support@turnslip.dev')
  assert.equal(read(home).key, KEY)
})

test('deactivate: a Dodo refusal on a revoked license removes it from this machine', async () => {
  const home = homeWith(lic({ key: KEY, status: 'revoked', reason: REVOKED }))
  assert.equal(await deactivateKey(home, { fetch: fakeFetch({ deactivate: { status: 401, json: {} } }) }),
    'turnslip · this machine no longer uses key …WXYZ · Dodo refused to free the slot (HTTP 401), the key was already revoked')
  assert.equal(existsSync(join(home, 'license.json')), false)
})
