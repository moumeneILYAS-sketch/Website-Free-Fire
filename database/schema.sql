-- BlueDrop PostgreSQL schema. All money values are integer DZD amounts.
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(90) NOT NULL UNIQUE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('diamonds','codes','skins','emotes')),
  name VARCHAR(90) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  price_dzd BIGINT NOT NULL CHECK (price_dzd > 0 AND price_dzd <= 100000000),
  currency CHAR(3) NOT NULL DEFAULT 'DZD' CHECK (currency = 'DZD'),
  emoji VARCHAR(12) NOT NULL DEFAULT '✦',
  badge VARCHAR(40) NOT NULL DEFAULT 'تجريبي',
  badge_type VARCHAR(12) NOT NULL DEFAULT '' CHECK (badge_type IN ('','hot','rare')),
  featured INTEGER NOT NULL DEFAULT 999,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_active_featured_idx ON products(active, featured, id);

-- Demonstration orders deliberately omit player IDs, passwords, card credentials, transfer credentials, and authentication codes.
-- This table is not a substitute for a real commerce/payment/fulfillment model.
CREATE TABLE IF NOT EXISTS demo_orders (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(20) NOT NULL UNIQUE,
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(40) NOT NULL CHECK (status = 'DEMO_ONLY_NOT_FULFILLED'),
  currency CHAR(3) NOT NULL DEFAULT 'DZD' CHECK (currency = 'DZD'),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'edahabia'
    CHECK (payment_method IN ('cib','edahabia','visa','mastercard','paypal','baridimob')),
  total_dzd BIGINT NOT NULL CHECK (total_dzd > 0),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  items_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Safe additive migration for databases created before payment-method previews were added.
ALTER TABLE demo_orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'edahabia';
DO $payment_method_migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'demo_orders_payment_method_check'
       AND conrelid = 'demo_orders'::regclass
  ) THEN
    ALTER TABLE demo_orders
      ADD CONSTRAINT demo_orders_payment_method_check
      CHECK (payment_method IN ('cib','edahabia','visa','mastercard','paypal','baridimob'));
  END IF;
END;
$payment_method_migration$;
CREATE INDEX IF NOT EXISTS demo_orders_created_at_idx ON demo_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(120) NOT NULL DEFAULT '',
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_events_created_at_idx ON admin_audit_events(created_at DESC);
