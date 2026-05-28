# Event Ops v1 — Project Guide for Claude

## Status

**v1, v1.5, and v1.6 are complete and deployed.** Live at [tazkar.co](https://tazkar.co).

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
- **Generator:** `claude-sonnet-4-6` — reply generation, temp 0.3
- **Field mapping inference:** `claude-haiku-4-5` — one-time per client mastersheet format
- **Change extraction:** `claude-haiku-4-5` — temp 0, cached system prompt, allowlist-validated output

### Supabase clients
- `createServerClient()` — RLS-enforced, reads the user's session cookie (server components + route handlers)
- `createAdminClient()` — service-role key, used for storage writes, audit_log inserts, change_events inserts, kb_sections updates, pending_changes writes that RLS blocks

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
```
See `.env.example` for descriptions. DatoCMS and WhatsApp vars are present but empty — connectors skip gracefully when absent.

### vercel.json
Contains framework detection override AND hourly cron:
```json
{ "crons": [{ "path": "/api/cron/expire-pending", "schedule": "0 * * * *" }] }
```

## Known Issues

### Vercel Hobby plan blocks Co-Authored-By commits
Vercel Hobby rejects pushes that include `Co-Authored-By: Claude` in commit messages.
**Workaround:** squash commits before pushing.
```bash
git reset --soft HEAD~<n> && git commit -m "feat: description" && git push origin main --force
```

### Always run pnpm build before pushing
`pnpm typecheck` passes but `next build` catches ESLint errors that typecheck misses. Vercel will reject the deployment otherwise. This has happened once already (unused prop in PendingTab). Run `pnpm build` locally before every push.

## Auth Flow

Magic-link (OTP) login via Supabase Auth:

1. `tazkar.co/login` — user submits email
2. `emailRedirectTo` is derived from `window.location.origin` at runtime → `https://tazkar.co/auth/callback`
3. Supabase sends magic link; user clicks it
4. `src/app/auth/callback/route.ts` — PKCE code exchange → session cookie set → redirect to `/admin/events`
5. If the link arrives on `www.tazkar.co`, the callback 301-redirects to `tazkar.co` first

**Supabase redirect URL allowlist** must include:
- `https://tazkar.co/auth/callback`
- `https://www.tazkar.co/auth/callback`

## Issues Shipped

### v1 (support agent)
1. Project scaffold — Next.js 14, Supabase, Tailwind, shadcn/ui
2. Auth — magic-link login, session middleware, `/auth/callback` route
3. Database schema — events, orders, conversations, messages, escalations, KB tables
4. Order import — CSV upload, validation, batched upsert (`POST /api/orders/import`)
5. KB upload — Markdown/JSON parser, section upsert (`POST /api/kb/upload`)
6. Agent classifier — Haiku intent + language detection
7. Agent state machine — greeting → FAQ → order lookup → refund deflection → escalation
8. Agent runtime — full conversation loop wired to DB and Anthropic SDK
9. Post-event PDF report — operator summary generated server-side
10. Admin UI — Conversations and Escalations tabs, Simulator, Orders, KB management

### v1.5 (data entry surface) — shipped 26 May 2026
- `supabase/migrations/0013_data_entry.sql` — change_events and mastersheet_mappings tables
- `src/lib/data-entry/normaliser.ts` — xlsx parser, vertical KV + horizontal format detection, Haiku field mapping
- `src/lib/data-entry/change-events.ts` — recordChangeEvent() and propagateToKB() using admin client
- `src/lib/data-entry/dato-connector.ts` — DatoCMS connector, skips gracefully if credentials absent
- `src/app/api/data-entry/upload/route.ts` and `confirm/route.ts`
- `src/app/admin/events/[eventId]/sync/` — Sync page with Upload, Pending, Change History tabs
- `src/components/ui/tabs.tsx` — shadcn Tabs component added

### v1.6 (WhatsApp change management) — shipped 27 May 2026
- `supabase/migrations/0014_whatsapp_change_mgmt.sql` — promoters and pending_changes tables
- `src/lib/whatsapp/` — adapter interface, Meta and 360dialog implementations, shared parser
- `src/app/api/whatsapp/inbound/route.ts` — inbound webhook, always returns 200
- `src/lib/data-entry/whatsapp-change-extractor.ts` — Haiku extraction, allowlist-validated
- `src/lib/data-entry/whatsapp-change-diff.ts` — pure diff generation, zod coercion per field
- `src/lib/data-entry/pending-changes.ts` — full lifecycle: create, supersede, expire, cancel, confirm
- `src/app/api/changes/` — confirm, cancel, pending GET routes
- `src/app/api/cron/expire-pending/route.ts` — hourly cron
- `src/app/admin/events/[eventId]/sync/_components/pending-tab.tsx` — pending confirmations UI
- `src/app/admin/events/[eventId]/promoters/` — promoter management UI and API routes
- `src/components/ui/switch.tsx` — shadcn Switch component added (`@radix-ui/react-switch` installed)

## Conventions

- **Route handlers** export `export const maxDuration` and `export const runtime = 'nodejs'`
- **Audit log** inserts always use `createAdminClient()` — RLS blocks user inserts
- **Storage** uploads always use `createAdminClient()` — buckets are private
- **change_events, pending_changes, kb_sections** writes always use `createAdminClient()`
- **No hardcoded URLs** — origins always from `window.location.origin` (client) or `request.url` (server)
- TypeScript strict mode; `any` casts annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Package manager is **pnpm** — never use npm install
- **Run `pnpm build` before every push** — not just `pnpm typecheck`

## Schema facts (read before touching the database)

- `events.name` — not name_en. Single language field.
- `events.config JSONB` — stores ticket_tiers, refund_policy, doors_open_local, dress_code, parking_info, escalation_contacts, escalation_keywords, vip_orders_always_escalate as a nested blob
- `events.start_date` / `end_date` — DATE type
- `kb_sections` — exists from v1. section_id unique per event. Do not recreate. propagateToKB updates rows here.
- `change_events` — added in 0013. Every confirmed field change. Admin client only.
- `mastersheet_mappings` — added in 0013. Stored field mapping per operator format.
- `promoters` — added in 0014. Phone whitelist per operator/event for WhatsApp changes.
- `pending_changes` — added in 0014. Full lifecycle for WhatsApp-inbound change diffs.
- `EventSetupFormData` in `src/lib/schemas.ts` — canonical shape for event data.
- `current_user_operator_ids()` — RLS helper, already exists, use in new migration policies.

## Key file locations

- Anthropic client: `src/lib/agent/anthropic-client.ts` — do not create a new client
- Supabase server client: `src/lib/supabase/server.ts`
- Supabase admin client: `src/lib/supabase/admin.ts`
- Canonical types: `src/lib/agent/types.ts`
- Canonical schemas: `src/lib/schemas.ts`
- Data entry normaliser: `src/lib/data-entry/normaliser.ts`
- Data entry change events: `src/lib/data-entry/change-events.ts`
- DatoCMS connector: `src/lib/data-entry/dato-connector.ts`
- WhatsApp adapter factory: `src/lib/whatsapp/adapter-factory.ts`
- Pending changes lifecycle: `src/lib/data-entry/pending-changes.ts`
- Change extractor: `src/lib/data-entry/whatsapp-change-extractor.ts`
- Diff generator: `src/lib/data-entry/whatsapp-change-diff.ts`

## Patterns to follow

- Auth in route handlers: copy `src/app/api/kb/upload/route.ts`
- Page data fetching: copy `src/app/admin/events/[eventId]/kb/page.tsx`
- Upload form component: copy `src/app/admin/events/[eventId]/kb/_components/kb-upload-form.tsx`
- Change history table: copy `src/app/admin/events/[eventId]/sync/_components/history-tab.tsx`
- Pending tab (client component with optimistic updates): copy `src/app/admin/events/[eventId]/sync/_components/pending-tab.tsx`
- Nav items: `src/app/admin/_components/sidebar.tsx` — EVENT_SUB_NAV array

## What still needs external credentials

- DatoCMS: set DATOCMS_API_TOKEN and DATOCMS_EVENT_MODEL_ID in Vercel + .env.local
- NOFOMO backend: pending internal API confirmation from tech lead
- WhatsApp: set WHATSAPP_PROVIDER=meta, META_APP_SECRET, META_PERMANENT_TOKEN, META_PHONE_NUMBER_ID in Vercel + .env.local. Meta developer sandbox works for testing without business verification.
- CRON_SECRET: set in Vercel for the hourly expire-pending cron

## Next priorities

1. Meta developer sandbox setup — test WhatsApp flow end to end with real phone (no business verification needed)
2. Operator demo calls — product is demo-ready, book 3 calls
3. DatoCMS credentials — one Slack message to CMS owner
4. NOFOMO backend API — one Slack message to tech lead
5. Manager conversation — employment contract IP check

## Rules for all future Claude Code sessions

- Read this file first
- Read existing files before writing new ones
- No new packages without asking
- No any types
- pnpm not npm
- createAdminClient() for all change_events, pending_changes, kb_sections, audit_log writes
- Run `pnpm build` before pushing — not just `pnpm typecheck`
