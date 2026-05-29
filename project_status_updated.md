# Project Status — AI Event Ops (tazkar.co)

> Snapshot as of 29 May 2026. Update after major milestones.

---

## One-paragraph summary

Pre-pilot, pre-company. Building a unified AI event operations layer for GCC live event operators. Two surfaces, one product: a data entry agent (mastersheet automation + WhatsApp change management) and a customer support agent (WhatsApp-first, refund deflection, escalation). Both share one Supabase database — changes confirmed by the data entry agent propagate instantly to the support agent's KB. v1 through v1.7 are all shipped and live at tazkar.co. The product is feature-complete for a pilot. Priority is now operator conversations and the first paying customer.

---

## Phase: Validation

Green light = 5 concrete pilot conversations + 1 operator paying USD 2-5K for a one-event pilot.

Until green light: no incorporation, no hires beyond contract engineer, no public branding, no fundraising.

---

## What is live at tazkar.co

### Support agent
- WhatsApp customer support via inbound webhook
- Event routing — auto-routes to single active event, prompts selection for multiple
- Two-tier KB — operator KB (cross-event) + event KB (specific overrides)
- Multi-language KB — language-aware section retrieval (EN/AR/RU/all)
- Agent state machine — FAQ → order lookup → refund deflection → escalation
- Order lookup by name, phone, email (not just order ID)
- Greeting personalisation using customer name from order
- Days-until-event context — agent calibrates urgency based on proximity to event
- Confidence threshold — low-confidence responses auto-escalate
- Source citations — KB section cited per response
- Human reply from dashboard — operator replies to escalated WhatsApp conversations
- Escalation notification — WhatsApp alert to ops contacts on escalation

### Data entry agent
- Mastersheet upload with Haiku field mapping inference
- Format fingerprint cache — Haiku skipped on cache hit, ~50ms vs ~800ms
- Excel and Word KB upload — xlsx/docx converted via mammoth + Haiku normalisation
- WhatsApp change management — promoter sends free text, system extracts diff, confirms, propagates
- DatoCMS connector — graceful skip when credentials absent

### Operator dashboard
- Conversations tab — full-text search, intent filter, date range, CSV export
- Conversation metrics bar — total, resolved by AI, escalated, refunds deflected, SAR saved
- Escalations tab with human reply form
- KB gap report — coverage score, top escalated intents, Add to KB shortcuts
- Sync tab — Upload, Pending Confirmations, Change History with promoter display names
- Promoters tab — phone whitelist management
- Usage & Billing — per-call cost tracking by event and model
- Weekly digest email — Monday summary (Resend or SendGrid)
- Event readiness checklist — 9 items, blocks publish if required items missing
- Publish/End event controls with status badges
- Demo mode — one-click Coastline Festival 2026 with full seed data
- Mastersheet on create — two-path New Event (form or mastersheet upload)
- WhatsApp Settings — phone number ID, test connection button
- Operator KB — cross-event knowledge base under Settings

---

## Architecture

```
Customer WhatsApp → inbound webhook → event routing → agent state machine
                                                    ↓
Promoter WhatsApp → inbound webhook → change extraction → diff → confirm → events table
                                                                          ↓
Mastersheet upload → Haiku field mapping → confirm → events table → KB propagation
                                                                   ↓
                                                            Support agent reads KB in real time
                                                                   ↓
                                              Operator dashboard: metrics · audit · escalations
```

---

## Migrations applied (0001–0022)

| Migration | What it adds |
|---|---|
| 0001-0012 | v1 core schema |
| 0013 | change_events, mastersheet_mappings |
| 0014 | promoters, pending_changes, WhatsApp columns on operators |
| 0015 | operator_kb_sections |
| 0016 | format_fingerprint + operator_id on mastersheet_mappings |
| 0017 | channel, customer_phone, wa_message_id, operator_id on conversations |
| 0018 | language column on kb_sections and operator_kb_sections |
| 0019 | is_demo column on events |
| 0020 | GIN index on messages.content for full-text search |
| 0021 | source_section column on messages |
| 0022 | usage_events table |

