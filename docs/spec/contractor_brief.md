# Founding Engineer, Contract — Hiring Brief

> Internal document for sourcing and screening.
> Two versions below: long-form job description and short-form social post.

---

## Version A — Long-form job description

**Founding Engineer (Contract, 4 to 6 weeks)**

We are building an AI customer support and revenue recovery layer for live event operators in the GCC. WhatsApp-first, Arabic and English native. We are pre-pilot and pre-company. Founder has 4 years as Product Owner at a major regional events group, with defined v1 scope, working capital, and substantial groundwork already completed.

You will build v1 end to end with the founder as PM. You will not be designing the architecture or scope from scratch.

**Why this role is unusual.**

Most "pre-pilot AI startup" gigs hand you a vague Notion doc and ask you to scope it. This one has already done that work:

  - A 900-line technical spec covering schema, RLS policies, types, routes, forms, validation, and acceptance criteria
  - A 658-line TypeScript reference implementation of the refund deflection state machine, including hard guardrails and the Claude classifier/generator contracts
  - Two complete bilingual demo-event knowledge bases, 133 Q&A entries total, EN and AR
  - Two synthetic order CSVs sized to mirror real ticketing platform exports
  - 50 adversarial test messages mapped to expected intents and escalation behaviors
  - A four-page post-event PDF report template populated with calibrated sample numbers
  - Standalone terms-of-service and privacy notice documents for KB ingestion testing

You arrive on day one with the spec, the dataset, and a working state machine to extend. Your job is to ship.

**v1 scope.**

A WhatsApp-first AI event support agent with:
  - Operator admin shell: auth, event setup, KB upload and parse, CSV order import
  - Agent runtime: Claude Haiku for classification, Claude Sonnet for cited generation
  - Refund deflection state machine: extension of the reference implementation
  - Human escalation queue
  - Post-event PDF report generation
  - Simulator-first development, Meta Cloud API integration when verification clears

Out of scope for v1: payment recovery (v1.1), real ticketing platform integrations (v2), Instagram/SMS channels, voice, multi-tenant billing, mobile app.

**Stack.**

  - Next.js 14 App Router, TypeScript strict mode
  - Python + FastAPI for backend agent runtime (open to Next.js API routes if you are stronger there)
  - Supabase (Postgres, Auth, Storage)
  - Anthropic Claude direct SDK (Sonnet 4.6, Haiku 4.5)
  - Langfuse for LLM tracing
  - Sentry for errors
  - Fly.io Bahrain region for backend, Vercel for frontend
  - 360dialog or Meta Cloud API direct for WhatsApp

No frameworks beyond this stack without approval. No vector DB, no LangChain, no microservices.

**Skills required.**

  - Production experience shipping a Next.js or FastAPI app solo or near-solo
  - Postgres data modeling, including RLS or equivalent multi-tenant patterns
  - Direct LLM API integration (Anthropic preferred, OpenAI acceptable)
  - Comfort with spec-driven async work and weekly sync cadence

**Nice to have.**

  - WhatsApp Business API or BSP experience
  - Arabic literacy (reading is enough)
  - Prior AI agent or production chatbot work
  - Live entertainment, ticketing, or hospitality tech background

**Time and rate.**

60 to 100 hours over 4 to 6 calendar weeks. Daily 15-min async standup on Slack or Telegram. One 45-min weekly sync. Founder is in GMT+4, you can be anywhere with at least 3 hours daily overlap.

USD 80 to 120 per hour depending on seniority. Estimated total USD 8K to 15K. Two milestones:
  - 50% at week 2 demoable agent on simulator
  - 50% at week 4 to 6 v1 delivery

Optional equity conversation if there is a strong fit and mutual interest in continuation. The role is structured as contract first.

**Process.**

  1. 30-minute intro call (free)
  2. Paid take-home: extend the refund deflection state machine, ~2-3 hours, USD 200 paid on submission regardless of outcome
  3. Reference checks
  4. Decision within 5 business days

**To apply.**

Email [redacted] with:
  - One link to a production thing you shipped solo or near-solo
  - Brief note on LLM API experience (which provider, what you built)
  - Available start date
  - Hourly rate within the band

---

## Version B — Short-form social post

For X, LinkedIn, Read.cv, referral DMs. Pick the variant that matches the channel.

**X post (under 280 chars):**

> Hiring: founding engineer, contract, 4–6 wk, USD 8–15K.
>
> AI customer support layer for GCC live event operators. Next.js + Python + Supabase + Claude.
>
> Spec, dataset, state machine reference all done. You ship the v1.
>
> Reply or DM.

