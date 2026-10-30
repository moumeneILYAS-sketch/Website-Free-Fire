'use strict';

const crypto = require('node:crypto');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_COOKIE = 'bd_session';
const CSRF_COOKIE = 'bd_oauth_csrf';
const NONCE_COOKIE = 'bd_oauth_nonce';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const BOOTSTRAP_SECONDS = 10 * 60;
let jwksCache = { keys: [], expiresAt: 0 };

function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  return res.end(JSON.stringify(payload));
}

function cookieMap(req) {
  const header = String((req.headers && req.headers.cookie) || '');
  const values = new Map();
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    values.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return values;
}

function isSecureRequest(req) {
  const forwarded = String((req.headers && req.headers['x-forwarded-proto']) || '')
    .split(',')[0].trim().toLowerCase();
  return process.env.NODE_ENV === 'production' || forwarded === 'https';
}

function cookie(name, value, options = {}) {
  const parts = [name + '=' + value, 'Path=' + (options.path || '/'), 'SameSite=' + (options.sameSite || 'Strict')];
  if (options.maxAge !== undefined) parts.push('Max-Age=' + options.maxAge);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function setCookies(res, values) {
  res.setHeader('Set-Cookie', values);
}

function sameOrigin(req) {
  const origin = String((req.headers && req.headers.origin) || '');
  const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '')
    .split(',')[0].trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function googleConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = String(process.env.AUTH_SESSION_SECRET || '');
  return {
    enabled: Boolean(clientId && secret.length >= 32),
    clientId,
    secret
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function encryptSession(user, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.from(JSON.stringify({
    sub: user.sub,
    email: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return [iv, encrypted, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
}

function decryptSession(value, secret) {
  if (!value || value.length > 4096) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, encrypted, tag] = parts.map(part => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length > 3000) return null;
    const key = crypto.createHash('sha256').update(secret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const user = JSON.parse(payload.toString('utf8'));
    if (!user || typeof user.sub !== 'string' || typeof user.email !== 'string' ||
        !Number.isSafeInteger(user.exp) || user.exp <= Math.floor(Date.now() / 1000)) return null;
    return { sub: user.sub, email: user.email, name: String(user.name || user.email).slice(0, 120) };
  } catch {
    return null;
  }
}

function maxAgeFromCacheControl(value) {
  const match = String(value || '').match(/max-age=(\d+)/i);
  return match ? Math.max(60, Math.min(Number(match[1]), 6 * 60 * 60)) : 60 * 60;
}

async function googleKeys() {
  if (jwksCache.keys.length && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(GOOGLE_CERTS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error('Google key service is unavailable.');
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error('Google returned an invalid signing-key list.');
  }
  jwksCache = {
    keys: payload.keys.filter(key => key && key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' && key.kid),
    expiresAt: Date.now() + maxAgeFromCacheControl(response.headers.get('cache-control')) * 1000
  };
  if (!jwksCache.keys.length) throw new Error('No supported Google signing keys were found.');
  return jwksCache.keys;
}

function decodeJwtPart(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token encoding.');
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function verifyGoogleCredential(token, clientId, expectedNonce) {
  if (typeof token !== 'string' || token.length > 16000) throw new Error('Invalid Google credential.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid Google credential.');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported Google token.');
  const keys = await googleKeys();
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) {
    jwksCache.expiresAt = 0;
    throw new Error('Google signing key was not found.');
  }
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parts[0] + '.' + parts[1]),
    publicKey,
    Buffer.from(parts[2], 'base64url')
  );
  if (!validSignature) throw new Error('Google credential signature is invalid.');

  const now = Math.floor(Date.now() / 1000);
  const audienceMatches = claims.aud === clientId ||
    (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  const issuerMatches = claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
  if (!issuerMatches || !audienceMatches || (Array.isArray(claims.aud) && claims.azp !== clientId)) {
    throw new Error('Google credential issuer or audience does not match.');
  }
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      !Number.isSafeInteger(claims.iat) || claims.iat > now + 300) {
    throw new Error('Google credential has expired or has an invalid issue time.');
  }
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, expectedNonce)) {
    throw new Error('Google sign-in nonce does not match.');
  }
  if (claims.email_verified !== true || typeof claims.email !== 'string' ||
      typeof claims.sub !== 'string' || claims.sub.length > 255) {
    throw new Error('A verified Google account is required.');
  }
  return {
    sub: claims.sub,
    email: claims.email.slice(0, 254),
    name: String(claims.name || claims.email).slice(0, 120)
  };
}

async function readPayload(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const raw = String(req.body);
    if (raw.length > 20000) throw Object.assign(new Error('حجم الطلب كبير جدًا.'), { statusCode: 413 });
    try { return JSON.parse(raw || '{}'); }
    catch { throw Object.assign(new Error('صيغة بيانات الطلب غير صحيحة.'), { statusCode: 400 }); }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', chunk => {
      raw += chunk.toString('utf8');
      if (raw.length > 20000) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('حجم الطلب كبير جدًا.'), { statusCode: 413 }));
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(Object.assign(new Error('صيغة بيانات الطلب غير صحيحة.'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function clearAuthCookies(res, secure) {
  setCookies(res, [
    cookie(CSRF_COOKIE, '', { path: '/api/auth/google', maxAge: 0, secure }),
    cookie(NONCE_COOKIE, '', { path: '/api/auth/google', maxAge: 0, secure }),
    cookie(SESSION_COOKIE, '', { path: '/', maxAge: 0, sameSite: 'Lax', secure })
  ]);
}

async function handleGoogleAuth(req, res) {
  const secure = isSecureRequest(req);
  const config = googleConfig();

  if (req.method === 'GET') {
    const csrfToken = config.enabled ? crypto.randomBytes(32).toString('base64url') : '';
    const nonce = config.enabled ? crypto.randomBytes(32).toString('base64url') : '';
    if (config.enabled) {
      setCookies(res, [
        cookie(CSRF_COOKIE, csrfToken, { path: '/api/auth/google', maxAge: BOOTSTRAP_SECONDS, secure }),
        cookie(NONCE_COOKIE, nonce, { path: '/api/auth/google', maxAge: BOOTSTRAP_SECONDS, secure })
      ]);
    } else {
      clearAuthCookies(res, secure);
    }
    const user = config.enabled ? decryptSession(cookieMap(req).get(SESSION_COOKIE), config.secret) : null;
    return sendJson(res, 200, {
      ok: true,
      enabled: config.enabled,
      clientId: config.enabled ? config.clientId : null,
      csrfToken,
      nonce,
      user
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'طريقة الطلب غير مدعومة.' }, { Allow: 'GET, POST' });
  }
  if (!config.enabled) {
    return sendJson(res, 503, { ok: false, enabled: false, error: 'تسجيل Google غير مهيأ بعد.' });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'تم رفض مصدر الطلب.' });
  if (!String((req.headers && req.headers['content-type']) || '').toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'صيغة JSON مطلوبة.' });
  }

  const cookies = cookieMap(req);
  const csrfCookie = cookies.get(CSRF_COOKIE) || '';
  const csrfHeader = String((req.headers && req.headers['x-bluedrop-csrf']) || '');
  if (!csrfCookie || !safeEqual(csrfCookie, csrfHeader)) {
    return sendJson(res, 403, { ok: false, error: 'انتهت صلاحية جلسة تسجيل الدخول. حدّث الصفحة وحاول مرة أخرى.' });
  }

  try {
    const payload = await readPayload(req);
    if (payload.action === 'logout') {
      clearAuthCookies(res, secure);
      return sendJson(res, 200, { ok: true, user: null });
    }

    const nonce = cookies.get(NONCE_COOKIE) || '';
    const user = await verifyGoogleCredential(payload.credential, config.clientId, nonce);
    const session = encryptSession(user, config.secret);
    setCookies(res, [
      cookie(CSRF_COOKIE, '', { path: '/api/auth/google', maxAge: 0, secure }),
      cookie(NONCE_COOKIE, '', { path: '/api/auth/google', maxAge: 0, secure }),
      cookie(SESSION_COOKIE, session, { path: '/', maxAge: SESSION_SECONDS, sameSite: 'Lax', secure })
    ]);
    return sendJson(res, 200, { ok: true, user });
  } catch (error) {
    const status = error.statusCode || (error.message && error.message.includes('Google key service') ? 503 : 401);
    return sendJson(res, status, {
      ok: false,
      error: status === 503
        ? 'تعذر الاتصال بخدمة التحقق من Google. حاول مرة أخرى.'
        : 'تعذر التحقق من حساب Google. أعد المحاولة.'
    });
  }
}

module.exports = {
  handleGoogleAuth,
  verifyGoogleCredential,
  decryptSession,
  encryptSession,
  googleConfig
};
