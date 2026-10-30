# BlueDrop verification report

This report separates automated repository checks from deployment checks that require the user's Vercel project.

## Automated CI checks

The GitHub Actions workflow runs on Node.js 22 and 24:

```bash
npm run check
npm run vercel-build
npm test
```

Coverage includes catalog integrity and pricing, input validation, demo-order behavior, selected-method idempotency, source-of-truth server totals, response security headers, Vercel API handlers, Google sign-in disabled-mode behavior and encrypted-session integrity, and verifying that Vercel's static output contains `index.html`, `styles.css`, `app.js`, `catalog.js`, and `favicon.svg`.

## Vercel deployment configuration

- `vercel.json` explicitly selects `npm run vercel-build` and the `public` output directory.
- `scripts/prepare-vercel.js` copies only the approved storefront assets into `public`; server source, database schema, tests and environment files are not included in the static output.
- Serverless functions provide `/api/health`, `/api/products`, `/api/orders` and optional `/api/auth/google`.
- Google sign-in remains disabled until `GOOGLE_CLIENT_ID` and a 32+-character `AUTH_SESSION_SECRET` are configured.
- Checkout payment methods are demo selections only; no provider checkout, bank transfer or card entry is enabled.
- The product API serves the bundled demo catalog without a database. Order creation returns HTTP 503 unless a persistent PostgreSQL database is configured; payments and fulfillment always remain disabled.

## Manual checks still required

After Vercel creates a production deployment, confirm that its output contains `index.html` and the four local assets above. Then verify:

- `/` returns the storefront rather than a 404.
- `/api/health` returns JSON with payments and fulfillment disabled.
- `/api/products` returns the demo catalog.
- `/api/orders` returns a clear 503 while PostgreSQL is not configured.
- `/api/auth/google` reports `enabled: false` until both Google environment values are present; configure a real Google client before end-to-end sign-in tests.
- The Vercel deployment URL is assigned to `freefireshop.vercel.app` and marked Ready.

The live Vercel dashboard, deployment logs, DNS/domain assignment and production browser rendering cannot be proven by static repository tests alone. No live payments, real top-ups, redeemable codes or game-item delivery have been tested or enabled. Google sign-in has not been end-to-end tested without the site owner's OAuth client ID; the automated suite verifies the disabled-by-default behavior and session encryption only.