**Read.cv / Wellfound listing:**

> **Founding Engineer (Contract, 4–6 weeks)**
>
> Pre-pilot AI startup building a WhatsApp-first customer support and revenue recovery layer for GCC live event operators. Arabic + English native.
>
> What's different: founder has already shipped the 900-line spec, the bilingual KB dataset, the refund deflection state machine reference, and the post-event report template. You arrive on day one with a clear build target, not a brief to interpret.
>
> Stack: Next.js 14, Python + FastAPI, Supabase, Claude direct SDK, Fly.io. WhatsApp via Meta Cloud API or 360dialog.
>
> 60–100 hours over 4–6 weeks. USD 80–120/hr. Paid take-home. Founder in GMT+4.
>
> Apply with one production project link and a note on LLM API experience.

**Referral DM (warm intro from your network):**

> Hey [name], hope you're well. Quick ask — I'm hiring a founding engineer on contract for a 4–6 week build. AI customer support tool for GCC live events, WhatsApp-first, EN+AR. Pre-pilot, but the spec and most of the supporting work is already done so this is a "ship the v1" role, not a "scope it from scratch" role.
>
> Stack is Next.js + Python + Supabase + Claude SDK. USD 80–120/hr, ~USD 10K total range. Looking for someone strong who has shipped solo before.
>
> Do you know anyone who fits? Happy to share the full brief.

---

## Sourcing plan

| Channel | Why | Effort | Expected response time |
|---|---|---|---|
| Your network (Hisham, Egem, ex-MDLBEAST engineers, BU alumni) | One referral worth 10 cold posts | Half a day | 3-5 days |
| X / Twitter, public post | Founder-friendly senior contractors cluster here | 15 minutes | 1-2 days |
| Read.cv | Curated solo-dev community, strong design sense bonus | 20 minutes | 3-7 days |
| Wellfound (formerly AngelList Talent) | Standard, lots of noise to filter | 1 hour | 5-10 days, lots of inbound |
| Toptal | Pre-vetted, expensive (USD 100-150/hr), fast | 30 minutes | 2-3 days |
| Eastern European / Pakistani / Egyptian senior devs | Strong technical talent at lower bands, Arabic plus is real | Cold outreach via X / GitHub | 5-7 days |

Recommended order: network first (1 day), X post in parallel (immediate), Read.cv as 24-hour follow-up if network is dry. Skip Wellfound and Toptal in the first 5 days, use only as backup.

---

## Take-home problem

Copy-paste-ready. Send to candidates who pass the intro call.

---

**Take-home: Extend the refund deflection state machine**

Estimated time: 2 to 3 hours. We pay USD 200 on submission regardless of hire outcome.

**Context.** We have a TypeScript reference implementation of a refund deflection state machine for an AI event support agent. It handles the happy path and basic escalation. Your task is to extend it.

**Setup.**
  1. Clone the reference repo (link provided after intro call)
  2. Run `pnpm install && pnpm test`
  3. Existing tests should pass; existing state machine covers START → INTAKE → VERIFY → CLASSIFY_REASON → POLICY_CHECK → OFFER_ALTERNATIVE

**Your task.** Add three things:

  1. **Replace the keyword-based accept/decline detection in `handleOfferResponse`** with a Haiku classification call. The classifier returns one of `{accepted, declined, ambiguous, other_intent}` and the state machine routes accordingly.
  2. **Add a new state `WAIT_FOR_DOCUMENTATION`** that activates when the customer requests a medical refund and is told documentation is needed. The state should wait for a document upload, time out after 48 hours, and escalate with a clear summary.
  3. **Write 5 new test cases** covering: a medical refund happy path with documentation, a medical refund timeout, an ambiguous accept response, a customer who switches intent mid-flow (refund → ticket question), and a customer who provides an order ID for someone else's order.

**Constraints.**
  - Stay within the existing code style and module boundaries
  - Hard guardrails (the deterministic checks at the top of `processMessage`) cannot be moved into prompts
  - No new dependencies without justification
  - Tests must run in under 60 seconds total

**Submission.**
  - Push to a private GitHub repo (we will provide collaborator access for review)
  - Include a `NOTES.md` with: one tradeoff you considered and what you chose, one thing you would do differently with more time, one question you have about the broader system
  - Total submission should be ~150 to 300 lines of production code plus tests

**Evaluation.**
  - 40% code quality and structure
  - 25% correct handling of guardrails and edge cases
  - 20% test design and coverage
  - 15% the NOTES.md responses

We will respond within 5 business days of submission.

---

*Brief version 1.0 — May 2026*
