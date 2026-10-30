'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const catalogSeed = require('./catalog.js');
const { handleGoogleAuth } = require('./lib/google-auth.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATABASE_URL = process.env.DATABASE_URL || '';
const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

let pool = null;
if (DATABASE_URL) {
  // PostgreSQL is only loaded when a database has explicitly been configured.
  // The no-dependency demo still runs locally without a database.
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });
  pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error.message));
}

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
});

const STATIC_FILES = new Map([
  ['/index.html', path.join(ROOT, 'index.html')],
  ['/styles.css', path.join(ROOT, 'styles.css')],
  ['/app.js', path.join(ROOT, 'app.js')],
  ['/catalog.js', path.join(ROOT, 'catalog.js')],
  ['/favicon.svg', path.join(ROOT, 'public', 'favicon.svg')],
  ['/admin/admin.css', path.join(ROOT, 'admin', 'admin.css')],
  ['/admin/admin.js', path.join(ROOT, 'admin', 'admin.js')]
]);

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(text);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function buildDemoProducts() {
  return catalogSeed.map(product => ({ ...product }));
}

function normalizeProduct(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    category: row.category,
    name: row.name,
    description: row.description,
    price: Number(row.price_dzd ?? row.price),
    currency: row.currency || 'DZD',
    emoji: row.emoji || '✦',
    badge: row.badge || 'تجريبي',
    badgeType: row.badge_type ?? row.badgeType ?? '',
    featured: Number(row.featured || row.id),
    active: row.active !== false
  };
}

async function listProducts() {
  if (!pool) return buildDemoProducts().filter(product => product.active);
  const result = await pool.query(
    `SELECT id, slug, category, name, description, price_dzd, currency,
            emoji, badge, badge_type, featured, active
       FROM products
      WHERE active = TRUE
      ORDER BY featured ASC, id ASC`
  );
  return result.rows.map(normalizeProduct);
}

