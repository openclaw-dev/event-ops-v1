# Decisions

Append-only log of durable product/engineering decisions. Newest at the bottom.

---

- **2026-07-22 — Opt-out scope.** Opt-outs are per operator and apply to
  business-initiated sends only (payment recovery, CRM, and future campaigns).
  Replies inside a customer-initiated conversation (support-agent reply, inbound
  pre-router confirmations, human dashboard reply) are exempt. STOP is permanent
  until manual removal; there is no START re-subscribe flow yet.

- **2026-07-22 — Revenue attribution.** `payment_recovery_attempts.status =
  'completed'` is set only by the signed PSP webhook processor
  (`/api/webhooks/payments/[provider]`). Customer text claims ("paid" / "تم")
  are soft signals recorded in `heuristic_paid_signal_at` and never enter fee
  statistics. The billed fee is 22% of the gross webhook-confirmed captured
  amount (`confirmed_amount`); net-of-PSP-fees display is deferred.

- **2026-07-22 — Correlation.** `recovery_ref` (`TZK-XXXXXX`, 6 uppercase
  base32 chars) is embedded in the PSP payment-link reference and is the match
  key between a recovery attempt and its webhook. `provider_payment_id` is the
  fallback. Fuzzy amount/phone matching is permanently excluded from fee-bearing
  numbers.

- **2026-07-22 — Enforcement style.** Opt-out enforcement is guaranteed by a
  build-time import restriction (ESLint `no-restricted-imports` funnels all
  business-initiated sends through `src/lib/whatsapp/outbound-guard.ts`), not by
  per-path tests alone. `pnpm build` runs lint, so any bypass fails the build.

- **2026-07-22 — Revenue-leak-audit surface.** The audit one-pager's "Recovery
  Opportunity" section is a forward-looking projection (recoverABLE revenue from
  failed payments + a 30% no-show resale estimate) and is retained as such,
  relabelled to read as an estimate. Confirmed-only fee math (Item 7) is applied
  by adding a separate "Confirmed Recovered to Date" block sourced exclusively
  from `webhook_confirmed_at`-stamped rows; the recovery dashboard's
  "Recovered"/fee figures are likewise confirmed-only. Re-basing the projection
  itself on confirmed webhooks would zero it out and defeat the report.

- **2026-07-22 — Single-tenant webhook secrets.** `CHECKOUT_WEBHOOK_SECRET` and
  `TAP_WEBHOOK_SECRET` are single-tenant for the pilot. Per-operator secrets are
  a later migration. The Tap `hashstring` verifier is implemented per the
  documented field-concatenation scheme; unit tests exercise the raw-byte
  plumbing and tamper detection against synthetic fixtures, so the live Tap
  field set should be re-validated before production Tap traffic.
