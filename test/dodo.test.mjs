import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, IDS, activate, deactivate, onSale, validate } from '../plugin/lib/dodo.mjs'
import { fakeFetch } from './helpers.mjs'

test('activate posts the key and name as JSON to the live endpoint', async () => {
  const fetch = fakeFetch({ activate: { status: 201, json: { id: 'lki_1', business_id: 'bus_1', product: { product_id: 'pdt_1' } } } })
  const r = await activate('KEY-12345678', 'turnslip · win32 · abcdef', { fetch })
  assert.deepEqual(r, { ok: true, instanceId: 'lki_1', businessId: 'bus_1', productId: 'pdt_1' })
  assert.equal(fetch.calls[0].url, `${BASE}/licenses/activate`)
  assert.equal(BASE, 'https://live.dodopayments.com')
  assert.equal(fetch.calls[0].method, 'POST')
  assert.deepEqual(fetch.calls[0].body, { license_key: 'KEY-12345678', name: 'turnslip · win32 · abcdef' })
})

// Captured in test mode (spike 2026-10-04-dodo-test-mode §2): the id is at product.product_id only.
test('activate reads the product id from product.product_id only; product.id is ignored, and null when absent', async () => {
  const a = await activate('K', 'n', { fetch: fakeFetch({ activate: { status: 201, json: { id: 'lki_1', business_id: 'b', product: { id: 'pdt_2' } } } }) })
  assert.equal(a.productId, null)
  const b = await activate('K', 'n', { fetch: fakeFetch({ activate: { status: 201, json: { id: 'lki_1', business_id: 'b' } } }) })
  assert.equal(b.productId, null)
})

test('activate maps each failure', async () => {
  const at = (route) => activate('K', 'n', { fetch: fakeFetch({ activate: route }) })
  assert.deepEqual(await at({ status: 403, json: {} }), { invalid: true })
  assert.deepEqual(await at({ status: 404, json: {} }), { unknown: true })
  assert.deepEqual(await at({ status: 422, json: {} }), { limit: true })
  assert.deepEqual(await at({ status: 500 }), { offline: true }) // a non-JSON error page
  assert.deepEqual(await at('throw'), { offline: true })
  assert.deepEqual(await at({ status: 201, json: { business_id: 'b' } }), { offline: true }) // 2xx without an id
})

test('activate gives up after the timeout', async () => {
  const fetch = (url, init) => !init.signal ? Promise.resolve({ status: 201, json: async () => ({ id: 'late' }) }) : new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
  assert.deepEqual(await activate('K', 'n', { fetch, timeoutMs: 20 }), { offline: true })
})

test('validate sends the instance id and maps valid, invalid and everything else', async () => {
  const fetch = fakeFetch({ validate: { status: 200, json: { valid: true } } })
  assert.deepEqual(await validate('K', 'lki_1', { fetch }), { ok: true })
  assert.deepEqual(fetch.calls[0].body, { license_key: 'K', license_key_instance_id: 'lki_1' })
  assert.deepEqual(await validate('K', 'lki_1', { fetch: fakeFetch({ validate: { status: 200, json: { valid: false } } }) }), { invalid: true })
  // Anything ambiguous must never revoke a paid license: it counts as offline.
  for (const r of [{ status: 422, json: {} }, { status: 500 }, { status: 200, json: {} }, 'throw']) {
    assert.deepEqual(await validate('K', 'lki_1', { fetch: fakeFetch({ validate: r }) }), { offline: true }, JSON.stringify(r))
  }
})

test('deactivate maps 200, 403, 404 and failures', async () => {
  const at = (route) => deactivate('K', 'lki_1', { fetch: fakeFetch({ deactivate: route }) })
  const fetch = fakeFetch({ deactivate: { status: 200, json: {} } })
  assert.deepEqual(await deactivate('K', 'lki_1', { fetch }), { ok: true })
  assert.deepEqual(fetch.calls[0].body, { license_key: 'K', license_key_instance_id: 'lki_1' })
  assert.deepEqual(await at({ status: 200 }), { ok: true }) // an empty body is fine
  assert.deepEqual(await at({ status: 403, json: {} }), { invalid: true })
  assert.deepEqual(await at({ status: 404, json: {} }), { unknown: true })
  assert.deepEqual(await at('throw'), { offline: true })
})

// The live product (NEXT §2). A test-mode id here would sell keys nobody can activate.
test('the shipped ids are the live product, so Pro is on sale', () => {
  assert.deepEqual(IDS, { businessId: 'bus_0NovOiw7BWcWBklPQGJnm', productId: 'pdt_0NozAx8DIrAKXP1RGcqn7' })
  assert.equal(onSale(IDS), true)
  assert.equal(onSale({ businessId: 'bus_0NovOiw7BWcWBklPQGJnm', productId: '' }), false)
})

test('deactivate: any other 4xx is a refusal with its status; 408, 429 and 5xx stay offline', async () => {
  const at = (status) => deactivate('K', 'lki_1', { fetch: fakeFetch({ deactivate: { status, json: {} } }) })
  for (const s of [400, 401, 422]) assert.deepEqual(await at(s), { refused: s }, String(s))
  for (const s of [408, 429, 500, 503]) assert.deepEqual(await at(s), { offline: true }, String(s))
})
