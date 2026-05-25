# Project Status — AI Event Ops

> Snapshot as of 25 May 2026. Update this file whenever a major milestone ships or scope changes.

---

## One-paragraph summary

v1 is complete and live. All 10 issues shipped, passing, and deployed at [tazkar.co](https://tazkar.co) on Vercel Hobby (GitHub repo: `openclaw-dev/event-ops-v1`, Supabase project: `event-ops-dev`). Magic-link auth is working. The product is demo-ready for operator conversations. Next phase is operator outreach and closing the first paid pilot (target: USD 2–5K for a one-event engagement).

---

## Phase: Operator Outreach

Green light to build = 5 concrete pilot conversations + 1 operator who will pay USD 2-5K for a one-event pilot.

Until green light: no incorporation, no hires beyond a contract engineer, no public branding, no fundraising.

v1 is built. The focus now shifts from engineering to sales: build the target operator list, have the manager conversation at MDLBEAST, and start outreach.

---

## v1 scope (complete)

**Shipped in v1.**
- WhatsApp-first AI event support agent (simulator live; Meta API when verification clears)
- Event-specific KB (markdown + JSON ingestion, cited responses)
- Refund deflection state machine with hard guardrails
- Human escalation queue
- Basic internal reporting (post-event PDF)
- Operator admin shell (auth, event setup, KB upload, CSV order import)
- Conversations and Escalations management tabs
- Agent simulator (multi-turn, bilingual EN/AR)

**Not in v1 (future phases).**
- Payment recovery (v1.1)
- Live dashboard (v1.2)
- Real ticketing platform integrations (v2, only after one operator commits)
- Email, Instagram, SMS, voice channels
- Multi-tenant billing, RBAC beyond owner
- CRM, sponsor ops, multi-event analytics

**Architecture (confirmed as built):**
- Next.js 14 App Router, TypeScript strict
- Supabase Postgres with full RLS (`event-ops-dev`, `cardapi` org)
- Claude Sonnet 4.6 (generator, temp 0.3) + Haiku 4.5 (classifier, temp 0.2), direct Anthropic SDK
- Tailwind CSS + shadcn/ui
- Vercel (frontend + API routes) — no separate backend needed
- No vector DB, no LangChain, no microservices

---

## Issues shipped (v1 — all passing)

| # | Issue | Status |
|---|---|---|
| 2 | Auth — magic-link login, session middleware, `/auth/callback` | ✅ Shipped |
| 3 | Database schema — events, orders, conversations, messages, escalations, KB tables | ✅ Shipped |
| 4 | Order import — CSV upload, validation, batched upsert | ✅ Shipped |
| 5 | KB upload — Markdown/JSON parser, section upsert | ✅ Shipped |
| 6 | Agent classifier — Haiku intent + language detection | ✅ Shipped |
| 7 | Agent state machine — greeting → FAQ → order lookup → refund deflection → escalation | ✅ Shipped |
| 8 | Agent runtime — full conversation loop wired to DB and Anthropic SDK | ✅ Shipped |
| 9 | Post-event PDF report — operator summary generated server-side | ✅ Shipped |
| 10 | Admin UI — Conversations, Escalations, Simulator, Orders, KB management | ✅ Shipped |

---

## Deployment

| Item | Value |
|---|---|
| Live URL | `https://tazkar.co` |
| Vercel project | `event-ops-v1` (Hobby plan) |
| GitHub repo | `openclaw-dev/event-ops-v1` (branch: `main`) |
| Supabase project | `event-ops-dev` (org: `cardapi`) |

### Known issue — Vercel Hobby blocks co-authored commits
Vercel Hobby rejects pushes containing `Co-Authored-By: Claude` in commit messages.
**Workaround:** squash all commits into one before pushing to `main`, stripping the co-author line.
```bash
git rebase -i HEAD~<n>   # squash, amend message to remove Co-Authored-By
git push origin main
```
Fix: upgrade to Vercel Pro when the first pilot revenue lands.

---

## What is pending (in priority order)

1. **Operator outreach.** Demo-led, not cold discovery. Target: 30 non-MDLBEAST GCC operators ranked by buyer likelihood. Goal is 5 pilot conversations and 1 paying pilot at USD 2–5K.
2. **Manager conversation at MDLBEAST.** Required before external outreach. Pre-empts conflict-of-interest risk and ideally positions NOFOMO as a future customer.
3. **Outreach copy.** Bilingual EN+AR cold variants. Not drafted yet.
4. **Pricing strategy for first three pilots.** USD 2–5K band confirmed; specific anchoring and recurring structure not yet defined.
5. **Competitive landscape teardown.** Light version needed before operator calls.
6. **Meta Business verification.** Not started; 5–15 business day lead time. Defer until pilot is 3 weeks out. Requires a clean entity (not MDLBEAST, not personal).
7. **Contractor hiring.** Job description ready in `contractor_brief.md`. Sourcing not started. Only needed if pilot workload demands it.

---

## Boundaries (non-negotiable until otherwise stated)

- No use of MDLBEAST data, customer lists, internal documents. Public materials are acceptable as reference.
- No company incorporation, no public branding, no fundraising conversations until green light.
- NOFOMO is a potential future customer, never a competitor. Demo materials use generic synthetic event names.
- Demo dataset uses synthetic identities only. No real customer PII.

---

## Founder context

- Saulet, 36, Kazakhstan citizen, Dubai Golden Visa
- Product Owner at MDLBEAST, 4-year tenure, fully remote
- M.Sc. at Shanghai Jiao Tong University, completing June 2026
- USD 200–500K capital available for venture
- Languages: English fluent, Russian and Kazakh native, beginner Arabic and French
- Time horizon: 24 months to material outcome

---

## Project files inventory

| File | Purpose |
|---|---|
| `admin_shell_spec.md` | Full spec, source of truth for v1 build |
| `contractor_brief.md` | Hiring brief, take-home, sourcing plan |
| `refund_deflection.ts` | Reference state machine implementation |
| `kb_coastline_festival.json` | Festival demo KB |
| `kb_nightline_club.json` | Club demo KB |
| `test_messages.json` | 50 adversarial test cases |
| `post_event_report_template.html` | PDF report template |
| `seed_demo.sql` | Postgres seed migration |
| `project_status.md` | This file |

The live codebase is at `openclaw-dev/event-ops-v1` on GitHub. `CLAUDE.md` in the repo root contains deployment specifics and architecture conventions for engineering sessions.

---

## How a new chat should start

1. Read the project system prompt for thesis and constraints.
2. Read this file for current state.
3. Read `CLAUDE.md` in the repo root for engineering conventions and deployment details.
4. Read other project files only as needed — do not read all of them.
5. Direct, peer-tone, no padding. Push back on scope creep. v1 is done; new work is either outreach support or a scoped v1.1 item.

---

*Last updated: 25 May 2026*