function validateOrderItems(input, products) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) {
    throw Object.assign(new Error('اختر من عنصر واحد إلى 10 عناصر مختلفة.'), { statusCode: 400 });
  }

  const merged = new Map();
  for (const entry of input) {
    const productId = Number(entry && entry.productId);
    const quantity = Number(entry && entry.quantity);
    if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw Object.assign(new Error('معرّف المنتج أو الكمية غير صالح.'), { statusCode: 400 });
    }
    const product = products.find(item => Number(item.id) === productId && item.active !== false);
    if (!product) {
      throw Object.assign(new Error('أحد المنتجات غير متاح.'), { statusCode: 400 });
    }
    const combined = (merged.get(productId) || 0) + quantity;
    if (combined > 20) {
      throw Object.assign(new Error('الحد الأقصى التجريبي هو 20 من كل عنصر.'), { statusCode: 400 });
    }
    merged.set(productId, combined);
  }

  const items = [...merged.entries()].map(([productId, quantity]) => {
    const product = products.find(item => Number(item.id) === productId);
    return {
      productId,
      name: product.name,
      unitPrice: Number(product.price),
      quantity,
      lineTotal: Number(product.price) * quantity
    };
  });
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(count)) {
    throw Object.assign(new Error('تعذر حساب المجموع التجريبي.'), { statusCode: 400 });
  }
  return { items, total, count };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        body = '';
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('حجم الطلب كبير جدًا.'), { statusCode: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('صيغة بيانات الطلب غير صحيحة.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients can still call the demo API.
  try {
    return new URL(origin).host === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  const sameLength = a.length === b.length;
  const compareWith = sameLength ? b : Buffer.alloc(a.length);
  const matched = crypto.timingSafeEqual(a, compareWith);
  return sameLength && matched;
}

function adminCredentials(req) {
  const username = process.env.ADMIN_USERNAME || '';
  const password = process.env.ADMIN_PASSWORD || '';
  if (!username || password.length < 16) return { configured: false, valid: false, username: '' };

  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return { configured: true, valid: false, username: '' };
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { return { configured: true, valid: false, username: '' }; }
  const splitAt = decoded.indexOf(':');
  if (splitAt < 0) return { configured: true, valid: false, username: '' };
  const suppliedUser = decoded.slice(0, splitAt);
  const suppliedPassword = decoded.slice(splitAt + 1);
  const valid = constantTimeEqual(suppliedUser, username) && constantTimeEqual(suppliedPassword, password);
  return { configured: true, valid, username: valid ? username : '' };
}

function authorizeAdmin(req, res) {
  const result = adminCredentials(req);
  if (!result.configured) {
    sendJson(res, 503, { ok: false, error: 'لوحة الإدارة غير مهيأة. اضبط ADMIN_USERNAME وADMIN_PASSWORD (16 حرفًا على الأقل).' });
    return false;
  }
  if (!result.valid) {
    sendJson(res, 401, { ok: false, error: 'يلزم تسجيل الدخول إلى لوحة الإدارة.' }, {
      'WWW-Authenticate': 'Basic realm="BlueDrop Admin", charset="UTF-8"'
    });
    return false;
  }
  if (NODE_ENV === 'production' && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() !== 'https') {
    sendJson(res, 403, { ok: false, error: 'يجب الوصول إلى لوحة الإدارة عبر HTTPS.' });
    return false;
  }
  return result;
}

const memoryOrders = [];
const idempotency = new Map();
const rateCounts = new Map();

function withinRateLimit(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const item = rateCounts.get(key);
  if (!item || now - item.startedAt >= RATE_WINDOW_MS) {
    rateCounts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  item.count += 1;
  if (rateCounts.size > 10_000) rateCounts.clear();
  return item.count > RATE_LIMIT;
}

function getIdempotencyKey(req) {
  const value = String(req.headers['idempotency-key'] || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(value)) {
    throw Object.assign(new Error('انتهت صلاحية مفتاح الطلب. أغلق النافذة وحاول مرة أخرى.'), { statusCode: 400 });
  }
  return value;
}

async function createDemoOrder(req, res) {
  if (!isSameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'تم رفض مصدر الطلب.' });
  if (withinRateLimit(req)) return sendJson(res, 429, { ok: false, error: 'طلبات كثيرة خلال وقت قصير. حاول بعد قليل.' });
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'يجب إرسال الطلب بصيغة JSON.' });
  }
  if (NODE_ENV === 'production' && !pool) {
    return sendJson(res, 503, { ok: false, error: 'الطلبات معطلة في الإنتاج حتى يتم إعداد قاعدة بيانات دائمة.' });
  }

  try {
    const payload = await readJson(req);
    if (payload.playerId !== undefined && payload.playerId !== '' &&
        (typeof payload.playerId !== 'string' || !/^[0-9]{6,16}$/.test(payload.playerId.trim()))) {
      return sendJson(res, 400, { ok: false, error: 'معرّف اللاعب يجب أن يكون من 6 إلى 16 رقمًا أو يُترك فارغًا.' });
    }
    // The player ID is deliberately not persisted or returned. This is not a fulfillment service.
    const key = getIdempotencyKey(req);
    const products = await listProducts();
    const normalized = validateOrderItems(payload.items, products);
    const paymentMethod = String(payload.paymentMethod || 'edahabia');
    if (!['cib', 'edahabia', 'visa', 'mastercard', 'paypal', 'baridimob'].includes(paymentMethod)) {
      return sendJson(res, 400, { ok: false, error: 'وسيلة الدفع التجريبية غير صالحة.' });
    }
    const requestHash = crypto.createHash('sha256')
      .update(JSON.stringify({ items: normalized.items, paymentMethod })).digest('hex');

    let order;
    if (pool) {
      const inserted = await pool.query(
        `INSERT INTO demo_orders (reference, idempotency_key, request_hash, status, currency, payment_method, total_dzd, item_count, items_json)
         VALUES ($1,$2,$3,'DEMO_ONLY_NOT_FULFILLED','DZD',$4,$5,$6,$7::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING reference, status, currency, payment_method, total_dzd, item_count, items_json, created_at`,
        [crypto.randomBytes(5).toString('hex').toUpperCase(), key, requestHash, paymentMethod, normalized.total, normalized.count, JSON.stringify(normalized.items)]
      );
      if (inserted.rows.length) order = mapOrderRow(inserted.rows[0]);
      else {
        const prior = await pool.query('SELECT reference, request_hash, status, currency, payment_method, total_dzd, item_count, items_json, created_at FROM demo_orders WHERE idempotency_key = $1', [key]);
        const row = prior.rows[0];
        if (!row || row.request_hash !== requestHash) {
          return sendJson(res, 409, { ok: false, error: 'مفتاح الطلب مستخدم لطلب مختلف. ابدأ معاينة جديدة.' });
        }
        order = mapOrderRow(row);
      }
    } else {
      const prior = idempotency.get(key);
      if (prior) {
        if (prior.requestHash !== requestHash) return sendJson(res, 409, { ok: false, error: 'مفتاح الطلب مستخدم لطلب مختلف. ابدأ معاينة جديدة.' });
        order = prior.order;
      } else {
        order = {
          reference: crypto.randomBytes(5).toString('hex').toUpperCase(),
          status: 'DEMO_ONLY_NOT_FULFILLED',
          currency: 'DZD',
          paymentMethod,
          total: normalized.total,
          itemCount: normalized.count,
          items: normalized.items,
          createdAt: new Date().toISOString()
        };
        idempotency.set(key, { requestHash, order });
        memoryOrders.unshift(order);
        if (memoryOrders.length > 200) memoryOrders.length = 200;
        if (idempotency.size > 1000) idempotency.delete(idempotency.keys().next().value);
      }
    }
    return sendJson(res, 201, { ok: true, order: publicOrder(order), note: 'طلب تجريبي فقط: لا دفع ولا شحن.' });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'تعذر إنشاء الطلب التجريبي.' });
  }
}

