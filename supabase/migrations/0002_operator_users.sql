-- ============================================================================
-- 0002_operator_users.sql
-- Users belonging to an operator. user_id maps to auth.users.id (Supabase Auth).
-- A user may belong to multiple operators (uncommon in v1, supported anyway).
--
-- Correction applied vs. spec section 3.1:
--   user_id is NULLABLE and ON DELETE SET NULL, so demo/seed rows without a
--   real auth.users row can exist and be linked later.
-- ============================================================================

CREATE TABLE operator_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'agent')),
  invited_email TEXT,                     -- email used for invitation; null for the founding owner
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, user_id)
);
CREATE INDEX ON operator_users (user_id);
CREATE INDEX ON operator_users (operator_id);
