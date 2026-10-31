/* BlueDrop global commission policy.
 * All countries and merchants inherit 10% unless an explicit override is configured.
 * Override precedence: merchant+country > merchant > country > global default.
 * Currency conversion and supplier wholesale costs are separate pricing inputs.
 */
(function exposeCommission(root) {
  'use strict';

  const RULES = Object.freeze({
    defaultPercent: 10,
    countryPercent: Object.freeze({}),
    merchantPercent: Object.freeze({}),
    merchantCountryPercent: Object.freeze({})
  });

  function normalizeCountryCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : 'DZ';
  }

  function validPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 50 ? number : null;
  }

  function resolvePercent(options = {}) {
    const rules = options.rules || RULES;
    const country = normalizeCountryCode(options.countryCode);
    const merchantId = String(options.merchantId || '').trim();
    const merchantCountryKey = merchantId ? merchantId + ':' + country : '';
    const merchantCountryRate = merchantCountryKey
      ? validPercent(rules.merchantCountryPercent && rules.merchantCountryPercent[merchantCountryKey])
      : null;
    if (merchantCountryRate !== null) return merchantCountryRate;

    const merchantRate = merchantId
      ? validPercent(rules.merchantPercent && rules.merchantPercent[merchantId])
      : null;
    if (merchantRate !== null) return merchantRate;

    const countryRate = validPercent(rules.countryPercent && rules.countryPercent[country]);
    if (countryRate !== null) return countryRate;

    return validPercent(rules.defaultPercent) ?? 10;
  }

  function calculate(basePrice, options = {}) {
    const base = Number(basePrice);
    if (!Number.isFinite(base) || base < 0) {
      throw new TypeError('Base price must be a non-negative number.');
    }
    const percent = resolvePercent(options);
    const decimals = Number.isInteger(options.decimals) ? Math.max(0, Math.min(4, options.decimals)) : 0;
    const factor = 10 ** decimals;
    const commission = Math.round((base * percent / 100) * factor) / factor;
    const finalPrice = Math.round((base + commission) * factor) / factor;
    return {
      basePrice: base,
      commissionPercent: percent,
      commissionAmount: commission,
      finalPrice
    };
  }

  const api = Object.freeze({
    rules: RULES,
    normalizeCountryCode,
    resolvePercent,
    calculate
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlueDropCommission = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