function mapOrderRow(row) {
  return {
    reference: row.reference,
    status: row.status,
    currency: row.currency,
    paymentMethod: row.payment_method || 'edahabia',
    total: Number(row.total_dzd),
    itemCount: Number(row.item_count),
    items: typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function publicOrder(order) {
  return {
    reference: order.reference,
    status: order.status,
    currency: order.currency,
    paymentMethod: order.paymentMethod || 'edahabia',
    total: order.total,
    itemCount: order.itemCount,
    items: order.items,
    createdAt: order.createdAt
  };
}

async function recordAdminAudit(actor, action, entityType, entityId, details = {}) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO admin_audit_events (actor, action, entity_type, entity_id, details_json) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [actor, action, entityType, String(entityId || ''), JSON.stringify(details)]
  );
}

function validateProductInput(input, partial = false) {
  const output = {};
  if (!partial || Object.hasOwn(input, 'slug')) {
    if (typeof input.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 90) throw Object.assign(new Error('المعرّف slug يجب أن يحتوي على حروف إنجليزية صغيرة وأرقام وشرطات فقط.'), { statusCode: 400 });
    output.slug = input.slug;
  }
  if (!partial || Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 90) throw Object.assign(new Error('اسم المنتج مطلوب (2–90 حرفًا).'), { statusCode: 400 });
    output.name = input.name.trim();
  }
  if (!partial || Object.hasOwn(input, 'category')) {
    if (!['diamonds', 'codes', 'skins', 'emotes'].includes(input.category)) throw Object.assign(new Error('الفئة غير صالحة.'), { statusCode: 400 });
    output.category = input.category;
  }
  if (!partial || Object.hasOwn(input, 'description')) {
    if (typeof input.description !== 'string' || input.description.trim().length > 500) throw Object.assign(new Error('الوصف غير صالح (حتى 500 حرف).'), { statusCode: 400 });
    output.description = input.description.trim();
  }
  if (!partial || Object.hasOwn(input, 'price')) {
    if (!Number.isSafeInteger(input.price) || input.price < 1 || input.price > 100_000_000) throw Object.assign(new Error('السعر يجب أن يكون عددًا صحيحًا موجبًا ضمن الحدود.'), { statusCode: 400 });
    output.price = input.price;
  }
  if (!partial || Object.hasOwn(input, 'emoji')) {
    if (typeof input.emoji !== 'string' || input.emoji.length < 1 || input.emoji.length > 12) throw Object.assign(new Error('رمز المنتج غير صالح.'), { statusCode: 400 });
    output.emoji = input.emoji;
  }
  if (!partial || Object.hasOwn(input, 'badge')) {
    if (input.badge !== undefined && (typeof input.badge !== 'string' || input.badge.length > 40)) throw Object.assign(new Error('الشارة غير صالحة.'), { statusCode: 400 });
    output.badge = String(input.badge || 'تجريبي').trim();
  }
  if (partial && Object.hasOwn(input, 'active')) {
    if (typeof input.active !== 'boolean') throw Object.assign(new Error('حالة المنتج يجب أن تكون true أو false.'), { statusCode: 400 });
    output.active = input.active;
  }
  return output;
}