---

## Positioning

**Not:** "AI customer support chatbot" or "data entry automation tool"

**Yes:** "AI event operations layer — eliminates content ops cost, keeps customer information accurate in real time, deflects refunds"

**CFO pitch:** "We save SAR X in content ops headcount, SAR Y in refunds, and eliminate the class of support failures caused by stale event information."

**Demo script (8 minutes):**
1. New Event → "Create demo event" → Coastline Festival 2026 spins up in 30 seconds with KB, orders, conversations
2. Simulator → "what time do doors open?" → agent answers from KB with citation
3. Upload mastersheet → 8 fields mapped in 4 seconds → confirm → Change History records it
4. Send WhatsApp from phone → "doors now 10pm and age is 21" → diff shown → tap Confirm → "Done. 2 changes applied"
5. Conversations tab → metrics bar → refunds deflected → SAR saved estimate

---

## What still needs external credentials

| Credential | Status |
|---|---|
| DATOCMS_API_TOKEN + DATOCMS_EVENT_MODEL_ID | Pending Slack message to CMS owner |
| NOFOMO backend API | Pending Slack message to tech lead |
| META_PERMANENT_TOKEN | Regenerate every 24h in sandbox; permanent token requires Meta Business Verification |
| CRON_SECRET | Set in Vercel |
| RESEND_API_KEY | Set in Vercel for weekly digest |

---

## Pending actions — critical path

| Action | Status |
|---|---|
| Test customer WhatsApp end to end (publish event → send message → get reply) | Not done |
| Manager conversation (employment contract IP check) | Not done |
| First wave operator outreach (10 messages) | Not done |
| First 3 operator demo calls | Not done |
| First paid pilot signed | Not done |

---

## Off critical path

| Action | When |
|---|---|
| DatoCMS API token | Slack after holidays |
| NOFOMO backend API | Slack after holidays |
| Meta Business Verification | After incorporation, 3 weeks before first pilot that needs production WhatsApp |
| Entity decision (IFZA vs ADGM) | After green light |
| RESEND_API_KEY for weekly digest | Set in Vercel this week |

---

## Green light criteria

- [x] Product live and demoable at tazkar.co
- [x] Full demo loop implemented (mastersheet → WhatsApp change → audit log)
- [x] One-click demo event creation
- [x] Customer WhatsApp support agent built
- [ ] Customer WhatsApp flow tested end to end
- [ ] 5+ operator demos delivered
- [ ] 1 paying pilot signed (USD 2-5K)
- [ ] Manager conversation done

---

## Open questions

| Question | Status |
|---|---|
| MDLBEAST employment contract IP terms | Not reviewed |
| Incorporation: DIFC, ADGM, IFZA, Saudi, Delaware, AIFC | Deferred until green light |
| Bootstrap to USD 1-2M ARR vs pre-seed raise | Deferred until green light |
| Target list of 30 GCC operators ranked by buyer likelihood | Pending |
| Wedge: support + recovery (broader) vs pure payment recovery (sharper) | Open |

---

## Boundaries

- No MDLBEAST data, customer lists, internal documents
- No incorporation, branding, fundraising until green light
- NOFOMO is future customer, never competitor
- Demo data is synthetic only

---

## Founder

Saulet Mukhamadiyev, 36, Kazakhstan citizen, Dubai Golden Visa, Product Owner at MDLBEAST (4yr, remote), M.Sc. SJTU completing June 2026, USD 200-500K capital available, English/Russian/Kazakh fluent.

---

## How a new chat should start

1. Read the project system prompt for thesis and constraints
2. Read this file for current state
3. Read CLAUDE.md for technical conventions
4. Read relevant project files individually — not all at once
5. Priority is operator demos and selling, not building
6. Both surfaces are live at tazkar.co — do not treat them as separate products
7. Deploy via `vercel deploy --prod` not git push

---

*Last updated: 29 May 2026*
