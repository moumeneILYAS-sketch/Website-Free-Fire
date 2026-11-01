'use strict';
const BASE = 'https://shop2topup.com/api/endpoints/v1';
const TIMEOUT_MS = 8000;
function credentials() {
  const keyId = String(process.env.S2T_KEY_ID || '').trim();
  const secret = String(process.env.S2T_SECRET || '').trim();
  return keyId && secret ? { keyId, secret } : null;
}
async function request(path) {
  const pair = credentials();
  if (!pair) throw Object.assign(new Error('SUPPLIER_NOT_CONFIGURED'), { code: 'SUPPLIER_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(BASE + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + pair.keyId + '.' + pair.secret, Accept: 'application/json' },
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.success !== true) {
      const code = body && body.error && body.error.code ? String(body.error.code) : 'SUPPLIER_REQUEST_FAILED';
      throw Object.assign(new Error(code), { code, status: response.status });
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('SUPPLIER_TIMEOUT'), { code: 'SUPPLIER_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timer); }
}
async function getStatus() {
  await request('/account');
  return { connected: true, credentialValid: true, paymentsEnabled: false, fulfillmentEnabled: false };
}
async function getFreeFireCatalog() {
  const result = await request('/catalog/categories?bigCategoryId=1');
  const categories = Array.isArray(result.categories) ? result.categories : [];
  const matches = categories.filter(item => String(item.name || '').toLowerCase().includes('free fire'));
  const groups = await Promise.all(matches.map(async category => {
    const response = await request('/catalog/subcategories?categoryId=' + encodeURIComponent(category.id));
    const items = Array.isArray(response.subcategories) ? response.subcategories : [];
    return {
      category: { id: category.id, name: String(category.name || 'Free Fire') },
      products: items.map(item => ({
        itemId: item.item_id ?? item.id,
        name: String(item.name || ''),
        description: String(item.description || ''),
        supplierPrice: typeof item.price === 'string' ? item.price : null,
        supplierCurrency: 'USD',
        productType: String(item.product_type || 'unknown')
      }))
    };
  }));
  return { categories: groups, source: 'SHOP2TOPUP', liveCatalog: true };
}
module.exports = { getStatus, getFreeFireCatalog };
