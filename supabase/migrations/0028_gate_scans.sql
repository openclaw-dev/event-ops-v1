-- Gate scan records: one row per QR code scan attempt at the event gate.
CREATE TABLE gate_scans (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID        NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  event_id            UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scanned_code        TEXT        NOT NULL,
  scan_result         TEXT        NOT NULL
    CHECK (scan_result IN ('admitted', 'duplicate', 'not_found', 'invalid')),
  order_id            TEXT,
  customer_name       TEXT,
  customer_phone      TEXT,
  ticket_type         TEXT,
  quantity            INT,
  -- For duplicate scans: pointer back to the first admitted scan
  first_scan_id       UUID        REFERENCES gate_scans(id) ON DELETE SET NULL,
  first_scan_at       TIMESTAMPTZ,
  scanner_device      TEXT,
  gate_name           TEXT,
  scanned_by_user_id  UUID        REFERENCES operator_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON gate_scans (event_id, created_at DESC);
CREATE INDEX ON gate_scans (event_id, scanned_code);
CREATE INDEX ON gate_scans (event_id, scan_result);

-- Prevent double-admitting the same code at the same event.
CREATE UNIQUE INDEX gate_scans_admitted_unique
  ON gate_scans (event_id, scanned_code)
  WHERE scan_result = 'admitted';

ALTER TABLE gate_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY gate_scans_all ON gate_scans
  FOR ALL
  USING  (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));
