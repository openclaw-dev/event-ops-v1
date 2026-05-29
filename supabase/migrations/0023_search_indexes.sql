-- ============================================================================
-- 0023_search_indexes.sql
-- Indexes for hot search paths.
--
--   1. (event_id, customer_email)  — order_lookup email branch in agent runtime
--                                    + conversations search by order ID.
--   2. pg_trgm extension            — required for the trigram GIN indexes below.
--   3. customer_name trigram GIN    — speeds up ILIKE '%name%' in order_lookup
--                                    (currently a full table scan per turn).
--   4. messages.text trigram GIN    — speeds up the conversations-list FTS /
--                                    ILIKE fallback at large message volumes.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_event_email
  ON orders (event_id, customer_email);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm
  ON orders USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_messages_text_trgm
  ON messages USING gin (text gin_trgm_ops);
