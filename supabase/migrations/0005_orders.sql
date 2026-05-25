-- ============================================================================
-- 0005_orders.sql
-- Orders import batches, individual orders, and per-row import errors.
-- ============================================================================

CREATE TABLE order_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES operator_users(id) ON DELETE CASCADE,
  row_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON order_imports (event_id);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_import_id UUID REFERENCES order_imports(id) ON DELETE SET NULL,
  order_id TEXT NOT NULL,                 -- External order ID from ticketing platform
  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  preferred_language TEXT DEFAULT 'en',
  ticket_type TEXT,
  quantity INT NOT NULL DEFAULT 1,
  amount_paid NUMERIC(12, 2),
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  purchase_date DATE,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'payment_failed', 'payment_pending', 'refunded')),
  vip_flag BOOLEAN NOT NULL DEFAULT false,
  transfer_eligible BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  raw_row JSONB,                          -- Original CSV row for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, order_id)             -- Re-import overwrites by (event_id, order_id)
);
CREATE INDEX ON orders (event_id);
CREATE INDEX ON orders (event_id, customer_phone_e164);
CREATE INDEX ON orders (event_id, vip_flag) WHERE vip_flag = true;

CREATE TABLE order_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_import_id UUID NOT NULL REFERENCES order_imports(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  error_message TEXT NOT NULL,
  raw_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON order_import_errors (order_import_id);
