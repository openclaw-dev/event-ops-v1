/**
 * track-usage.ts
 *
 * Fire-and-forget usage tracking for all Anthropic API calls.
 * Inserts a row into usage_events using the service-role client.
 *
 * NEVER throws — tracking failure must never break the main flow.
 *
 * Pricing as of May 2026 (per 1M tokens):
 *   claude-haiku-4-5 / claude-haiku-4-5-20251001
 *     input:      $0.80   output: $4.00   cache_read: $0.08
 *   claude-sonnet-4-6
 *     input:      $3.00   output: $15.00  cache_read: $0.30
 */

import { createAdminClient } from '@/lib/supabase/admin';

type EventType =
  | 'support_message'
  | 'change_extraction'
  | 'field_mapping'
  | 'kb_conversion'
  | 'report_generation';

interface UsageParams {
  operator_id: string;
  event_id?: string;
  event_type: EventType;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
}

// ─── Pricing table ────────────────────────────────────────────────────────────

interface ModelPricing {
  input_per_m: number;
  output_per_m: number;
  cache_read_per_m: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': {
    input_per_m: 0.80,
    output_per_m: 4.00,
    cache_read_per_m: 0.08,
  },
  'claude-haiku-4-5-20251001': {
    input_per_m: 0.80,
    output_per_m: 4.00,
    cache_read_per_m: 0.08,
  },
  'claude-sonnet-4-6': {
    input_per_m: 3.00,
    output_per_m: 15.00,
    cache_read_per_m: 0.30,
  },
};

const FALLBACK_PRICING: ModelPricing = {
  input_per_m: 3.00,
  output_per_m: 15.00,
  cache_read_per_m: 0.30,
};

function computeCost(
  model: string,
  input_tokens: number,
  output_tokens: number,
  cache_read_tokens: number,
): number {
  const p = PRICING[model] ?? FALLBACK_PRICING;
  return (
    (input_tokens / 1_000_000) * p.input_per_m +
    (output_tokens / 1_000_000) * p.output_per_m +
    (cache_read_tokens / 1_000_000) * p.cache_read_per_m
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record an Anthropic API usage event.
 *
 * Designed to be called as `void trackUsage(...)` — the returned Promise is
 * intentionally not awaited by callers. All errors are swallowed internally.
 */
export async function trackUsage(params: UsageParams): Promise<void> {
  try {
    const cacheRead = params.cache_read_tokens ?? 0;
    const cost = computeCost(
      params.model,
      params.input_tokens,
      params.output_tokens,
      cacheRead,
    );

    const admin = createAdminClient();
    await admin.from('usage_events').insert({
      operator_id: params.operator_id,
      event_id: params.event_id ?? null,
      event_type: params.event_type,
      model: params.model,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      cache_read_tokens: cacheRead,
      cost_usd: cost,
    });
  } catch {
    // Swallow all errors — usage tracking must never break the main flow.
  }
}
