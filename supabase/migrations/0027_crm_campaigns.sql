-- ============================================================================
-- 0027_crm_campaigns.sql
-- CRM campaigns for no-show re-marketing and targeted WhatsApp outreach.
-- ============================================================================

CREATE TABLE crm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN (
    'no_show_remarket',
    'past_buyer_remarket',
    'abandoned_cart',
    'vip_upsell',
    'custom'
  )),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'paused', 'cancelled')),

  -- Message template
  message_template TEXT NOT NULL,
  target_event_id UUID REFERENCES events(id) ON DELETE SET NULL,

  -- Stats (denormalized for fast reads)
  total_recipients INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  converted_count INT NOT NULL DEFAULT 0,
  revenue_attributed_sar NUMERIC(10, 2) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crm_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,

  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,

  -- Source context
  source_order_id TEXT,
  source_event_name TEXT,
  segment TEXT,

  -- Delivery
  wamid TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'opted_out')),
  sent_at TIMESTAMPTZ,

  -- Conversion tracking
  converted BOOLEAN NOT NULL DEFAULT false,
  converted_at TIMESTAMPTZ,
  conversion_order_id TEXT,
  conversion_revenue_sar NUMERIC(10, 2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON crm_campaigns (operator_id, created_at DESC);
CREATE INDEX ON crm_campaign_recipients (campaign_id, status);
CREATE INDEX ON crm_campaign_recipients (customer_phone_e164);

ALTER TABLE crm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_campaigns_all ON crm_campaigns FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));

CREATE POLICY crm_campaign_recipients_all ON crm_campaign_recipients FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));
