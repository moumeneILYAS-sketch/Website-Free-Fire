# BlueDrop — Free Fire Storefront Demo

BlueDrop is an Arabic-first, right-to-left gaming storefront prototype. This repository includes a premium blue storefront, accessible animations, a Node.js API for self-hosting, and Vercel-compatible static output and serverless API functions.

> **Demo only:** this repository does not sell real products, accept payments, redeem codes, or deliver Free Fire items. Prices are illustrative. Real commerce must remain disabled until authorized product supply and payment services are verified.

## Features

- Premium navy, electric-blue and cyan visual system, animated crystal hero, product reveal motion and reduced-motion support.
- Arabic RTL storefront, search, category filters, sorting, product details, persistent cart and demo checkout.
- Optional Google Identity Services sign-in with server-side ID-token verification and encrypted HTTP-only sessions.
- Demo-only payment-method selector for CIB, EDAHABIA, Visa, Mastercard, PayPal and manual BaridiMob review; no payment credentials or transfers are collected.
- Shared catalog for the browser and local Node.js server.
- Vercel API endpoints: `/api/health`, `/api/products` and `/api/orders`.
- Server-side price calculation, strict request validation, idempotency keys, same-origin checking, best-effort rate limiting and security headers.
- Optional PostgreSQL persistence for demonstration orders and product management.
- A protected admin interface for the self-hosted Node.js setup.
- Automated unit/API tests and GitHub Actions checks.

## Local requirements

- Node.js 22 or newer.
- PostgreSQL only for persistent demonstration orders and database-backed product administration.

## Run locally

```bash
npm install
npm run check
npm test
npm start
```

Open <http://localhost:3000>. Without `DATABASE_URL`, the local Node server uses the demo catalog and deliberately does not persist demo orders. The public Vercel API has the same catalog fallback, but order creation requires a configured persistent database.

## Deploy on Vercel

The `public/` folder is the Vercel output directory. Vercel's default for an "Other" project can select `public/` when that folder exists; the homepage source lives at the repository root. The `vercel.json` configuration explicitly selects the public output, and `npm run vercel-build` copies the approved storefront assets into it. This avoids a deployment output that contains only the favicon and therefore returns a 404 for the homepage.

1. In Vercel, make sure the project is connected to this repository and the production branch is `main`.
2. Use the repository root as the Root Directory.
3. The committed `vercel.json` sets Build Command to `npm run vercel-build` and Output Directory to `public`. Do not override those values with a different output directory.
4. Pushes to `main` should trigger a new Vercel deployment if the Git connection is enabled. Check the latest deployment's build logs and confirm its deployment output contains `index.html`, `styles.css`, `app.js`, `catalog.js` and `favicon.svg`.
5. The Vercel project auto-detects the `api/` serverless functions. After deployment, test `/api/health` and `/api/products`.

The `/admin` page and the full administrative API are currently for the self-hosted Node.js server. They are not included in the public Vercel output. Do not copy admin assets into `public/` or expose them without a separate protected serverless implementation.

### Optional PostgreSQL for demo orders

To enable persistent **demo-only** order receipts on Vercel:

1. Create a PostgreSQL database and apply `database/schema.sql` once using your database provider's SQL console or a trusted migration environment.
2. Add `DATABASE_URL` to the Vercel project's Production environment variables.
3. Set `DATABASE_SSL=true` only if your provider uses TLS with a verifiable certificate chain.
4. Redeploy, then check `/api/health`.

Without a configured database, `/api/orders` returns `503` instead of pretending to create a persistent order. The endpoint is not a payment processor or game-item fulfillment service.

## Google sign-in setup (optional)

Google sign-in is disabled by default. To enable it for a site you control:

1. In Google Cloud Console, create an OAuth client of type **Web application** and configure the authorized JavaScript origins for your production domain (for example, `https://freefireshop.vercel.app`) and any local development origin you use (for example, `http://localhost:3000`). No Google client secret is used by this Identity Services flow.
2. Set `GOOGLE_CLIENT_ID` to the Web application client ID in the Vercel project environment variables.
3. Generate a random `AUTH_SESSION_SECRET` with at least 32 characters and store it only in Vercel environment variables. Do not commit it or paste it into source files.
4. Redeploy. The header will render Google's official sign-in control only when both settings are present.

The backend verifies the Google ID-token signature against Google's published keys and checks its issuer, audience, expiry, verified-email claim, nonce and same-origin CSRF token. A successful sign-in creates an encrypted, HTTP-only, secure-in-production session cookie. The demo does not save a Google profile to PostgreSQL or link it to game credentials. A signed-in account is not proof of a paid order.

For local development, configure the same variables in an untracked local `.env` file. The committed `.env.example` contains placeholders only.

## Demo payment methods

The checkout lists EDAHABIA, CIB, Visa, Mastercard, PayPal and BaridiMob so the checkout flow can be reviewed. **Every option remains a demonstration choice only.** The API records the selected method name with the demo order; it never collects card numbers, CVVs, PayPal credentials, BaridiMob credentials, transfer slips or one-time codes.

Chargily's current developer information advertises EDAHABIA and CIB support; its business page lists Visa and Mastercard as coming soon. This repository does not integrate Chargily or any other payment processor yet. PayPal merchant eligibility and settlement must be confirmed with PayPal for the actual business account. BaridiMob is shown as a future manual-review option only: this demo does not display a payment number, request a transfer, accept a receipt or confirm a payment.

Before connecting any real payment provider, the adult business owner must verify merchant eligibility, legal authority to sell the goods, fees, settlement, refunds, privacy requirements and official provider documentation. Real payment collection and item fulfilment are intentionally disabled in this project.

## Local API endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Health and explicit demo-only status |
| `/api/products` | GET | Active catalog |
| `/api/auth/google` | GET / POST | Optional Google sign-in bootstrap, verified login and logout |
| `/api/orders` | POST | Idempotent demo receipt; no payment or fulfillment |
| `/api/admin/overview` | GET | Protected admin summary on the self-hosted server |
| `/api/admin/products` | GET / POST | Protected product administration on the self-hosted server |
| `/api/admin/products/:id` | PATCH | Protected product update/deactivation |
| `/api/admin/orders` | GET | Protected demo-order review |

## Security and production-readiness

- Never enter Free Fire passwords, one-time authentication codes or payment credentials.
- Prices are calculated from trusted server-side catalog data, never from client-supplied prices.
- Payment confirmation and fulfillment are not implemented; the API explicitly reports both disabled.
- Admin credentials must be configured outside source control for self-hosting.
- Before any real sales, verify authorized supply, local payment support, signed payment webhooks, refund policy, privacy obligations, durable order handling, monitoring and backups.

Run `npm run check`, `npm run vercel-build` and `npm test` before release. See `TEST_REPORT.md` for the automated coverage and remaining manual deployment checks.
