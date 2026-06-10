# Event Ops v1 — Project Guide for Claude

## Status

**v1 through v1.8 are complete and deployed.** Live at [tazkar.co](https://tazkar.co).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript strict) |
| Database / Auth | Supabase (`event-ops-dev` project, `cardapi` org) |
| AI | Anthropic SDK — direct (no LangChain) |
| Styling | Tailwind CSS + shadcn/ui |
| Package manager | pnpm |
| Deployment | Vercel (`event-ops-v1` project) |

### AI models in use
- **Classifier:** `claude-haiku-4-5` — intent + language detection, temp 0.2
- **Generator:** `claude-sonnet-4-6` — reply generation, temp 0.3, days-until-event context injected
- **Field mapping inference:** `claude-haiku-4-5` — one-time per client format, cached via SHA-256 fingerprint
- **Change extraction:** `claude-haiku-4-5` — temp 0, cached system prompt, allowlist-validated
- **KB conversion:** `claude-haiku-4-5` — xlsx/docx normalisation, skipped if content already structured

### Supabase clients
- `createServerClient()` — RLS-enforced, reads session cookie
- `createAdminClient()` — service-role key, used for all writes that RLS blocks

## Deployment

| Item | Value |
|---|---|
| Live URL | `https://tazkar.co` |
| Vercel project | `event-ops-v1` |
| GitHub repo | `openclaw-dev/event-ops-v1` (branch: `main`) |
| Supabase project | `event-ops-dev` (org: `cardapi`) |

### Environment variables (set in Vercel + `.env.local`)
```
ANTHROPIC_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL=https://tazkar.co
DATOCMS_API_TOKEN=
DATOCMS_EVENT_MODEL_ID=
WHATSAPP_PROVIDER=
META_APP_SECRET=
META_PERMANENT_TOKEN=
META_PHONE_NUMBER_ID=
META_WEBHOOK_VERIFY_TOKEN=
DIALOG360_API_KEY=
DIALOG360_WABA_ID=
CRON_SECRET=
RESEND_API_KEY=
```

### vercel.json
```json
{
  "crons": [
    { "path": "/api/cron/expire-pending", "schedule": "0 0 * * *" },
    { "path": "/api/cron/weekly-digest", "schedule": "0 9 * * 1" }
  ]
}
```

### WhatsApp sandbox note
Meta temporary access token expires every 24h. After regenerating:
1. Update META_PERMANENT_TOKEN in Vercel
2. Run `vercel deploy --prod`
3. Re-subscribe WABA: `curl -X POST "https://graph.facebook.com/v21.0/2311051229700014/subscribed_apps" -H "Authorization: Bearer YOUR_NEW_TOKEN"`

## Known Issues

### Vercel Hobby plan blocks Co-Authored-By commits
```bash
git reset --soft HEAD~<n> && git commit -m "feat: description" && git push origin main --force
```

### Vercel token expires frequently
Run `vercel login` then `vercel deploy --prod`.

### Always run pnpm build before pushing
`pnpm typecheck` passes but `next build` catches ESLint errors. Run `pnpm build` before every push.

### supabase db push circuit breaker
If CLI hits connection errors, use SQL Editor directly:
https://supabase.com/dashboard/project/gcuhmykneclcpczeoumm/sql/new
After applying manually, repair history: `supabase migration repair --status applied <version>`

### Migration version format
Repair commands use the numeric prefix only: `supabase migration repair --status applied 0026`

## Issues Shipped

### v1 (support agent)
1-10. Full support agent, auth, schema, KB, orders, simulator, conversations, escalations, report, admin UI

### v1.5 (data entry) — 26 May 2026
- Mastersheet upload, Haiku field mapping, DatoCMS connector, change events, KB propagation, Sync tab

### v1.6 (WhatsApp change management) — 27 May 2026
- Promoters table, pending_changes lifecycle, Meta + 360dialog adapters, inbound webhook, pending confirmations UI

### v1.7 (product completeness) — 28-29 May 2026
- Customer WhatsApp support agent with event routing
- Two-tier KB (operator_kb_sections)
- Mastersheet on create (two-path New Event)
- Excel/Word KB upload (mammoth + Haiku normalisation)
- Mastersheet format fingerprint cache
- Event readiness checklist, publish/end controls
- Demo mode with one-click seed (Coastline Festival 2026)
- Conversation metrics bar (total, resolved, escalated, refunds deflected, SAR saved)
- Conversation full-text search, intent filter, date range, CSV export
- Human reply from dashboard → sends via WhatsApp
- Order lookup by name/phone/email
- Greeting personalisation from order
- Agent quality: confidence threshold, source citations, response length calibration
- Days-until-event context injection
- Escalation notification to ops contacts
- Multi-language KB (language column, language-aware retrieval)
- Usage tracking (usage_events table, billing dashboard)
- Weekly digest email (Resend or SendGrid)
- KB gap report + Add to KB from escalation
- WhatsApp settings page with test connection
- Operator KB under Settings

### v1.8 (revenue ops) — 10 Jun 2026
- Revenue leak audit one-pager (HTML download from Report page)
- Failed payment recovery: payment_recovery_attempts table, bulk WhatsApp send, CSV upload UI, Recovery nav tab
- CRM activation: crm_campaigns + crm_campaign_recipients tables, no-show segment API, re-marketing campaigns UI, CRM top-level nav
- Browser-based QR gate scanner: gate_scans table, scan-validator with duplicate detection, bilingual admit/reject, Web Audio feedback, live gate dashboard with auto-refresh stats, manual lookup, Gate nav tab
- Security fixes: IDOR on confirm/cancel/human-reply routes
- Audit fixes: DB-level pagination on escalations, deflection_offered column replacing ilike scan, WIP badges removed, runtime='nodejs' on missing routes, DASHBOARD_BASE env var, session state moved to Supabase, cron error handling, parallel weekly digest

## Conventions

- **Route handlers** export `export const maxDuration` and `export const runtime = 'nodejs'`
- **All writes RLS blocks** use `createAdminClient()` — change_events, pending_changes, kb_sections, operator_kb_sections, usage_events, audit_log, gate_scans, payment_recovery_attempts, crm_campaigns, crm_campaign_recipients, storage
- **No hardcoded URLs** — use `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tazkar.co'`
- TypeScript strict mode; `any` casts annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Package manager is **pnpm** — never use npm install
- **Run `pnpm build` before every push**
- **Deploy via `vercel deploy --prod`** not git push (Hobby plan git integration unreliable)

## Schema facts (read before touching the database)

- `events.name` — not name_en. Single language field.
- `events.config JSONB` — ticket_tiers, refund_policy, doors_open_local, dress_code, parking_info, escalation_contacts, escalation_keywords, vip_orders_always_escalate
- `events.status` — 'draft' | 'live'. Customer WhatsApp routes only to 'live' events.
- `events.is_demo` — boolean, marks demo events
- `kb_sections` — section_id unique per event. language: 'en'|'ar'|'ru'|'all'
- `operator_kb_sections` — same shape, scoped to operator_id. Two-tier KB.
- `change_events` — channel: 'mastersheet'|'whatsapp'
- `mastersheet_mappings` — format_fingerprint + operator_id for cache lookup
- `promoters` — phone whitelist per operator/event
- `pending_changes` — full lifecycle for WhatsApp-inbound change diffs
- `conversations` — channel: 'simulator'|'whatsapp'|'email', customer_phone, wa_message_id, operator_id
- `messages` — source_section TEXT, deflection_offered BOOLEAN. messages.content has GIN FTS index (migration 0020). messages.text has trigram GIN index (migration 0023).
- `orders` — vip_flag boolean, controls vip_orders_always_escalate gate. Indexes: (event_id, customer_email), trigram GIN on customer_name (migration 0023).
- `escalations` — escalation queue per conversation. Silent insert failure is a known risk — check insert error explicitly.
- `audit_log` — append-only, admin client only
- `usage_events` — per-call API cost tracking
- `whatsapp_session_state` — phone PK, pending_event_selection JSONB, expires_at (migration 0025)
- `payment_recovery_attempts` — failed payment recovery tracking, status lifecycle, 22% fee column (migration 0026)
- `crm_campaigns` + `crm_campaign_recipients` — re-marketing campaigns with conversion tracking (migration 0027)
- `gate_scans` — QR scan history, duplicate detection via admitted-unique index on (event_id, scanned_code) WHERE admitted (migration 0028)
- `current_user_operator_ids()` — RLS helper, use in new migration policies

## Key file locations

- Anthropic client: `src/lib/agent/anthropic-client.ts`
- Supabase server: `src/lib/supabase/server.ts`
- Supabase admin: `src/lib/supabase/admin.ts`
- Schemas: `src/lib/schemas.ts`
- Agent types: `src/lib/agent/types.ts`
- Data entry normaliser: `src/lib/data-entry/normaliser.ts`
- WhatsApp adapter factory: `src/lib/whatsapp/adapter-factory.ts`
- Pending changes: `src/lib/data-entry/pending-changes.ts`
- Conversation metrics: `src/lib/agent/conversation-metrics.ts`
- Event readiness: `src/lib/agent/event-readiness.ts`
- Escalation notifier: `src/lib/agent/escalation-notifier.ts`
- KB converters: `src/lib/kb/converters.ts`
- KB gap analysis: `src/lib/kb/gap-analysis.ts`
- Usage tracking: `src/lib/billing/track-usage.ts`
- Email send: `src/lib/email/send.ts`
- Demo seed: `src/lib/demo/seed-demo-event.ts`
- Revenue leak audit: `src/lib/reports/revenue-leak-audit.ts`
- Payment recovery: `src/lib/recovery/payment-recovery.ts`
- CRM campaigns: `src/lib/crm/campaigns.ts`
- Gate scan validator: `src/lib/gate/scan-validator.ts`

## Patterns to follow

- Auth in route handlers: copy `src/app/api/kb/upload/route.ts`
- Ownership check before mutation: copy `src/app/api/changes/[pendingChangeId]/confirm/route.ts`
- Cron route: copy `src/app/api/cron/expire-pending/route.ts`
- Server action: copy `src/app/admin/events/[eventId]/setup/actions.ts`
- Client component with CSV upload: copy `src/app/admin/events/[eventId]/recovery/_components/recovery-uploader.tsx`
- Nav items: `src/app/admin/_components/sidebar.tsx` — EVENT_SUB_NAV and SETTINGS_SUB_NAV arrays

## What still needs external credentials

- DatoCMS: DATOCMS_API_TOKEN + DATOCMS_EVENT_MODEL_ID
- NOFOMO backend: pending Slack message to tech lead
- WhatsApp: META_PERMANENT_TOKEN expires every 24h in sandbox
- CRON_SECRET: set in Vercel
- RESEND_API_KEY: set in Vercel for weekly digest
- NEXT_PUBLIC_SITE_URL: set in Vercel (escalation notifications link)

## Rules for all future Claude Code sessions

- Read this file first
- Read existing files before writing new ones
- No new packages without asking (jsQR was approved for gate scanner)
- No any types
- pnpm not npm
- createAdminClient() for all writes that RLS blocks
- Run `pnpm build` before pushing
- Deploy via `vercel deploy --prod`
- Apply migrations via SQL editor if CLI times out, then `supabase migration repair --status applied <version>`
