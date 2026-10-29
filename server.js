'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 8 * 1024;
const products = [
  {id:1,category:"diamonds",name:"باقة 100 جوهرة",description:"باقة بداية بتصميم تجريبي أنيق.",price:250,emoji:"💎",badge:"الأكثر طلبًا",badgeType:"hot",featured:1},
  {id:2,category:"diamonds",name:"باقة 310 جواهر",description:"خيار متوسط لعشاق الجواهر.",price:650,emoji:"💠",badge:"قيمة مميزة",badgeType:"",featured:2},
  {id:3,category:"diamonds",name:"باقة 520 جوهرة",description:"باقة كبيرة ضمن نموذج المتجر.",price:990,emoji:"💎",badge:"باقة كبيرة",badgeType:"",featured:3},
  {id:4,category:"codes",name:"بطاقة كود مكافأة",description:"عنصر توضيحي لعرض الأكواد الرقمية.",price:180,emoji:"🎟️",badge:"تجريبي",badgeType:"",featured:4},
  {id:5,category:"codes",name:"صندوق المفاجآت",description:"بطاقة عرض تجريبية بتصميم مميز.",price:320,emoji:"🎁",badge:"مميز",badgeType:"hot",featured:5},
  {id:6,category:"skins",name:"سكن النيون الأزرق",description:"تصميم رمزي لفئة السكنات النادرة.",price:1200,emoji:"🧥",badge:"نادر",badgeType:"rare",featured:6},
  {id:7,category:"skins",name:"حزمة المحارب",description:"عرض بصري تجريبي لعشاق المظاهر.",price:850,emoji:"🛡️",badge:"مميز",badgeType:"",featured:7},
  {id:8,category:"emotes",name:"رقصة الاحتفال",description:"عنصر توضيحي لفئة الرقصات.",price:450,emoji:"🕺",badge:"جديد",badgeType:"",featured:8}
];
const mime = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.ico':'image/x-icon'
};
const rateCounts = new Map();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'Cache-Control':'no-store'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('حجم الطلب كبير جدًا.'), {statusCode:413}));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (_) { reject(Object.assign(new Error('صيغة بيانات الطلب غير صحيحة.'), {statusCode:400})); }
    });
    req.on('error', reject);
  });
}

function checkRateLimit(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const item = rateCounts.get(key);
  if (!item || now - item.start > 60000) {
    rateCounts.set(key, {start:now,count:1});
    return false;
  }
  item.count += 1;
  return item.count > 20;
}

function buildOrderItems(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) {
    throw Object.assign(new Error('اختر من عنصر واحد إلى 10 عناصر مختلفة.'), {statusCode:400});
  }
  const merged = new Map();
  for (const entry of input) {
    const id = Number(entry && entry.productId);
    const quantity = Number(entry && entry.quantity);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw Object.assign(new Error('بيانات المنتج أو الكمية غير صالحة.'), {statusCode:400});
    }
    if (!products.some(product => product.id === id)) {
      throw Object.assign(new Error('أحد المنتجات غير معروف.'), {statusCode:400});
    }
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  const items = Array.from(merged.entries()).map(([id, quantity]) => {
    const p = products.find(product => product.id === id);
    return {productId:id,name:p.name,unitPrice:p.price,quantity,lineTotal:p.price * quantity};
  });
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!Number.isSafeInteger(total) || total < 1) {
    throw Object.assign(new Error('تعذر حساب المجموع.'), {statusCode:400});
  }
  return {items,total,count};
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok:true, mode:'demo-only',
      paymentEnabled:false, fulfillmentEnabled:false
    });
  }
  if (pathname === '/api/products' && req.method === 'GET') {
    return sendJson(res, 200, {ok:true,currency:'DZD',products});
  }
  if (pathname === '/api/orders' && req.method === 'POST') {
    if (checkRateLimit(req)) {
      return sendJson(res, 429, {ok:false,error:'طلبات كثيرة خلال وقت قصير. حاول لاحقًا.'});
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      return sendJson(res, 415, {ok:false,error:'يجب إرسال الطلب بصيغة JSON.'});
    }
    try {
      const payload = await readJson(req);
      if (typeof payload.playerId !== 'string' || !/^[0-9]{6,16}$/.test(payload.playerId.trim())) {
        return sendJson(res, 400, {ok:false,error:'معرّف اللاعب يجب أن يتكون من 6 إلى 16 رقمًا.'});
      }
      const normalized = buildOrderItems(payload.items);
      const order = {
        reference:crypto.randomBytes(4).toString('hex').toUpperCase(),
        createdAt:new Date().toISOString(),
        status:'DEMO_ONLY_NOT_FULFILLED',
        items:normalized.items,
        total:normalized.total,
        itemCount:normalized.count
      };
      return sendJson(res, 201, {
        ok:true,order,
        note:'طلب تجريبي فقط: لا دفع ولا شحن.'
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, {ok:false,error:error.message || 'تعذر إنشاء الطلب التجريبي.'});
    }
  }
  return sendJson(res, 404, {ok:false,error:'المسار غير موجود.'});
}

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (_) { res.writeHead(400); return res.end('Bad Request'); }
  const target = path.resolve(ROOT, '.' + (decoded === '/' ? '/index.html' : decoded));
  const relative = path.relative(ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type':mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length':stat.size,
      'Cache-Control':path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (_) { res.writeHead(400); return res.end('Bad Request'); }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url.pathname).catch(() => {
      if (!res.headersSent) sendJson(res, 500, {ok:false,error:'حدث خطأ داخلي.'});
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow:'GET, HEAD'});
    return res.end('Method Not Allowed');
  }
  if (req.method === 'HEAD') {
    const target = path.resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    const relative = path.relative(ROOT, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); return res.end(); }
    return fs.stat(target, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type':mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length':stat.size
      });
      res.end();
    });
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('BlueDrop demo server running at http://localhost:' + PORT);
});
