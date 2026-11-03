'use strict';

const shop2topup = require('./shop2topup.js');

// Adapters are registered here only. Storefront code never imports provider SDKs.
const adapters = new Map([
  ['shop2topup', {
    id: 'shop2topup',
    name: 'SHOP2TOPUP',
    games: ['free-fire'],
    getStatus: () => shop2topup.getStatus(),
    getCatalog: async ({ game, region }) => {
      if (game !== 'free-fire') return [];
      const result = await shop2topup.getFreeFireCatalog();
      const groups = Array.isArray(result.categories) ? result.categories : [];
      return groups.flatMap(group => (group.products || []).map(product => ({
        providerId: 'shop2topup',
        providerProductId: String(product.itemId ?? ''),
        game: 'free-fire',
        regionCode: String(group.category && group.category.regionCode || '').toUpperCase(),
        name: String(product.name || ''),
        description: String(product.description || ''),
        providerPrice: product.supplierPrice,
        providerCurrency: product.supplierCurrency || 'USD',
        availability: 'unverified',
        metadata: { productType: product.productType || 'unknown' }
      }))).filter(product => !region || product.regionCode === region);
    }
  }]
]);

function enabledIds() {
  const configured = String(process.env.SUPPLIERS_ENABLED || 'shop2topup')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return new Set(configured);
}

function getAdapter(id) {
  const adapter = adapters.get(String(id || '').toLowerCase());
  if (!adapter || !enabledIds().has(adapter.id)) return null;
  return adapter;
}

async function getStatus(id) {
  const adapter = getAdapter(id);
  if (!adapter) return { enabled: false, connected: false, reason: 'disabled-or-unknown' };
  try {
    const status = await adapter.getStatus();
    return { enabled: true, connected: Boolean(status.connected), paymentsEnabled: false, fulfillmentEnabled: false };
  } catch {
    return { enabled: true, connected: false, paymentsEnabled: false, fulfillmentEnabled: false };
  }
}

async function getStatuses() {
  return Promise.all([...adapters.values()].map(async adapter => ({
    id: adapter.id,
    name: adapter.name,
    ...(await getStatus(adapter.id))
  })));
}

async function getCatalog({ game = 'free-fire', region = '', providerId = '' } = {}) {
  const candidates = providerId ? [getAdapter(providerId)].filter(Boolean) :
    [...adapters.values()].filter(adapter => getAdapter(adapter.id));
  const offers = [];
  for (const adapter of candidates) {
    if (!adapter.games.includes(game) || typeof adapter.getCatalog !== 'function') continue;
    const status = await getStatus(adapter.id);
    if (!status.connected) continue;
    const products = await adapter.getCatalog({ game, region });
    offers.push(...products);
  }
  if (!offers.length) throw Object.assign(new Error('NO_PROVIDER'), { code: 'NO_PROVIDER' });
  return { game, region: region || null, products: offers, readOnly: true };
}

module.exports = { getStatus, getStatuses, getCatalog };