async function adminApi(req, res, url) {
  const auth = authorizeAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    let orderCount = memoryOrders.length;
    if (pool) {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM demo_orders');
      orderCount = result.rows[0].count;
    }
    return sendJson(res, 200, {
      ok: true,
      mode: pool ? 'postgres-demo' : 'memory-demo',
      database: Boolean(pool),
      orderCount,
      paymentsEnabled: false,
      fulfillmentEnabled: false
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
    if (pool) {
      const result = await pool.query('SELECT reference, status, currency, payment_method, total_dzd, item_count, items_json, created_at FROM demo_orders ORDER BY created_at DESC LIMIT 100');
      return sendJson(res, 200, { ok: true, orders: result.rows.map(mapOrderRow).map(publicOrder) });
    }
    return sendJson(res, 200, { ok: true, orders: memoryOrders.map(publicOrder) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/products') {
    return sendJson(res, 200, { ok: true, products: await listProducts() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/products') {
    if (!pool) return sendJson(res, 503, { ok: false, error: 'تعديل المنتجات يتطلب إعداد قاعدة PostgreSQL دائمة.' });
    if (!isSameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'تم رفض مصدر الطلب.' });
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) return sendJson(res, 415, { ok: false, error: 'صيغة JSON مطلوبة.' });
    const data = validateProductInput(await readJson(req));
    const result = await pool.query(
      `INSERT INTO products (slug, category, name, description, price_dzd, currency, emoji, badge, badge_type, featured, active)
       VALUES ($1,$2,$3,$4,$5,'DZD',$6,$7,'',999,TRUE)
       RETURNING id, slug, category, name, description, price_dzd, currency, emoji, badge, badge_type, featured, active`,
      [data.slug, data.category, data.name, data.description, data.price, data.emoji, data.badge]
    );
    await recordAdminAudit(auth.username, 'product.create', 'product', result.rows[0].id, { slug: data.slug });
    return sendJson(res, 201, { ok: true, product: normalizeProduct(result.rows[0]) });
  }

  const match = url.pathname.match(/^\/api\/admin\/products\/(\d+)$/);
  if (req.method === 'PATCH' && match) {
    if (!pool) return sendJson(res, 503, { ok: false, error: 'تعديل المنتجات يتطلب إعداد قاعدة PostgreSQL دائمة.' });
    if (!isSameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'تم رفض مصدر الطلب.' });
    const id = Number(match[1]);
    const input = await readJson(req);
    const changes = validateProductInput(input, true);
    const allowedColumns = { slug: 'slug', category: 'category', name: 'name', description: 'description', price: 'price_dzd', emoji: 'emoji', badge: 'badge', active: 'active' };
    const entries = Object.entries(changes);
    if (!entries.length) return sendJson(res, 400, { ok: false, error: 'لا توجد تغييرات صالحة.' });
    const values = [id];
    const setters = entries.map(([key, value]) => {
      values.push(value);
      return `${allowedColumns[key]} = $${values.length}`;
    });
    const result = await pool.query(
      `UPDATE products SET ${setters.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING id, slug, category, name, description, price_dzd, currency, emoji, badge, badge_type, featured, active`,
      values
    );
    if (!result.rows.length) return sendJson(res, 404, { ok: false, error: 'المنتج غير موجود.' });
    await recordAdminAudit(auth.username, 'product.update', 'product', id, changes);
    return sendJson(res, 200, { ok: true, product: normalizeProduct(result.rows[0]) });
  }

  return sendJson(res, 404, { ok: false, error: 'المسار الإداري غير موجود.' });
}

function adminUnavailablePage(res, status, message) {
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إعداد لوحة BlueDrop</title><body style="margin:0;background:#071326;color:#eff7ff;font:16px Tahoma,Arial,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:560px;margin:20px;padding:28px;background:#0d2039;border:1px solid #2a4c70;border-radius:20px"><p style="color:#77bfff;font-size:12px">BLUEDROP ADMIN</p><h1 style="font-size:25px">لوحة الإدارة غير متاحة</h1><p style="color:#a7bbd5;line-height:2">${escapeHtml(message)}</p><a style="color:#83caff" href="/">العودة إلى المتجر</a></main></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store' });
  res.end(html);
}

function makeAdminPage(req, res) {
  const auth = adminCredentials(req);
  if (!auth.configured) return adminUnavailablePage(res, 503, 'اضبط متغيرَي ADMIN_USERNAME وADMIN_PASSWORD (بكلمة مرور لا تقل عن 16 حرفًا) قبل فتح لوحة الإدارة.');
  if (!auth.valid) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="BlueDrop Admin", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Authentication required');
  }
  if (NODE_ENV === 'production' && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() !== 'https') {
    return adminUnavailablePage(res, 403, 'لوحة الإدارة متاحة عبر HTTPS فقط في بيئة الإنتاج.');
  }
  fs.readFile(path.join(ROOT, 'admin', 'index.html'), (error, content) => {
    if (error) return adminUnavailablePage(res, 503, 'ملفات لوحة الإدارة غير متوفرة.');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': content.length, 'Cache-Control': 'no-store' });
    res.end(content);
  });
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: https://*.googleusercontent.com",
    "connect-src 'self' https://accounts.google.com",
    "frame-src https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  if (NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function serveStatic(req, res, pathname, method) {
  let mappedPath = pathname;
  const redirects = new Map([
    ['/shop', '/#shop'], ['/faq', '/#faq'], ['/contact', '/#contact'],
    ['/terms', '/#terms'], ['/privacy', '/#privacy'], ['/refunds', '/#refunds']
  ]);
  if (redirects.has(pathname)) {
    res.writeHead(302, { Location: redirects.get(pathname), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (pathname === '/') mappedPath = '/index.html';
  const filePath = STATIC_FILES.get(mappedPath);
  if (!filePath) return sendText(res, 404, 'Not Found');

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendText(res, 404, 'Not Found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Vary': 'Accept-Encoding'
    });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendText(res, 400, 'Bad Request');
    }

    if (url.pathname.startsWith('/api/admin/')) {
      try { return await adminApi(req, res, url); }
      catch (error) {
        if (!res.headersSent) return sendJson(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'حدث خطأ داخلي.' });
        return res.end();
      }
    }

    if (url.pathname === '/api/auth/google') return handleGoogleAuth(req, res);

    if (url.pathname === '/api/health' && req.method === 'GET') {
      let database = 'not-configured';
      if (pool) {
        try { await pool.query('SELECT 1'); database = 'connected'; }
        catch { database = 'unavailable'; }
      }
      return sendJson(res, pool && database === 'unavailable' ? 503 : 200, {
        ok: !pool || database === 'connected',
        mode: pool ? 'postgres-demo' : 'memory-demo',
        database,
        paymentsEnabled: false,
        fulfillmentEnabled: false,
        persistentOrders: Boolean(pool)
      });
    }

    if (url.pathname === '/api/products' && req.method === 'GET') {
      try { return sendJson(res, 200, { ok: true, currency: 'DZD', products: await listProducts() }); }
      catch { return sendJson(res, 503, { ok: false, error: 'كتالوج المنتجات غير متاح حاليًا.' }); }
    }

    if (url.pathname === '/api/orders' && req.method === 'POST') return createDemoOrder(req, res);

    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Allow', 'GET, POST, PATCH');
      return sendJson(res, 404, { ok: false, error: 'المسار غير موجود.' });
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendText(res, 405, 'Method Not Allowed');
      }
      return makeAdminPage(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method Not Allowed');
    }
    return serveStatic(req, res, url.pathname, req.method);
  });
}

