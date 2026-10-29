# BlueDrop verification report

This report records local checks for the source files in this repository. It is not a claim that live payments, real product fulfillment, or a production database have been tested.

## Automated checks

Run:

```bash
npm run check
npm test
```

The included tests cover:

- Catalog IDs, slugs, categories, and positive integer DZD pricing.
- Server-side total calculation and ignored client-supplied prices.
- Rejection of unknown products, invalid quantities, bad player IDs, missing idempotency keys, wrong content type, and foreign origins.
- Idempotent replay and conflicting reuse of a key.
- API health and product listing in local demo mode.
- Security headers and static-file allowlisting.
- Admin route behavior when credentials are not configured.

## Manual verification checklist

- [ ] Browse the page at desktop and mobile widths.
- [ ] Search products, switch category filters, and sort by price/name.
- [ ] Open and close product details and cart using mouse, keyboard, and Escape.
- [ ] Add/remove products, adjust quantities, and reload to confirm cart persistence.
- [ ] Submit an empty cart (must be blocked) and a demo order (must clearly state no payment or delivery occurred).
- [ ] Set up PostgreSQL, run the schema migration, and test the persistent mode in a dedicated test database.
- [ ] Configure admin credentials and verify authorized/unauthorized access over HTTPS in the deployment environment.
- [ ] Run external accessibility, performance, and security assessments before a public commercial launch.

## Current limitations

- Product images are original CSS/emoji-style placeholders, not official game artwork.
- There is no live payment provider, official top-up provider, code inventory, or fulfillment integration.
- In-memory orders disappear when the server restarts; durable demo summaries require PostgreSQL.
- The admin panel uses HTTP Basic authentication as a minimal gate and should be replaced or strengthened for a real production operation.
