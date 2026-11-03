# BlueDrop Multi-Supplier Architecture

## Goal
Keep the storefront independent from any top-up supplier. A supplier can be added, disabled, or replaced behind the server API without changing the storefront UI.

## Current baseline
- The storefront reads the local product catalog through `GET /api/products`.
- Supplier-specific logic currently lives in `lib/shop2topup.js`.
- `lib/vercel-api.js` imports SHOP2TOPUP directly for supplier status and catalog endpoints.
- Supplier credentials are server-side environment variables and must never be sent to the browser.

## Target architecture

```text
BlueDrop storefront
       |
       | GET /api/catalog?game=free-fire&region=...
       v
Normalized catalog API
       |
       v
Supplier manager / router
       |
       +--> Provider adapter: SHOP2TOPUP
       +--> Provider adapter: Supplier B
       +--> Provider adapter: Supplier C
       |
       v
Normalized product + region records
```

## Provider adapter contract (read-only phase)

Every provider adapter exports:
- `id`: stable internal provider key.
- `getStatus()`: returns connection state without exposing credentials.
- `getCatalog({ game, region })`: reads catalog data only.
- `normalizeProduct(rawProduct)`: maps provider-specific fields into BlueDrop's common shape.

Common product shape:
- `providerId`
- `providerProductId` (opaque string; never use as a storefront product ID)
- `game`
- `regionCode`
- `name`
- `description`
- `providerPrice`
- `providerCurrency`
- `availability`
- `metadata` (safe, non-secret provider details only)

## Routing policy
1. Match the requested game and account region.
2. Consider only enabled providers that explicitly support that region.
3. Ignore providers with failed health checks or stale catalog data.
4. Prefer an explicitly configured priority order; do not silently select a provider based only on the lowest price.
5. If multiple providers offer the same product, expose one canonical BlueDrop product and retain provider offers internally for comparison.
6. If no provider supports the region, return an unavailable state rather than substituting another region.

## Configuration
Provider settings are server-side only:
- `SUPPLIERS_ENABLED`: master read-only switch.
- `SUPPLIER_PRIORITY`: ordered provider IDs.
- Each provider has its own environment-variable namespace.
- Never commit API keys, secrets, account identifiers, or sample real credentials.
- The public API returns provider IDs and health states only, never configuration values.

## API plan
- `GET /api/suppliers/status`: safe status summary for configured adapters.
- `GET /api/catalog?game=free-fire&region=...`: normalized, read-only catalog.
- Existing `GET /api/products` remains the storefront's stable local/demo catalog until a verified mapping is approved.

## Region model
Use ISO 3166-1 alpha-2 country codes for customer country, plus a separate provider/game region code. These are not interchangeable. A country must not be assumed to equal a Free Fire account region. Provider coverage must be explicit and verified per product/region.

## Safety and rollout
- Phase 1: adapters, status, and catalog reads only.
- Phase 2: test fixtures and schema validation using mocked responses.
- Phase 3: admin review of provider coverage, currency, price freshness, and product mapping.
- Any order creation, wallet funding, payment collection, player validation, or fulfillment is out of scope and remains disabled.
- Keep the current demo order and payment behavior unchanged during the catalog migration.

## Acceptance criteria
- The storefront does not import or reference a supplier adapter.
- Adding a provider requires a new adapter and configuration, not storefront changes.
- Provider failure does not break the local/demo catalog.
- Region mismatch never falls back to another region.
- Secrets never appear in API responses, logs, client bundles, or this repository.