async function initializeDatabase() {
  if (!pool) return;
  await pool.query('SELECT 1');
  const tables = await pool.query("SELECT to_regclass('public.products') AS products, to_regclass('public.demo_orders') AS orders");
  if (!tables.rows[0].products || !tables.rows[0].orders) {
    throw new Error('Database schema is missing. Run `npm run db:migrate` first.');
  }
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (result.rows[0].count === 0) {
    for (const product of catalogSeed) {
      await pool.query(
        `INSERT INTO products (id, slug, category, name, description, price_dzd, currency, emoji, badge, badge_type, featured, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (slug) DO NOTHING`,
        [product.id, product.slug, product.category, product.name, product.description, product.price, product.currency, product.emoji, product.badge, product.badgeType, product.featured, product.active]
      );
    }
    await pool.query("SELECT setval(pg_get_serial_sequence('products','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM products),1), true)");
  }
}

async function start() {
  await initializeDatabase();
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => console.log(`BlueDrop running on http://localhost:${PORT} (${pool ? 'PostgreSQL demo mode' : 'memory demo mode'})`));
  const shutdown = signal => {
    console.log(`Received ${signal}; shutting down gracefully.`);
    server.close(async () => {
      if (pool) await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  start().catch(error => {
    console.error('BlueDrop startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  validateOrderItems,
  validateProductInput,
  buildDemoProducts
};
