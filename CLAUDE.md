# Event Ops v1 — Project Guide for Claude

## Status

**v1 through v1.8 are complete and deployed.** Live at [tazkar.co](https://tazkar.co). Customer WhatsApp support flow verified working end-to-end on 20 Jun 2026 after a multi-bug debugging session (see Known Issues below for the full pattern catalogue — read this before touching WhatsApp code).

**July 2026:** full codebase audit (`AUDIT_2026-07.md`, 59 findings) remediated across commits `84d7195..82bd3d0`. Both P0s fixed: RLS enabled on `whatsapp_session_state` (migration 0030) and the KB propagation silent no-op. Landing page redesign deployed (`af73e28`).

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

### Supabase clients — READ THIS BEFORE ANY DB WRITE
- `createServerClient()` — RLS-enforced, reads session cookie. **Only safe for tables with an UPDATE/INSERT policy.**
- `createAdminClient()` — service-role key, bypasses RLS entirely.

**CRITICAL FAILURE PATTERN (confirmed root cause of a real production bug):** several tables (e.g. `operators`) have RLS **enabled** but only a SELECT policy — no UPDATE policy exists. An RLS-scoped `.update()` against such a table returns `{ error: null }` and the UI shows "Saved" even though **zero rows were actually changed**. This is silent and will not throw. Before writing any new server action that mutates a table, check the table's migration file for the actual policy list — do not assume a working SELECT policy implies a working UPDATE policy. When in doubt, use `createAdminClient()` after verifying membership/ownership yourself, and always `.select()` the affected row(s) after the write with a zero-rows guard so silent failures surface as errors instead of false "Saved" messages.

## Deployment

| Item | Value |
|---|---|
| Live URL | `https://tazkar.co` |
| Vercel project | `event-ops-v1` |
| GitHub repo | `openclaw-dev/event-ops-v1` (branch: `main`) |
| Supabase project | `event-ops-dev` (org: `cardapi`) |

### Deploy path

Deploys are triggered by **`git push origin main`** (Vercel auto-deploy). Use the dashboard **Redeploy** button for env-var-only changes. The Vercel CLI (`vercel deploy --prod`) fails with TLS errors on this network and is **not** a documented deploy path — see the CLI-vs-dashboard note below.

### Environment variables (set in Vercel + `.env.local`)
```
ANTHROPIC_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL=https://tazkar.co
DATOCMS_API_TOKEN=
DATOCMS_EVENT_MODEL_ID=
WHATSAPP_PROVIDER=meta
META_APP_SECRET=
META_PERMANENT_TOKEN=
META_PHONE_NUMBER_ID=
META_WEBHOOK_VERIFY_TOKEN=
DIALOG360_API_KEY=
DIALOG360_WABA_ID=
CRON_SECRET=
RESEND_API_KEY=
```

**`WHATSAPP_PROVIDER` must be exactly `meta` or `360dialog` with NO trailing newline or whitespace.** `provider === 'meta'` is an exact string match — `"meta\n" !== "meta"`. This single bug took an entire debugging session to find because it causes the adapter factory to throw on every webhook call with no visible symptom other than "POST returns 200 but zero outgoing requests."

### vercel.json
```json
{
  "crons": [
    { "path": "/api/cron/expire-pending", "schedule": "0 0 * * *" },
    { "path": "/api/cron/weekly-digest", "schedule": "0 9 * * 1" }
  ]
}
```

## WhatsApp sandbox operational checklist — RUN THIS EVERY SESSION BEFORE TESTING

Meta sandbox tokens are short-lived (observed expiring within hours, not the documented 24h, on at least one occasion this session). **Do this full sequence at the start of every WhatsApp testing session, not just when something breaks:**

1. Meta dashboard → My Apps → event-ops-test → Use cases → Customize → Step 1. Try it out → **Generate token** → copy it
2. Update `META_PERMANENT_TOKEN` in Vercel (dashboard UI is more reliable than CLI — see CLI note below) → redeploy
3. Resubscribe WABA with the **same new token**:
   ```bash
   curl -X POST "https://graph.facebook.com/v21.0/2311051229700014/subscribed_apps" \
     -H "Authorization: Bearer NEW_TOKEN"
   ```
   Expect `{"success":true}`.
4. Confirm test phone is in Recipient dropdown (Step 1. Try it out page). Re-add + SMS-verify if it dropped off — this happens periodically without explanation.
5. Click **Send message** (any template) to open/refresh the 24h customer-initiated window.
6. Only then send the actual test message.

**If a reply never arrives despite a 200 response from `/api/whatsapp/inbound`:** the webhook accepting the request does not mean Meta delivered the reply. Check the `[meta-adapter] postToMeta` log line specifically — it logs the real HTTP status and Meta's error body on failure. A `401` here means the token died mid-session; regenerate and redo the full checklist above. Do not assume the application code is broken before checking this log line.

### CLI vs dashboard for env var changes
The Vercel CLI (`vercel env rm` / `vercel env add` / `vercel deploy`) intermittently fails with `FetchError: ... Client network socket disconnected before secure TLS connection was established` on some networks, with no clear cause. When this happens repeatedly (not a one-off), stop retrying the CLI and use the dashboard instead: Settings → Environment Variables → Edit, then Deployments → Redeploy. Always verify the actual stored value afterward — `vercel env ls` only shows that a var exists, not its value, since it's encrypted. To check the real value: `vercel env pull .env.production.check --environment=production && grep VARNAME .env.production.check && rm .env.production.check` (delete the file immediately, it contains secrets in plaintext).

## Known Issues — debugging patterns, read before touching WhatsApp/agent code

### printf not echo for all Vercel env var writes
`echo "value" | vercel env add VAR production` stores a trailing `\n` in the value. Any exact-match check (`=== 'meta'`) will then fail forever with no obvious error. **Always use `printf "value" | vercel env add ...`** — printf does not append a newline.

### Silent RLS write failures
See the Supabase clients section above. This is the single most expensive bug class found this session — it cost an entire debugging arc because "Saved" in the UI gave false confidence that the database actually changed.

### Lost context across multi-turn WhatsApp flows
When a flow requires a follow-up message from the customer (e.g. "which event are you asking about, reply 1 or 2"), the ORIGINAL question must be persisted somewhere (currently `whatsapp_session_state.original_message`, added in migration 0029) and re-injected once the follow-up is resolved. Do not assume the customer's short reply ("1") is itself a usable input to the agent — it almost never is. Any new multi-turn flow must follow this same persist-then-reinject pattern.

### Event routing query bounds must be explicit on both ends
A draft event with a future `end_date` was incorrectly matching a "recently ended events" filter that only had a lower bound (`end_date.gte.cutoff`) and no upper bound. Any date-range filter for "recently happened" must bound both directions: `end_date.gte.cutoff AND end_date.lt.today`.

### Operator/phone-number-ID uniqueness is not enforced at the DB level
`getOperatorByPhoneNumberId` expects exactly one matching row. Nothing currently prevents two operators from having the same `whatsapp_business_phone_number_id`. If a demo seed or manual backfill sets this value on the wrong operator, the lookup can return multiple rows or wrong data with no schema-level error. Before backfilling this column directly via SQL, always verify uniqueness with the SELECT pattern below first.

```sql
-- Always verify after any operator phone-ID write:
SELECT name, whatsapp_business_phone_number_id
FROM operators
WHERE whatsapp_business_phone_number_id = 'THE_ID';
-- Must return exactly one row.
```

### Diagnostic logging convention
The inbound webhook (`route.ts`) and `meta-adapter.ts` have an established console.log pattern at every decision point: `[inbound] <step description> { relevant data }`. When adding new branches to either file, follow this exact pattern — it is what made the multi-session bug hunt tractable. Specifically log: message received, promoter lookup result, operator lookup result, event routing result, extraction/diff result, generator confidence check, and the full Meta API response (success or failure body) via `postToMeta`.

### Vercel Hobby plan blocks Co-Authored-By commits
```bash
git reset --soft HEAD~<n> && git commit -m "feat: description" && git push origin main --force
```

### Always run pnpm build before pushing
`pnpm typecheck` passes but `next build` catches ESLint errors. Run `pnpm build` before every push.

### supabase db push circuit breaker
If CLI hits connection errors, use SQL Editor directly:
https://supabase.com/dashboard/project/gcuhmykneclcpczeoumm/sql/new
After applying manually, repair history: `supabase migration repair --status applied 0026` (numeric prefix only, e.g. `0026` not `0026_payment_recovery`).

### Migration 0029 shows local-only in migration history
`supabase migration list` shows `0029` as local-only, but it **is applied on the live DB** (its `original_message` column exists in production) — a repair-history gap, not a schema gap. Fix: `supabase migration repair --status applied 0029`. (Same class as the circuit-breaker note above.)

### Recovery opt-out is behavioural-only until migration 0031
The inbound pre-router (`src/lib/whatsapp/inbound-pre-router.ts`) suppresses the AI and sends a confirmation on a STOP/opt-out keyword, but `payment_recovery_attempts` has **no opt-out column** (the 0026 status enum has no such value), so a recovery opt-out is **not durably recorded** — it only stops the current inbound turn. CRM has a related **re-add gap**: a recipient marked `status='opted_out'` is excluded from its campaign's send (sends target `status='pending'` only), but nothing blocks the same phone being re-added as `pending` in a **new** campaign. Both close when the deferred `whatsapp_opt_outs` table (migration 0031) lands.

### iPhone Safari crash on client-side navigation from `/` to `/login`
Reported open issue: navigating from the marketing landing (`/`) to `/login` on iOS Safari crashes the tab. **No fix commit exists** (HEAD is `82bd3d0`). Open, reproduce on a real iOS Safari session before attempting a fix — do not fix blind.

## Issues Shipped

### v1 (support agent)
Full support agent, auth, schema, KB, orders, simulator, conversations, escalations, report, admin UI.

### v1.5 (data entry) — 26 May 2026
Mastersheet upload, Haiku field mapping, DatoCMS connector, change events, KB propagation, Sync tab.

### v1.6 (WhatsApp change management) — 27 May 2026
Promoters table, pending_changes lifecycle, Meta + 360dialog adapters, inbound webhook, pending confirmations UI.

### v1.7 (product completeness) — 28-29 May 2026
Customer WhatsApp support agent, two-tier KB, mastersheet on create, Excel/Word KB upload, format fingerprint cache, event readiness checklist, demo mode, conversation metrics, search, human reply from dashboard, order lookup, greeting personalisation, agent quality (confidence/citations/length), days-until-event context, escalation notification, multi-language KB, usage tracking, weekly digest, KB gap report, WhatsApp settings page, operator KB.

### v1.8 (revenue ops) — 10 Jun 2026
Revenue leak audit one-pager, failed payment recovery (WhatsApp), CRM activation (no-show re-marketing), browser-based QR gate scanner, full security/audit fix pass (IDORs, pagination, deflection metric, WIP badges, runtime config, hardcoded URLs, session state persistence, cron error handling).

### WhatsApp pipeline debugging — 20 Jun 2026
Customer support flow verified working end-to-end after fixing: trailing-newline env var, RLS silent write failure on operators table, duplicate phone-number-ID across operators, draft events leaking into multi-event routing, lost question context after multi-event selection. See Known Issues above for the durable patterns extracted from this session.

## Conventions

- **Route handlers** export `export const maxDuration` and `export const runtime = 'nodejs'`
- **All writes RLS blocks (or might block — verify the policy first)** use `createAdminClient()` after an explicit ownership/membership check
- **No hardcoded URLs** — use `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tazkar.co'`
- TypeScript strict mode; `any` casts annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Package manager is **pnpm** — never use npm install
- **Run `pnpm build` before every push**
- **Deploy via `git push origin main`** (Vercel auto-deploy); use the dashboard Redeploy button for env-var-only changes. The Vercel CLI (`vercel deploy --prod`) fails with TLS errors on this network and is not a documented path

## Schema facts (read before touching the database)

- `events.name` — not name_en. Single language field.
- `events.config JSONB` — ticket_tiers, refund_policy, doors_open_local, dress_code, parking_info, escalation_contacts, escalation_keywords, vip_orders_always_escalate
- `events.status` — 'draft' | 'live'. Customer WhatsApp routes only to 'live' events, PLUS draft events whose `end_date` falls strictly between 48h-ago and today (recently-ended post-event support window). A draft event with a future end_date must never appear in routing — this was a real bug, the query must bound both ends of the date range.
- `events.is_demo` — boolean, marks demo events
- `kb_sections` — section_id unique per event. language: 'en'|'ar'|'ru'|'all'
- `operator_kb_sections` — same shape, scoped to operator_id. Two-tier KB.
- `change_events` — channel: 'mastersheet'|'whatsapp'
- `mastersheet_mappings` — format_fingerprint + operator_id for cache lookup
- `promoters` — phone whitelist per operator/event. **A phone number in this table routes to change-management, not customer support — remove it to test the customer flow.**
- `pending_changes` — full lifecycle for WhatsApp-inbound change diffs
- `conversations` — channel: 'simulator'|'whatsapp'|'email', customer_phone, wa_message_id, operator_id
- `messages` — source_section TEXT, deflection_offered BOOLEAN. messages.content has GIN FTS index (migration 0020). messages.text has trigram GIN index (migration 0023).
- `orders` — vip_flag boolean, controls vip_orders_always_escalate gate. Indexes: (event_id, customer_email), trigram GIN on customer_name (migration 0023).
- `escalations` — escalation queue per conversation. Silent insert failure is a known risk — check insert error explicitly.
- `audit_log` — append-only, admin client only
- `usage_events` — per-call API cost tracking
- `whatsapp_session_state` — phone PK, pending_event_selection JSONB, **original_message TEXT (migration 0029 — preserves the customer's actual question across a multi-event selection round-trip)**, expires_at. **RLS enabled with no policies (migration 0030); all writes via `createAdminClient()` only. Expired rows purged by the expire-pending cron.**
- `whatsapp_processed_messages` — inbound wamid dedup (migration 0030). Insert-first via `markMessageProcessed()` (`src/lib/whatsapp/message-dedup.ts`); a `23505` unique-violation on the `wamid` PRIMARY KEY = duplicate webhook redelivery → dropped. RLS enabled, no policies (admin-client only). Rows purged by the expire-pending cron.
- `payment_recovery_attempts` — failed payment recovery tracking, status lifecycle, 22% fee column (migration 0026)
- `crm_campaigns` + `crm_campaign_recipients` — re-marketing campaigns with conversion tracking (migration 0027)
- `gate_scans` — QR scan history, duplicate detection via admitted-unique index on (event_id, scanned_code) WHERE admitted (migration 0028)
- `operators.whatsapp_business_phone_number_id` — **must be unique across all operators in practice; not DB-enforced.** Verify uniqueness manually after any direct SQL write (see Known Issues above).
- `current_user_operator_ids()` — RLS helper, use in new migration policies. **Existence of a SELECT policy using this helper does NOT imply an UPDATE/INSERT policy exists — check explicitly.**
- **Reserved migration numbers — do NOT reuse:** `0031` (`whatsapp_opt_outs` — durable cross-flow opt-out) and `0032` (recovery webhook attribution) are designed but **not applied**. The highest applied migration is `0030`. A new migration must start at `0033`.

## Key file locations

- Anthropic client: `src/lib/agent/anthropic-client.ts`
- Supabase server: `src/lib/supabase/server.ts`
- Supabase admin: `src/lib/supabase/admin.ts`
- WhatsApp inbound webhook (has the full diagnostic logging pattern): `src/app/api/whatsapp/inbound/route.ts`
- WhatsApp adapter / Meta API calls: `src/lib/whatsapp/meta-adapter.ts`
- WhatsApp adapter factory: `src/lib/whatsapp/adapter-factory.ts`
- WhatsApp event routing logic: `src/lib/agent/whatsapp-router.ts`
- WhatsApp session state (original_message persistence): `src/lib/agent/whatsapp-session-state.ts`
- WhatsApp inbound pre-router (STOP/opt-out keywords EN+AR, recovery/CRM context routing — runs as **Step 1.5** in the inbound route, before any AI call): `src/lib/whatsapp/inbound-pre-router.ts`
- WhatsApp inbound wamid dedup helper (`markMessageProcessed`, insert-first on `whatsapp_processed_messages`): `src/lib/whatsapp/message-dedup.ts`
- Schemas: `src/lib/schemas.ts`
- Agent types: `src/lib/agent/types.ts`
- Data entry normaliser: `src/lib/data-entry/normaliser.ts`
- Pending changes: `src/lib/data-entry/pending-changes.ts`
- Conversation metrics: `src/lib/agent/conversation-metrics.ts`
- Event readiness: `src/lib/agent/event-readiness.ts`
- Escalation notifier: `src/lib/agent/escalation-notifier.ts`
- KB converters: `src/lib/kb/converters.ts`
- Usage tracking: `src/lib/billing/track-usage.ts`
- Email send: `src/lib/email/send.ts`
- Demo seed: `src/lib/demo/seed-demo-event.ts`
- Revenue leak audit: `src/lib/reports/revenue-leak-audit.ts`
- Payment recovery: `src/lib/recovery/payment-recovery.ts`
- CRM campaigns: `src/lib/crm/campaigns.ts`
- Gate scan validator: `src/lib/gate/scan-validator.ts`
- WhatsApp settings save action (RLS lesson lives here): `src/app/admin/settings/actions.ts`

## Patterns to follow

- Auth in route handlers: copy `src/app/api/kb/upload/route.ts`
- Ownership check before mutation: copy `src/app/api/changes/[pendingChangeId]/confirm/route.ts`
- Admin-client write after membership check (the RLS-safe pattern): copy `src/app/admin/settings/actions.ts`
- Cron route: copy `src/app/api/cron/expire-pending/route.ts`
- Client component with CSV upload: copy `src/app/admin/events/[eventId]/recovery/_components/recovery-uploader.tsx`
- Diagnostic logging at every branch in a multi-step async flow: copy the structure in `src/app/api/whatsapp/inbound/route.ts`
- Nav items: `src/app/admin/_components/sidebar.tsx` — EVENT_SUB_NAV and SETTINGS_SUB_NAV arrays

## What still needs external credentials

- DatoCMS: DATOCMS_API_TOKEN + DATOCMS_EVENT_MODEL_ID
- NOFOMO backend: pending Slack message to tech lead (DO NOT SEND — manager conversation must happen first, see project_status_updated.md)
- WhatsApp: META_PERMANENT_TOKEN expires unpredictably in sandbox — run the full operational checklist above every session. Meta Business Verification removes this entirely and is the single highest-leverage unblock remaining.
- CRON_SECRET: set in Vercel
- RESEND_API_KEY: set in Vercel for weekly digest
- NEXT_PUBLIC_SITE_URL: set in Vercel

## Rules for all future Claude Code sessions

- Read this file first, especially the Known Issues section before touching WhatsApp or agent code
- Read existing files before writing new ones
- No new packages without asking (jsQR was approved for gate scanner)
- No any types
- pnpm not npm
- Before any new write to a table, check the table's actual migration file for which RLS policies exist — do not assume UPDATE/INSERT works because SELECT does
- Run `pnpm build` before pushing
- Deploy via `git push origin main` (Vercel auto-deploy); use the dashboard Redeploy button for env-var-only changes. The Vercel CLI fails with TLS errors on this network and is not a documented path
- Apply migrations via SQL editor if CLI times out, then `supabase migration repair --status applied <version>`
- Add diagnostic console.log at every decision branch in any new multi-step async flow (webhook handlers, multi-turn conversation logic)
- **Documentation gate:** any session that (a) creates or applies a migration, (b) changes deploy or env-var process, or (c) discovers a durable bug pattern must update the corresponding CLAUDE.md section in the same session, before the completion gate. A session is not done while CLAUDE.md contradicts the repo.
