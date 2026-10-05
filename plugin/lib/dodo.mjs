// The only code that talks to the network (spec 2026-10-04-license §1). Dodo's license endpoints are
// public: no API key ships in the plugin. Changing provider means replacing this file alone.
export const BASE = 'https://live.dodopayments.com'
// The live product (docs/NEXT.md §2). Empty would mean not on sale (spec §3.2).
export const IDS = { businessId: 'bus_0NovOiw7BWcWBklPQGJnm', productId: 'pdt_0NozAx8DIrAKXP1RGcqn7' }
export const onSale = (ids = IDS) => Boolean(ids.businessId && ids.productId)
// The checkout /turnslip:buy opens: the same link as the site's Buy button (test/site.test.mjs).
export const checkoutUrl = (ids = IDS) =>
  `https://checkout.dodopayments.com/buy/${ids.productId}?quantity=1&redirect_url=https%3A%2F%2Fturnslip.dev%2Fthanks`

async function post(path, body, { fetch = globalThis.fetch, base = BASE, timeoutMs = 10_000 } = {}) {
  // A ref'd timer (not AbortSignal.timeout, whose timer is unref'd) so the process waits for the deadline.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs)
  try {
    const res = await fetch(`${base}/licenses/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
    })
    let json = null
    try { json = await res.json() } catch {}
    return { status: res.status, json }
  } catch {
    return { status: 0, json: null } // network error or timeout
  } finally {
    clearTimeout(timer)
  }
}

export async function activate(key, name, opts) {
  const { status, json } = await post('activate', { license_key: key, name }, opts)
  if (status >= 200 && status < 300) {
    if (typeof json?.id !== 'string') return { offline: true }
    return { ok: true, instanceId: json.id, businessId: json.business_id ?? null, productId: json.product?.product_id ?? null }
  }
  if (status === 403) return { invalid: true }
  if (status === 404) return { unknown: true }
  if (status === 422) return { limit: true }
  return { offline: true }
}

// Only an explicit valid:false revokes; anything ambiguous counts as offline.
export async function validate(key, instanceId, opts) {
  const { status, json } = await post('validate', { license_key: key, license_key_instance_id: instanceId }, opts)
  if (status === 200 && typeof json?.valid === 'boolean') return json.valid ? { ok: true } : { invalid: true }
  return { offline: true }
}

export async function deactivate(key, instanceId, opts) {
  const { status } = await post('deactivate', { license_key: key, license_key_instance_id: instanceId }, opts)
  if (status >= 200 && status < 300) return { ok: true }
  if (status === 403) return { invalid: true }
  if (status === 404) return { unknown: true }
  // Any other 4xx is Dodo saying no, not Dodo out of reach; 408 and 429 are worth a retry.
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return { refused: status }
  return { offline: true }
}
