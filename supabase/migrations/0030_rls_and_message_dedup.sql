-- ============================================================================
-- 0030_rls_and_message_dedup.sql
--
-- Bundles the schema changes for the 2026-07 audit fix session.
--
-- Both tables below are accessed ONLY via createAdminClient() (service-role),
-- which bypasses RLS entirely. They therefore have RLS ENABLED with NO
-- POLICIES. The effect:
--   • service-role access (the app's only access path) is unaffected;
--   • the public anon key (PostgREST) can no longer read or write these rows.
-- A table with RLS DISABLED is exposed to anyone holding the anon key, so
-- "no RLS because we only use the admin client" is a data-leak, not a
-- simplification.
-- ============================================================================

-- ── 1. whatsapp_session_state: enable RLS, no policies (audit 1.1 / P0) ──────
-- Holds customer phone numbers and their raw inbound messages
-- (original_message). Created in 0025 with RLS disabled, which left it
-- readable/writable via the public anon key. Enabling RLS with no policies
-- locks it to the service-role client only.
ALTER TABLE whatsapp_session_state ENABLE ROW LEVEL SECURITY;

-- ── 2. whatsapp_processed_messages: inbound webhook idempotency (audit 5.2) ──
-- One row per inbound wamid we have accepted. The inbound handler does an
-- insert-first against the PRIMARY KEY: a unique violation (23505) means Meta
-- redelivered a message we already processed, so the handler drops it. This is
-- race-safe under Meta's at-least-once redelivery — concurrent redeliveries
-- race on the DB constraint, not on a check-then-insert window in app code.
--
-- Rows are ephemeral (only needed for the redelivery window) and are purged by
-- the existing /api/cron/expire-pending cron once expires_at has passed —
-- no new cron route is added.
CREATE TABLE whatsapp_processed_messages (
  wamid        TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '3 days')
);

-- Plain index on expires_at for the cron purge (`WHERE expires_at < now()`).
-- A partial-index predicate using now() is not allowed (now() is STABLE, not
-- IMMUTABLE) — mirrors the note in 0025_whatsapp_session_state.sql.
CREATE INDEX ON whatsapp_processed_messages (expires_at);

-- Accessed only via createAdminClient(); enable RLS with no policies so the
-- anon key cannot enumerate or forge processed message IDs.
ALTER TABLE whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;
