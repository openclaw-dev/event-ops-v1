# Event Ops v1 — Project Guide for Claude

## Status

**v1, v1.5, v1.6, and v1.7 are complete and deployed.** Live at [tazkar.co](https://tazkar.co).

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
- **Field mapping inference:** `claude-haiku-4-5` — one-time per client format, cached via fingerprint
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
Contains framework detection override AND two crons:
```json
{
  "crons": [
    { "path": "/api/cron/expire-pending", "schedule": "0 0 * * *" },
    { "path": "/api/cron/weekly-digest", "schedule": "0 9 * * 1" }
  ]
}
```
Note: expire-pending runs daily at midnight (Hobby plan limit). weekly-digest runs every Monday at 9am UTC.

### WhatsApp sandbox note
Meta temporary access token expires every 24 hours. After regenerating:
1. Update META_PERMANENT_TOKEN in Vercel env vars
2. Run `vercel deploy --prod`
3. Re-run WABA subscription: `curl -X POST "https://graph.facebook.com/v21.0/2311051229700014/subscribed_apps" -H "Authorization: Bearer YOUR_NEW_TOKEN"`

## Known Issues

### Vercel Hobby plan blocks Co-Authored-By commits
```bash
git reset --soft HEAD~<n> && git commit -m "feat: description" && git push origin main --force
```

### Vercel token expires frequently
Run `vercel login` then `vercel deploy --prod` when token errors appear.

### Always run pnpm build before pushing
`pnpm typecheck` passes but `next build` catches ESLint errors. Run `pnpm build` locally before every push.

### supabase db push circuit breaker
If Supabase CLI hits connection errors repeatedly, use the SQL Editor directly at:
https://supabase.com/dashboard/project/gcuhmykneclcpczeoumm/sql/new

## Auth Flow

Magic-link (OTP) via Supabase Auth → `/auth/callback` → session cookie → `/admin/events`.

## Issues Shipped

### v1 (support agent)
1. Project scaffold
2. Auth — magic-link, session middleware
3. Database schema — events, orders, conversations, messages, escalations, KB tables
4. Order import — CSV upload, batched upsert
5. KB upload — Markdown/JSON parser
6. Agent classifier — Haiku intent + language detection
7. Agent state machine — greeting → FAQ → order lookup → refund deflection → escalation
8. Agent runtime — full conversation loop
9. Post-event PDF report
10. Admin UI — Conversations, Escalations, Simulator, Orders, KB management

### v1.5 (data entry surface) — shipped 26 May 2026
- `supabase/migrations/0013_data_entry.sql` — change_events and mastersheet_mappings tables
- `src/lib/data-entry/normaliser.ts` — xlsx parser, vertical KV + horizontal format detection
- `src/lib/data-entry/change-events.ts` — recordChangeEvent() and propagateToKB()
- `src/lib/data-entry/dato-connector.ts` — DatoCMS connector, graceful skip
- Sync page — Upload, Pending, Change History tabs

### v1.6 (WhatsApp change management) — shipped 27 May 2026
- `supabase/migrations/0014_whatsapp_change_mgmt.sql` — promoters and pending_changes tables
- `src/lib/whatsapp/` — Meta and 360dialog adapters, shared parser
- Inbound webhook — always returns 200
- Change extraction, diff generation, pending lifecycle
- Promoter management UI and API routes
- Hourly cron for expiring stale pending changes

### v1.7 (product completeness) — shipped 28-29 May 2026
- `supabase/migrations/0015_operator_kb.sql` — operator_kb_sections table (two-tier KB)
- `supabase/migrations/0016_mastersheet_fingerprint.sql` — format_fingerprint + operator_id on mastersheet_mappings
- `supabase/migrations/0017_conversation_whatsapp.sql` — channel, customer_phone, wa_message_id, operator_id on conversations
- `supabase/migrations/0018_kb_language.sql` — language column on kb_sections and operator_kb_sections
- `supabase/migrations/0019_demo_flag.sql` — is_demo column on events
- `supabase/migrations/0020_messages_fts_index.sql` — GIN index on messages.content for full-text search
- `supabase/migrations/0021_messages_source_section.sql` — source_section column on messages
- `supabase/migrations/0022_usage_tracking.sql` — usage_events table for billing
- Customer WhatsApp support agent — inbound routes to agent state machine for non-promoter senders
- Event routing — auto-routes to single active event, prompts selection for multiple
- Operator KB — two-tier KB, Settings → Knowledge Base page
- Mastersheet on create — two-path New Event (form or mastersheet upload)
- Excel/Word KB upload — xlsx/docx conversion via mammoth + Haiku normalisation
- Mastersheet format cache — SHA-256 fingerprint, Haiku skipped on cache hit
- Changed-by display name in Change History — promoter name + phone instead of UUID
- Event readiness checklist — 9-item checklist, blocks publish if required items missing
- Publish event button + End event button on Setup page
- Event status badges — colored dots in sidebar and events list
- Demo mode — one-click demo event creation with full seed data
- Conversation metrics bar — total, resolved by AI, escalated, refunds deflected, SAR saved
- Conversation search — full-text search, intent filter, date range, CSV export
- Human reply from dashboard — operator replies to escalated WhatsApp conversations
- Order lookup by name/phone/email — not just order ID
- Greeting personalisation — agent uses customer first name from order
- Agent quality — confidence threshold escalation, response length calibration, source citations
- Days-until-event context — injected into generator system prompt
- Escalation notification — WhatsApp message to escalation contacts
- Multi-language KB — language field on sections, language-aware retrieval
- Usage tracking — cost per API call, Usage & Billing page in Settings
- Weekly digest email — Monday morning summary per operator (Resend or SendGrid)
- KB gap report — coverage score, top escalated intents, Add to KB button
- WhatsApp settings page — Phone Number ID, display number, test connection button
- Operator-level KB — Settings → Knowledge Base for cross-event content

## Conventions

- **Route handlers** export `export const maxDuration` and `export const runtime = 'nodejs'`
- **All DB writes that RLS blocks** use `createAdminClient()` — change_events, pending_changes, kb_sections, operator_kb_sections, usage_events, audit_log, storage
- **No hardcoded URLs** — origins from `window.location.origin` (client) or `request.url` (server)
- TypeScript strict mode; `any` casts annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Package manager is **pnpm** — never use npm install
- **Run `pnpm build` before every push** — not just `pnpm typecheck`
- **Deploy via CLI** — `vercel deploy --prod` not git integration (Hobby plan git integration is unreliable)

## Schema facts (read before touching the database)

- `events.name` — not name_en. Single language field.
- `events.config JSONB` — ticket_tiers, refund_policy, doors_open_local, dress_code, parking_info, escalation_contacts, escalation_keywords, vip_orders_always_escalate
- `events.start_date` / `end_date` — DATE type
- `events.status` — 'draft' | 'live'. Publish button sets to 'live'. Customer WhatsApp routes only to 'live' events.
- `events.is_demo` — boolean, marks demo events created via one-click seed
- `kb_sections` — section_id unique per event. language column: 'en'|'ar'|'ru'|'all'
- `operator_kb_sections` — same shape as kb_sections but scoped to operator_id. Two-tier KB.
- `change_events` — every confirmed field change. channel: 'mastersheet'|'whatsapp'
- `mastersheet_mappings` — format_fingerprint + operator_id for cache lookup
- `promoters` — phone whitelist per operator/event
- `pending_changes` — full lifecycle for WhatsApp-inbound change diffs
- `conversations` — channel: 'simulator'|'whatsapp'|'email', customer_phone, wa_message_id, operator_id
- `messages` — source_section TEXT (which KB section was cited)
- `usage_events` — per-call API cost tracking, operator_id + event_id + model + tokens + cost_usd
- `current_user_operator_ids()` — RLS helper, use in new migration policies

## Key file locations

- Anthropic client: `src/lib/agent/anthropic-client.ts` — do not create a new client
- Supabase server: `src/lib/supabase/server.ts`
- Supabase admin: `src/lib/supabase/admin.ts`
- Canonical schemas: `src/lib/schemas.ts`
- Canonical types: `src/lib/agent/types.ts`
- Data entry normaliser: `src/lib/data-entry/normaliser.ts`
- Change events: `src/lib/data-entry/change-events.ts`
- DatoCMS connector: `src/lib/data-entry/dato-connector.ts`
- WhatsApp adapter factory: `src/lib/whatsapp/adapter-factory.ts`
- Pending changes: `src/lib/data-entry/pending-changes.ts`
- Change extractor: `src/lib/data-entry/whatsapp-change-extractor.ts`
- Diff generator: `src/lib/data-entry/whatsapp-change-diff.ts`
- WhatsApp router: `src/lib/agent/whatsapp-router.ts`
- WhatsApp conversation: `src/lib/agent/whatsapp-conversation.ts`
- WhatsApp session state: `src/lib/agent/whatsapp-session-state.ts`
- Conversation metrics: `src/lib/agent/conversation-metrics.ts`
- Event readiness: `src/lib/agent/event-readiness.ts`
- Escalation notifier: `src/lib/agent/escalation-notifier.ts`
- KB converters (xlsx/docx): `src/lib/kb/converters.ts`
- KB gap analysis: `src/lib/kb/gap-analysis.ts`
- Usage tracking: `src/lib/billing/track-usage.ts`
- Email send: `src/lib/email/send.ts`
- Weekly digest: `src/lib/email/weekly-digest.ts`
- Demo seed: `src/lib/demo/seed-demo-event.ts`

## Patterns to follow

- Auth in route handlers: copy `src/app/api/kb/upload/route.ts`
- Page data fetching: copy `src/app/admin/events/[eventId]/kb/page.tsx`
- Client component with optimistic updates: copy `src/app/admin/events/[eventId]/sync/_components/pending-tab.tsx`
- Cron route auth: copy `src/app/api/cron/expire-pending/route.ts`
- Server action pattern: copy `src/app/admin/events/[eventId]/setup/actions.ts`
- Nav items: `src/app/admin/_components/sidebar.tsx` — EVENT_SUB_NAV and SETTINGS_SUB_NAV arrays

## What still needs external credentials

- DatoCMS: DATOCMS_API_TOKEN + DATOCMS_EVENT_MODEL_ID
- NOFOMO backend: pending Slack message to tech lead
- WhatsApp: META_PERMANENT_TOKEN expires every 24h in sandbox — regenerate + redeploy + re-subscribe WABA
- CRON_SECRET: set in Vercel
- RESEND_API_KEY: set in Vercel for weekly digest emails

## Current priorities (selling, not building)

1. Test customer WhatsApp flow end to end — publish Boho Beach Test, send message from phone
2. Book 3 operator demo calls this week
3. Manager conversation — employment contract IP check
4. DatoCMS credentials — Slack message to CMS owner after holidays
5. NOFOMO backend API — Slack message to tech lead after holidays

## Rules for all future Claude Code sessions

- Read this file first
- Read existing files before writing new ones
- No new packages without asking
- No any types
- pnpm not npm
- createAdminClient() for all writes that RLS blocks
- Run `pnpm build` before pushing — not just `pnpm typecheck`
- Deploy via `vercel deploy --prod` not git push (Hobby plan git integration unreliable)
