'use strict';

const crypto = require('node:crypto');
const catalogSeed = require('../catalog.js');

let pool;
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
    });
    pool.on('error', error => console.error('BlueDrop database pool error:', error.message));
  }
  return pool;
}

function addSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function sendJson(res, status, data, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  return res.end(JSON.stringify(data));
}

function methodNotAllowed(res, allow) {
  return sendJson(res, 405, { ok: false, error: 'طريقة الطلب غير مدعومة.' }, { Allow: allow });
}

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim().toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function withinRateLimit(req) {
  const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '');
  const key = forwarded.split(',')[0].trim() ||
    String(req.socket && req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  let item = rateBuckets.get(key);
  if (!item || now - item.start >= RATE_WINDOW_MS) {
    item = { start: now, count: 0 };
    rateBuckets.set(key, item);
  }
  item.count += 1;
  if (rateBuckets.size > 1000) {
    for (const [candidate, value] of rateBuckets) {
      if (now - value.start >= RATE_WINDOW_MS) rateBuckets.delete(candidate);
      if (rateBuckets.size <= 800) break;
    }
  }
  return item.count > RATE_LIMIT;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw Object.assign(new Error('بيانات الطلب غير صالحة.'), { statusCode: 400 });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('صيغة بيانات الطلب غير صحيحة.'), { statusCode: 400 });
  }
}

function normalizeProduct(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    category: row.category,
    name: row.name,
    description: row.description || '',
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
  const db = getPool();
  if (!db) return catalogSeed.filter(product => product.active !== false);
  const result = await db.query(
    `SELECT id, slug, category, name, description, price_dzd, currency,
            emoji, badge, badge_type, featured, active
       FROM products
      WHERE active = TRUE
      ORDER BY featured ASC, id ASC`
  );
  return result.rows.map(normalizeProduct);
}

function validateItems(input, products) {
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
    if (!product) throw Object.assign(new Error('أحد المنتجات غير متاح.'), { statusCode: 400 });
    const combined = (merged.get(productId) || 0) + quantity;
    if (combined > 20) throw Object.assign(new Error('الحد الأقصى التجريبي هو 20 من كل عنصر.'), { statusCode: 400 });
    merged.set(productId, combined);
  }
  const items = [...merged.entries()].map(([productId, quantity]) => {
    const product = products.find(item => Number(item.id) === productId);
    const unitPrice = Number(product.price);
    return { productId, name: product.name, unitPrice, quantity, lineTotal: unitPrice * quantity };
  });
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(count)) {
    throw Object.assign(new Error('تعذر حساب المجموع التجريبي.'), { statusCode: 400 });
  }
  return { items, total, count };
}

function getIdempotencyKey(req) {
  const key = String((req.headers && req.headers['idempotency-key']) || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
    throw Object.assign(new Error('انتهت صلاحية مفتاح الطلب. أغلق النافذة وحاول مرة أخرى.'), { statusCode: 400 });
  }
  return key;
}

function publicOrder(row) {
  return {
    reference: row.reference,
    status: row.status,
    currency: row.currency || 'DZD',
    total: Number(row.total_dzd ?? row.total),
    itemCount: Number(row.item_count ?? row.itemCount),
    items: typeof row.items_json === 'string' ? JSON.parse(row.items_json) : (row.items_json || row.items),
    createdAt: new Date(row.created_at || row.createdAt).toISOString()
  };
}

async function handleProducts(req, res) {
  addSecurityHeaders(res);
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  try {
    return sendJson(res, 200, { ok: true, currency: 'DZD', products: await listProducts() });
  } catch {
    return sendJson(res, 503, { ok: false, error: 'كتالوج المنتجات غير متاح حاليًا.' });
  }
}

async function handleHealth(req, res) {
  addSecurityHeaders(res);
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  const db = getPool();
  if (!db) {
    return sendJson(res, 200, {
      ok: true, mode: 'static-demo', database: 'not-configured',
      paymentsEnabled: false, fulfillmentEnabled: false, demoOrdersEnabled: false
    });
  }
  try {
    await db.query('SELECT 1');
    return sendJson(res, 200, {
      ok: true, mode: 'postgres-demo', database: 'connected',
      paymentsEnabled: false, fulfillmentEnabled: false, demoOrdersEnabled: true
    });
  } catch {
    return sendJson(res, 503, {
      ok: false, mode: 'postgres-demo', database: 'unavailable',
      paymentsEnabled: false, fulfillmentEnabled: false, demoOrdersEnabled: false
    });
  }
}

async function handleOrder(req, res) {
  addSecurityHeaders(res);
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'تم رفض مصدر الطلب.' });
  if (withinRateLimit(req)) return sendJson(res, 429, { ok: false, error: 'طلبات كثيرة خلال وقت قصير. حاول بعد قليل.' });
  if (!String((req.headers && req.headers['content-type']) || '').toLowerCase().includes('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'يجب إرسال الطلب بصيغة JSON.' });
  }
  const db = getPool();
  if (!db) {
    return sendJson(res, 503, {
      ok: false,
      error: 'معاينة الطلبات غير مفعّلة في النشر حتى يتم إعداد قاعدة بيانات PostgreSQL دائمة.'
    });
  }
  try {
    const payload = parseBody(req);
    if (payload.playerId !== undefined && payload.playerId !== '' &&
        (typeof payload.playerId !== 'string' || !/^[0-9]{6,16}$/.test(payload.playerId.trim()))) {
      return sendJson(res, 400, { ok: false, error: 'معرّف اللاعب يجب أن يكون من 6 إلى 16 رقمًا أو يُترك فارغًا.' });
    }
    // Never persist or return playerId. This endpoint creates a demo receipt only.
    const key = getIdempotencyKey(req);
    const normalized = validateItems(payload.items, await listProducts());
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(normalized.items)).digest('hex');
    const inserted = await db.query(
      `INSERT INTO demo_orders
         (reference, idempotency_key, request_hash, status, currency, total_dzd, item_count, items_json)
       VALUES ($1,$2,$3,'DEMO_ONLY_NOT_FULFILLED','DZD',$4,$5,$6::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING reference, status, currency, total_dzd, item_count, items_json, created_at`,
      [crypto.randomBytes(5).toString('hex').toUpperCase(), key, requestHash,
        normalized.total, normalized.count, JSON.stringify(normalized.items)]
    );
    let row = inserted.rows[0];
    if (!row) {
      const prior = await db.query(
        `SELECT reference, request_hash, status, currency, total_dzd, item_count, items_json, created_at
           FROM demo_orders WHERE idempotency_key = $1`,
        [key]
      );
      row = prior.rows[0];
      if (!row || row.request_hash !== requestHash) {
        return sendJson(res, 409, { ok: false, error: 'مفتاح الطلب مستخدم لطلب مختلف. ابدأ معاينة جديدة.' });
      }
    }
    return sendJson(res, 201, {
      ok: true, order: publicOrder(row), note: 'طلب تجريبي فقط: لا دفع ولا شحن.'
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 503, {
      ok: false, error: error.statusCode ? error.message : 'تعذر إنشاء الطلب التجريبي.'
    });
  }
}

module.exports = { handleProducts, handleHealth, handleOrder, validateItems };
