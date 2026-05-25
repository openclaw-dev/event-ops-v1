# Project Status — AI Event Ops

> Snapshot as of 22 May 2026. Update this file whenever a major milestone ships or scope changes.

---

## One-paragraph summary

Pre-pilot, pre-company. Building an AI customer support and revenue recovery layer for live event operators in the GCC. WhatsApp-first, Arabic and English native. Currently in validation phase (30-60 day window started ~3 weeks ago). Spec, demo dataset, reference state machine, and seed migration are complete. Contractor not yet hired, no operator conversations yet, manager not yet briefed. Next move is target list + manager conversation + contractor sourcing in parallel.

---

## Phase: Validation

Green light to build = 5 concrete pilot conversations + 1 operator who will pay USD 2-5K for a one-event pilot.

Until green light: no incorporation, no hires beyond a contract engineer, no public branding, no fundraising, no technical work beyond a single buildable demo.

Decision was made (with eyes open) to build a working v1 on simulator before operator conversations, on the reasoning that GCC operators convert better seeing a working product than seeing a deck.

---

## v1 scope (spine-first, locked)

**In scope for v1.**
- WhatsApp-first AI event support agent (simulator-first; Meta API when verification clears)
- Event-specific KB (markdown + JSON ingestion, cited responses)
- Refund deflection state machine with hard guardrails
- Human escalation queue
- Basic internal reporting (post-event PDF, not live dashboard)
- Operator admin shell (auth, event setup, KB upload, CSV order import)

**Not in v1.**
- Payment recovery (v1.1)
- Live dashboard (v1.2)
- Real ticketing platform integrations (v2, only after one operator commits)
- Email, Instagram, SMS, voice channels
- Multi-tenant billing, RBAC beyond owner
- CRM, sponsor ops, multi-event analytics

**Architecture (locked):**
- Next.js 14 frontend + FastAPI or Next.js API routes backend (contractor strength decides)
- Supabase Postgres with full RLS
- Claude Sonnet 4.6 for generation, Haiku 4.5 for classification, direct SDK
- Langfuse for LLM tracing, Sentry for errors
- Fly.io Bahrain region for backend, Vercel for frontend
- 360dialog or Meta Cloud API direct for WhatsApp (decision deferred)
- No vector DB, no LangChain, no microservices

---

## What is done

| Asset | File in project | Notes |
|---|---|---|
| Full admin shell spec (DB schema, RLS, types, routes, forms, acceptance criteria) | `admin_shell_spec.md` | 897 lines. Source of truth for contractor day-1 work. Has one schema bug to fix: `operator_users.user_id` should be nullable. |
| Refund deflection state machine reference implementation | `refund_deflection.ts` | 658 lines TypeScript. Includes hard guardrails, classifier prompt, generator prompt, full state machine, example usage. Contractor extends this. |
| Demo KB — Coastline Festival | `kb_coastline_festival.json` | 65 entries, bilingual EN+AR, festival shape, 18+. |
| Demo KB — Nightline Club | `kb_nightline_club.json` | 68 entries, bilingual EN+AR, club shape, 21+. |
| Adversarial test messages | `test_messages.json` | 50 messages across EN/AR/RU/mixed. Maps each to expected intent and escalation behavior. |
| Post-event PDF report template | `post_event_report_template.html` | Four-page editorial PDF. Calibrated for Coastline. Print-to-PDF from browser. |
| Contractor hiring brief + take-home + sourcing plan | `contractor_brief.md` | Job description (long + short variants), paid take-home problem, sourcing channel ranking. |
| Postgres seed migration | `seed_demo.sql` | Idempotent, validated end-to-end. Loads 2 operators, 2 events, 133 KB sections, 39 orders. |

---

## What is pending (in priority order)

1. **Target list of 30 non-MDLBEAST GCC operators ranked by buyer likelihood.** No work done yet. Unblocks operator outreach and pricing strategy.
2. **Manager conversation at MDLBEAST.** Not yet had. Required before any external outreach. Pre-empts the conflict-of-interest risk and ideally locks NOFOMO as future customer.
3. **Contractor hiring.** Job description ready. Sourcing has not started. Estimated 5-day pipeline (post → screen → take-home → decide).
4. **Operator outreach copy.** Demo-led, not cold discovery. Bilingual EN+AR for the cold versions. Not drafted yet.
5. **Pricing strategy for first three pilots.** USD 2-5K band from validation thesis, but specific anchoring and recurring structure not yet defined.
6. **Competitive landscape teardown.** Light version needed before operator calls so "how is this different from Intercom Fin" has a 30-second answer.
7. **Identify one friendly operator to ask the ticketing-platform question.** "What platform do you run on, and would you let me test against an export or sandbox?" Single question, unblocks the eventual v2 adapter decision.
8. **Meta Business verification.** Not started. Has 5 to 15 business day lead time. Defer until pilot is 3 weeks out (simulator suffices until then). Requires a clean entity that is not MDLBEAST or personal.

---

## Boundaries (non-negotiable until otherwise stated)

- No use of MDLBEAST data, customer lists, internal documents. Public materials (terms, FAQ, marketing pages) are acceptable as reference points.
- No company incorporation, no public branding, no fundraising conversations until green light.
- NOFOMO is a potential future customer, never a competitor. Demo materials use generic synthetic event names, not MDLBEAST event names.
- Demo dataset uses synthetic identities only. No real customer PII has been added to the project or processed by any system.

---

## Founder context

- Saulet, 36, Kazakhstan citizen, Dubai Golden Visa
- Product Owner at MDLBEAST, 4-year tenure, fully remote
- M.Sc. at Shanghai Jiao Tong University, completing June 2026
- USD 200-500K capital available for venture
- Languages: English fluent, Russian and Kazakh native, beginner Arabic and French
- Time horizon for venture: 24 months to material outcome

---

## Project files inventory

Everything in this list is uploaded to the project and readable by any chat via the `view` tool.

| File | Purpose |
|---|---|
| `admin_shell_spec.md` | Full spec, source of truth |
| `contractor_brief.md` | Hiring brief, take-home, sourcing plan |
| `refund_deflection.ts` | Reference state machine implementation |
| `kb_coastline_festival.json` | Festival demo KB |
| `kb_nightline_club.json` | Club demo KB |
| `test_messages.json` | 50 adversarial test cases |
| `post_event_report_template.html` | PDF report template |
| `seed_demo.sql` | Postgres seed migration |
| `project_status.md` | This file |

---

## How a new chat should start

If you are a fresh chat reading this:

1. The project system prompt tells you the thesis and constraints. Read it first.
2. Read this file (`project_status.md`) for current state.
3. Read whatever other project files are relevant to the user's specific question (do not read all of them; `view` individually).
4. Default to direct, peer-tone, no padding. Push back when the user expands scope or drifts from validation. Confirm assumptions explicitly when uncertain.
5. Do not re-derive context that is already in these files. Reference them by name and move on.

---

*Last updated: 22 May 2026*
