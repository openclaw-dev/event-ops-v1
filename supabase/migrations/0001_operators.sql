-- ============================================================================
-- 0001_operators.sql
-- Tenant root. One row per operator (Coastline Events FZE, Nightline Hospitality FZE, etc.)
-- ============================================================================

CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_entity_name TEXT,
  country_code CHAR(2) NOT NULL,         -- ISO 3166-1 alpha-2, e.g. 'AE', 'SA'
  default_currency CHAR(3) NOT NULL DEFAULT 'AED',  -- ISO 4217
  default_locale TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
