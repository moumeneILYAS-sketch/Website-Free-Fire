# BlueDrop — Free Fire Storefront Demo

BlueDrop is an Arabic-first, right-to-left gaming storefront prototype. The source is deliberately kept small and dependency-light on the client, with a Node.js HTTP API and an optional PostgreSQL-backed demo data layer.

> **Important:** this repository is still a demo. It does not sell real products, accept payments, redeem codes, or deliver Free Fire items. Product names and prices are illustrative. Real commerce must remain disabled until an authorized product supplier and payment provider are selected and verified.

## Current features

- Premium dark-blue visual system with an animated CSS gem, layered lighting, orbital details, card hover states, scroll reveals, dialog/drawer motion, and motion-reduction support.
- Arabic RTL storefront, category navigation, filtering, search, sorting, product detail dialog, persistent local cart, quantity changes, and demo checkout.
- One shared demo catalog (`catalog.js`) used by the browser and server.
- Node.js API endpoints for the catalog, health, and explicitly demo-only orders.
- Server-side pricing and request validation; per-IP rate limit; same-origin checks; idempotency keys; security response headers; and static-file allowlisting.
- The demo order endpoint deliberately does not persist or echo the player ID. Never provide passwords, one-time codes, or payment credentials to this prototype.
- Optional PostgreSQL schema and persistent demo-order records; a protected, HTTP Basic-authenticated admin page for PostgreSQL product management and demo-order review.
- Built-in Node test suite and GitHub Actions checks.

## Requirements

- Node.js 22 or newer.
- PostgreSQL only if you want persistent demo orders and durable product administration.

## Run locally (no database needed)

```bash
npm run check
npm test
npm start
```

Open <http://localhost:3000>. The default mode uses an in-memory demo order store. It is intentionally not suitable for production orders.

## API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Reports demo mode and database configuration; never indicates payments or fulfillment are enabled. |
| `/api/products` | GET | Returns active demo products. |
| `/api/orders` | POST | Creates an idempotent, non-commercial demo receipt. No payment or fulfillment occurs. |
| `/api/admin/overview` | GET | Protected administrative health summary. |
| `/api/admin/products` | GET / POST | Protected catalog view and product creation (writes require PostgreSQL). |
| `/api/admin/products/:id` | PATCH | Protected product update/deactivation (writes require PostgreSQL). |
| `/api/admin/orders` | GET | Protected view of demo-only order summaries. |
| `/admin` | GET | Protected administrative page; disabled until credentials are configured. |

The static server intentionally serves only approved public assets, not source files, environment files, the database schema, or repository metadata.

## PostgreSQL setup

1. Create a PostgreSQL database using your hosting provider.
2. Copy `.env.example` to `.env` in your local environment and set `DATABASE_URL`. Do not commit `.env` or actual credentials.
3. Install dependencies and apply the schema:

   ```bash
   npm install
   npm run db:migrate
   npm start
   ```

4. On startup, the app seeds the database from `catalog.js` only if the `products` table is empty. After that, the database catalog is authoritative.

Set `DATABASE_SSL=true` only when the database provider supports TLS with a verifiable certificate chain. If the provider gives a CA certificate, configure it with your deployment rather than disabling certificate verification.

## Admin setup

Set `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 16 characters before starting the server. Visit `/admin`; the browser will request HTTP Basic authentication. Admin static JavaScript/CSS contains no secrets, while the HTML route and all admin APIs are protected by server-side authorization.

For a public deployment, use HTTPS at the reverse proxy and ensure it supplies `X-Forwarded-Proto: https`. Do not put admin credentials in source control, query strings, frontend code, logs, or screenshots. Basic authentication is a minimal operational gate, not a substitute for a managed identity provider, MFA, or a production security review.

## Production-readiness gates

Before real sales are enabled, the project still requires an authorized product/fulfillment integration, a locally available payment provider that supports the merchant account, verified payment notifications, refunds and support operations, stronger staff identity management, persistent customer/order handling appropriate to the actual service, monitoring, backups, and a deployment review. The current endpoints intentionally do not pretend to perform payment or game-item delivery.

## Security notes

- Prices are taken from server-side catalog data; client-supplied prices are ignored.
- User-provided cart contents are validated, quantities are bounded, and duplicate items are combined.
- Orders use an idempotency key and return a conflict if that key is reused for a different cart.
- No player password, authentication code, or payment data is requested or stored.
- SQL queries use parameters for values. Administrative update columns are allowlisted.
- Run `npm run check` and `npm test` before publishing changes.
