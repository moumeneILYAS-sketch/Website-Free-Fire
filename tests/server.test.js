'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, validateOrderItems, validateProductInput, buildDemoProducts } = require('../server.js');

async function withServer(callback) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function postJson(baseUrl, path, body, headers = {}) {
  return fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('catalog has valid unique ids, slugs, categories and integer DZD prices', () => {
  const products = buildDemoProducts();
  assert.equal(products.length, 8);
  assert.equal(new Set(products.map(p => p.id)).size, products.length);
  assert.equal(new Set(products.map(p => p.slug)).size, products.length);
  for (const product of products) {
    assert.match(product.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(['diamonds', 'codes', 'skins', 'emotes'].includes(product.category));
    assert.ok(Number.isSafeInteger(product.price) && product.price > 0);
    assert.equal(product.currency, 'DZD');
  }
});

test('order validation merges duplicates and calculates price from the server catalog', () => {
  const products = buildDemoProducts();
  const result = validateOrderItems([
    { productId: 1, quantity: 2, price: 1 },
    { productId: 1, quantity: 1 }
  ], products);
  assert.equal(result.count, 3);
  assert.equal(result.total, 750);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].unitPrice, 250);
});

test('order validation rejects unknown products and invalid quantities', () => {
  const products = buildDemoProducts();
  assert.throws(() => validateOrderItems([{ productId: 999, quantity: 1 }], products), /غير متاح/);
  assert.throws(() => validateOrderItems([{ productId: 1, quantity: 0 }], products), /غير صالح/);
  assert.throws(() => validateOrderItems([{ productId: 1, quantity: 21 }], products), /غير صالح/);
  assert.throws(() => validateOrderItems([], products), /عنصر/);
});

test('admin product validation limits categories and slugs', () => {
  const input = { name: 'منتج اختبار', slug: 'demo-product', category: 'skins', description: 'وصف', price: 300, emoji: '✦', badge: 'تجريبي' };
  assert.equal(validateProductInput(input).price, 300);
  assert.throws(() => validateProductInput({ ...input, slug: '../escape' }), /slug/);
  assert.throws(() => validateProductInput({ ...input, category: 'unknown' }), /الفئة/);
  assert.throws(() => validateProductInput({ ...input, price: 0 }), /السعر/);
});

test('home page serves the storefront and security headers', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(baseUrl + '/');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /BlueDrop/);
    assert.match(html, /id="productGrid"/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

test('Google sign-in endpoint is disabled unless the owner configures it', async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousSecret = process.env.AUTH_SESSION_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.AUTH_SESSION_SECRET;
  try {
    await withServer(async baseUrl => {
      const response = await fetch(baseUrl + '/api/auth/google');
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.enabled, false);
      assert.equal(data.user, null);
    });
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousSecret;
  }
});

test('storefront exposes demo-only account and payment controls', async () => {
  await withServer(async baseUrl => {
    const html = await (await fetch(baseUrl + '/')).text();
    assert.match(html, /googleSignInFallback/);
    for (const method of ['edahabia', 'cib', 'visa', 'mastercard', 'paypal', 'baridimob']) {
      assert.match(html, new RegExp('value="' + method + '"'));
    }
    assert.match(html, /لا تُحوّل أي مبلغ/);
  });
});

test('health and products endpoints respond in memory demo mode', async () => {
  await withServer(async baseUrl => {
    const healthResponse = await fetch(baseUrl + '/api/health');
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.mode, 'memory-demo');
    assert.equal(health.paymentsEnabled, false);
    assert.equal(health.fulfillmentEnabled, false);

    const productResponse = await fetch(baseUrl + '/api/products');
    const catalog = await productResponse.json();
    assert.equal(productResponse.status, 200);
    assert.equal(catalog.products.length, 8);
    assert.equal(catalog.currency, 'DZD');
  });
});

test('demo order validates payload and never echoes the player id', async () => {
  await withServer(async baseUrl => {
    const response = await postJson(baseUrl, '/api/orders', {
      playerId: '12345678',
      paymentMethod: 'baridimob',
      items: [{ productId: 1, quantity: 2, price: 1 }]
    }, { 'Idempotency-Key': 'test-order-key-01' });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.equal(result.ok, true);
    assert.equal(result.order.total, 500);
    assert.equal(result.order.status, 'DEMO_ONLY_NOT_FULFILLED');
    assert.equal(result.order.paymentMethod, 'baridimob');
    assert.equal(Object.hasOwn(result.order, 'playerId'), false);
    assert.equal(JSON.stringify(result).includes('12345678'), false);
  });
});

test('idempotency returns the same demo order for a repeated matching request', async () => {
  await withServer(async baseUrl => {
    const body = { playerId: '', paymentMethod: 'edahabia', items: [{ productId: 2, quantity: 1 }] };
    const headers = { 'Idempotency-Key': 'test-idempotency-02' };
    const first = await (await postJson(baseUrl, '/api/orders', body, headers)).json();
    const secondResponse = await postJson(baseUrl, '/api/orders', body, headers);
    const second = await secondResponse.json();
    assert.equal(secondResponse.status, 201);
    assert.equal(second.order.reference, first.order.reference);
    const changedMethod = await postJson(baseUrl, '/api/orders', {
      ...body, paymentMethod: 'cib'
    }, headers);
    assert.equal(changedMethod.status, 409, 'idempotency must include the selected demo payment method');
  });
});

test('order endpoint rejects an idempotency key reused for a different cart', async () => {
  await withServer(async baseUrl => {
    const key = { 'Idempotency-Key': 'test-idempotency-03' };
    await postJson(baseUrl, '/api/orders', { items: [{ productId: 1, quantity: 1 }] }, key);
    const response = await postJson(baseUrl, '/api/orders', { items: [{ productId: 2, quantity: 1 }] }, key);
    assert.equal(response.status, 409);
  });
});

test('order endpoint rejects invalid identifiers, missing keys, bad content type and foreign origins', async () => {
  await withServer(async baseUrl => {
    const invalidId = await postJson(baseUrl, '/api/orders', { playerId: '12', items: [{ productId: 1, quantity: 1 }] }, { 'Idempotency-Key': 'test-invalid-id-04' });
    assert.equal(invalidId.status, 400);

    const missingKey = await postJson(baseUrl, '/api/orders', { items: [{ productId: 1, quantity: 1 }] });
    assert.equal(missingKey.status, 400);

    const foreignOrigin = await postJson(baseUrl, '/api/orders', { items: [{ productId: 1, quantity: 1 }] }, { 'Idempotency-Key': 'test-origin-check-05', Origin: 'https://example.invalid' });
    assert.equal(foreignOrigin.status, 403);

    const badType = await fetch(baseUrl + '/api/orders', { method: 'POST', headers: { 'Idempotency-Key': 'test-content-type-06', 'Content-Type': 'text/plain' }, body: 'nope' });
    assert.equal(badType.status, 415);
  });
});

test('server does not expose internal files', async () => {
  await withServer(async baseUrl => {
    for (const route of ['/server.js', '/package.json', '/database/schema.sql', '/.env', '/.git/config']) {
      const response = await fetch(baseUrl + route);
      assert.equal(response.status, 404, `${route} should not be publicly served`);
    }
  });
});

test('admin routes are unavailable until credentials are configured', async () => {
  await withServer(async baseUrl => {
    const page = await fetch(baseUrl + '/admin');
    assert.equal(page.status, 503);
    assert.match(await page.text(), /لوحة الإدارة غير متاحة/);
    const apiResponse = await fetch(baseUrl + '/api/admin/overview');
    assert.equal(apiResponse.status, 503);
  });
});
