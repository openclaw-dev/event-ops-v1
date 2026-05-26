# Event Ops v1 — Project Guide for Claude

## Status

**v1 and v1.5 are complete and deployed.** All 10 v1 issues shipped + data entry surface. Live at [tazkar.co](https://tazkar.co).

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

### Supabase clients
- `createServerClient()` — RLS-enforced, reads the user's session cookie (server components + route handlers)
- `createAdminClient()` — service-role key, used for storage writes, audit_log inserts, change_events inserts, kb_sections updates that RLS blocks

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
```
See `.env.example` for descriptions. DatoCMS vars are present but empty — connector skips gracefully when absent.

### vercel.json
A `vercel.json` is present at the repo root to force Next.js framework detection.
`pnpm-workspace.yaml` at the root was causing Vercel to misdetect the project as a
monorepo and look for a `public/` output directory. The `vercel.json` overrides that.

## Known Issues

### Vercel Hobby plan blocks Co-Authored-By commits
Vercel Hobby rejects pushes that include `Co-Authored-By: Claude` in commit messages.
**Workaround:** squash all commits into one before pushing to `main`, or upgrade to Vercel Pro.
```bash
# Squash example (interactive — pick the range that includes Claude co-author commits):
git rebase -i HEAD~<n>
# mark all but the first as 'squash', amend the message to remove Co-Authored-By lines
git push origin main
```

## Auth Flow

Magic-link (OTP) login via Supabase Auth:

1. `tazkar.co/login` — user submits email
2. `emailRedirectTo` is derived from `window.location.origin` at runtime → `https://tazkar.co/auth/callback`
3. Supabase sends magic link; user clicks it
4. `src/app/auth/callback/route.ts` — PKCE code exchange → session cookie set → redirect to `/admin/events`
5. If the link arrives on `www.tazkar.co`, the callback 301-redirects to `tazkar.co` first (preserves the `?code=` param)

**Supabase redirect URL allowlist** (Authentication → URL Configuration) must include:
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
- `supabase/migrations/0013_data_entry.sql` — change_events and mastersheet_mappings tables with RLS
- `src/lib/data-entry/normaliser.ts` — xlsx parser, vertical KV + horizontal format detection, Haiku field mapping
- `src/lib/data-entry/change-events.ts` — recordChangeEvent() and propagateToKB() using admin client
- `src/lib/data-entry/dato-connector.ts` — DatoCMS connector, skips gracefully if credentials absent
- `src/app/api/data-entry/upload/route.ts` — POST /api/data-entry/upload
- `src/app/api/data-entry/confirm/route.ts` — POST /api/data-entry/confirm
- `src/app/admin/events/[eventId]/sync/` — Sync page with Upload and Change History tabs
- `src/components/ui/tabs.tsx` — shadcn Tabs component added

## Conventions

- **Route handlers** export `export const maxDuration` and `export const runtime = 'nodejs'` for Vercel timeout control
- **Audit log** inserts always use `createAdminClient()` — RLS blocks user inserts
- **Storage** uploads always use `createAdminClient()` — buckets are private
- **change_events** inserts always use `createAdminClient()` — RLS blocks user inserts
- **kb_sections** updates in propagateToKB always use `createAdminClient()`
- **No hardcoded URLs** anywhere in the codebase — origins always derived from `window.location.origin` (client) or `request.url` (server)
- TypeScript strict mode; `any` casts are annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Package manager is **pnpm** — never use npm install

## Schema facts (critical — read before touching the database)

- `events.name` — not name_en. Single language field.
- `events.config JSONB` — stores ticket_tiers, refund_policy, doors_open_local, dress_code, parking_info, escalation_contacts, escalation_keywords, vip_orders_always_escalate as a nested blob
- `events.start_date` / `end_date` — DATE type
- `kb_sections` — already exists from v1. section_id is unique per event. Do not recreate. propagateToKB updates rows here.
- `change_events` — added in 0013. Records every confirmed field change. Uses admin client.
- `mastersheet_mappings` — added in 0013. Stores inferred field mapping per operator format.
- `EventSetupFormData` in `src/lib/schemas.ts` — canonical shape for event data. Normaliser outputs this shape.
- `current_user_operator_ids()` — RLS helper function, already exists, use in new migration policies

## Key file locations

- Anthropic client: `src/lib/agent/anthropic-client.ts` — do not create a new client
- Supabase server client: `src/lib/supabase/server.ts`
- Supabase admin client: `src/lib/supabase/admin.ts`
- Canonical types: `src/lib/agent/types.ts`
- Canonical schemas: `src/lib/schemas.ts`
- Data entry normaliser: `src/lib/data-entry/normaliser.ts`
- Data entry change events: `src/lib/data-entry/change-events.ts`
- DatoCMS connector: `src/lib/data-entry/dato-connector.ts`

## Patterns to follow

- Auth in route handlers: copy `src/app/api/kb/upload/route.ts`
- Page data fetching: copy `src/app/admin/events/[eventId]/kb/page.tsx`
- Upload form component: copy `src/app/admin/events/[eventId]/kb/_components/kb-upload-form.tsx`
- Change history table: copy `src/app/admin/events/[eventId]/sync/_components/history-tab.tsx`
- Nav items: `src/app/admin/_components/sidebar.tsx` — EVENT_SUB_NAV array

## What still needs external credentials

- DatoCMS: set DATOCMS_API_TOKEN and DATOCMS_EVENT_MODEL_ID in Vercel env vars + .env.local
- NOFOMO backend: pending internal API confirmation from tech lead (holiday until next week)

## Next feature to build: WhatsApp change management (v1.6)

A promoter sends free-text to a WhatsApp number ("doors now 10pm, VIP is 950"). The system:
1. Extracts structured field changes via Haiku
2. Shows the operator a diff
3. On confirmation writes to Supabase via existing `recordChangeEvent` and `propagateToKB`
4. Calls `pushEventToDato` for DatoCMS sync

Spec will be in `whatsapp_change_mgmt_spec.md` once written.

## Rules for all future Claude Code sessions

- Read this file first
- Read existing files before writing new ones
- No new packages without asking
- No any types
- pnpm not npm
- createAdminClient() for all change_events, kb_sections, audit_log writes
- Run pnpm typecheck after completing all steps
