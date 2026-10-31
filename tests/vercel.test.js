'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { handleProducts, handleHealth, handleOrder } = require('../lib/vercel-api');
const { handleGoogleAuth, encryptSession, decryptSession, verifyGoogleCredential } = require('../lib/google-auth');

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = body; this.ended = true; }
  };
}

function parsed(res) {
  return JSON.parse(res.body || '{}');
}

test('Vercel npm commands sanitize pnpm-only cache-dir and Node is pinned', () => {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(config.installCommand, /env -u npm_config_cache_dir -u NPM_CONFIG_CACHE_DIR npm install/);
  assert.match(config.buildCommand, /env -u npm_config_cache_dir -u NPM_CONFIG_CACHE_DIR npm run vercel-build/);
  assert.equal(config.outputDirectory, 'public');
  assert.equal(pkg.engines.node, '24.x');
});

test('Vercel product endpoint returns the bundled demo catalog', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const res = mockResponse();
    await handleProducts({ method: 'GET', headers: {} }, res);
    const data = parsed(res);
    assert.equal(res.statusCode, 200);
    assert.equal(data.ok, true);
    assert.ok(data.products.length >= 8);
    assert.ok(data.products.every(product => Number.isSafeInteger(product.price) && product.price > 0));
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('Vercel health endpoint explicitly reports that live commerce is disabled', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const res = mockResponse();
    await handleHealth({ method: 'GET', headers: {} }, res);
    const data = parsed(res);
    assert.equal(res.statusCode, 200);
    assert.equal(data.paymentsEnabled, false);
    assert.equal(data.fulfillmentEnabled, false);
    assert.equal(data.demoOrdersEnabled, false);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('Vercel order endpoint will not claim an order was created without a database', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const res = mockResponse();
    await handleOrder({
      method: 'POST',
      url: '/api/orders',
      headers: {
        host: 'example.vercel.app',
        origin: 'https://example.vercel.app',
        'content-type': 'application/json',
        'idempotency-key': 'test-key-12345678'
      },
      body: { playerId: '', items: [{ productId: 1, quantity: 1 }] },
      socket: { remoteAddress: '127.0.0.1' }
    }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(parsed(res).ok, false);
    assert.match(parsed(res).error, /PostgreSQL/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('Vercel API rejects unsupported methods', async () => {
  const res = mockResponse();
  await handleProducts({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
});


test('Vercel build output contains the home page and every referenced local asset', () => {
  const root = path.resolve(__dirname, '..');
  for (const filename of ['index.html', 'styles.css', 'app.js', 'catalog.js', 'favicon.svg']) {
    const output = path.join(root, 'public', filename);
    assert.equal(fs.existsSync(output), true, 'missing public/' + filename);
    assert.equal(fs.statSync(output).isFile(), true, 'not a file: public/' + filename);
  }
  assert.equal(
    fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'),
    fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
    'public homepage must be built from the repository source'
  );
});

test('Google sign-in stays disabled until both owner environment values are configured', async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousSessionSecret = process.env.AUTH_SESSION_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.AUTH_SESSION_SECRET;
  try {
    const res = mockResponse();
    await handleGoogleAuth({ method: 'GET', headers: {} }, res);
    const data = parsed(res);
    assert.equal(res.statusCode, 200);
    assert.equal(data.ok, true);
    assert.equal(data.enabled, false);
    assert.equal(data.clientId, null);
    assert.equal(data.user, null);
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousSessionSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousSessionSecret;
  }
});

test('Google sign-in refuses a credential when OAuth is not configured', async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousSessionSecret = process.env.AUTH_SESSION_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.AUTH_SESSION_SECRET;
  try {
    const res = mockResponse();
    await handleGoogleAuth({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { credential: 'not-a-real-token' }
    }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(parsed(res).enabled, false);
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousSessionSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousSessionSecret;
  }
});

test('Google account session cookie is encrypted and expires safely', () => {
  const secret = 'test-only-session-secret-with-more-than-32-characters';
  const user = { sub: 'google-subject', email: 'player@example.test', name: 'Demo User' };
  const token = encryptSession(user, secret);
  assert.notEqual(token, JSON.stringify(user));
  assert.deepEqual(decryptSession(token, secret), user);
  assert.equal(decryptSession(token, 'a-different-session-secret-that-is-long-enough'), null);
  const tampered = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
  assert.equal(decryptSession(tampered, secret), null);
});

test('Google ID-token verification checks an RS256 signature, audience and nonce', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const nonce = 'n'.repeat(40);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'bluedrop-test-key', typ: 'JWT' };
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'bluedrop-test-client',
    exp: now + 300,
    iat: now,
    nonce,
    email_verified: true,
    email: 'demo@example.test',
    sub: 'google-test-subject',
    name: 'BlueDrop Test'
  };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = encode(header) + '.' + encode(claims);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url');
  const token = input + '.' + signature;
  const previousFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    keys: [{ kty: 'RSA', n: jwk.n, e: jwk.e, kid: 'bluedrop-test-key', alg: 'RS256', use: 'sig' }]
  }), { status: 200, headers: { 'cache-control': 'max-age=60' } });
  try {
    const user = await verifyGoogleCredential(token, 'bluedrop-test-client', nonce);
    assert.deepEqual(user, {
      sub: 'google-test-subject',
      email: 'demo@example.test',
      name: 'BlueDrop Test'
    });
    await assert.rejects(
      verifyGoogleCredential(token, 'bluedrop-test-client', 'x'.repeat(40)),
      /nonce/
    );
  } finally {
    global.fetch = previousFetch;
  }
});
