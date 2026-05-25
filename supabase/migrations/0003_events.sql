-- ============================================================================
-- 0003_events.sql
-- Events under an operator + per-event user scoping.
-- ============================================================================

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,                     -- URL-safe identifier, unique per operator
  event_type TEXT NOT NULL CHECK (event_type IN ('festival', 'club', 'concert', 'conference', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  venue_name TEXT NOT NULL,
  venue_city TEXT NOT NULL,
  capacity INT,
  age_minimum INT NOT NULL CHECK (age_minimum >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed', 'archived')),
  -- The full EventConfig blob. Matches the TypeScript type in refund_deflection.ts.
  -- Stored as JSONB so the agent runtime can read without joins.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, slug)
);
CREATE INDEX ON events (operator_id) WHERE deleted_at IS NULL;
CREATE INDEX ON events (start_date) WHERE deleted_at IS NULL;
CREATE INDEX ON events USING GIN (config);

-- Per-event user scoping. Optional in v1: if no rows for an event, all operator
-- users with role >= 'agent' have access. If rows exist, only listed users access.
CREATE TABLE event_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, operator_user_id)
);
