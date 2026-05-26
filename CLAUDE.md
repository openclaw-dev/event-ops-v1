# Event Ops v1 — Project Guide for Claude

## Status

**v1 is complete and deployed.** All 10 issues shipped. Live at [tazkar.co](https://tazkar.co).

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

### Supabase clients
- `createServerClient()` — RLS-enforced, reads the user's session cookie (server components + route handlers)
- `createAdminClient()` — service-role key, used for storage writes and audit_log inserts that RLS blocks

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
```
See `.env.example` for descriptions and where to obtain each value.

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

## Issues Shipped (v1)

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

## Conventions

- **Route handlers** export `export const maxDuration` and `export const runtime = 'nodejs'` for Vercel timeout control
- **Audit log** inserts always use `createAdminClient()` — RLS blocks user inserts
- **Storage** uploads always use `createAdminClient()` — buckets are private
- **No hardcoded URLs** anywhere in the codebase — origins are always derived from `window.location.origin` (client) or `request.url` (server)
- TypeScript strict mode; `any` casts are annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`

## Current Task: Data Entry Surface (v1.5)

Adding the data entry agent on top of the existing support agent. Both share the same Supabase database.

### What is being added
- `supabase/migrations/0013_data_entry.sql` — change_events and mastersheet_mappings tables
- `src/lib/data-entry/` — normaliser, change-events, dato-connector
- `src/app/api/data-entry/` — upload and confirm route handlers
- `src/app/admin/events/[eventId]/sync/` — operator-facing sync UI with upload and change history tabs

### Only two existing files should be modified
1. `src/app/admin/events/[eventId]/layout.tsx` — add Sync nav item
2. `.env.local` and `.env.example` — add DATOCMS_API_TOKEN and DATOCMS_EVENT_MODEL_ID

### Schema facts critical for this task
- `events.name` — not name_en. Single field.
- `events.config JSONB` — stores ticket_tiers, refund_policy, doors_open_local, dress_code, etc. as nested blob
- `events.start_date` / `end_date` — DATE type
- `kb_sections` already exists — change pipeline updates rows in it, does not recreate it
- `EventSetupFormData` in `src/lib/schemas.ts` — canonical shape. Normaliser must output this.
- `current_user_operator_ids()` — RLS helper already exists, use in new policies
- `createAdminClient()` — use for change_events and kb_sections writes (RLS blocks user-scoped writes)

### Patterns to follow
- Auth in route handlers: copy `src/app/api/kb/upload/route.ts`
- Page data fetching: copy `src/app/admin/events/[eventId]/kb/page.tsx`
- Upload form component: copy `src/app/admin/events/[eventId]/kb/_components/kb-upload-form.tsx`
- Nav items in event layout: `src/app/admin/events/[eventId]/layout.tsx`

### Package manager
pnpm — not npm. Use `pnpm add` not `npm install`.

### Rules
- No new packages without asking
- No any types (annotate eslint-disable if genuinely unavoidable)
- Read existing files before writing new ones
- Run `pnpm typecheck` after all steps complete
