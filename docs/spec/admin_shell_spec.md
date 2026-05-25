# Admin Shell — Build Spec

> Contractor handoff document for v1 admin shell.
> Covers GitHub issues #2 through #6. Targets day 5 of the 14-day plan.

---

## 1. Scope

Build the operator-facing admin shell. After this work, an operator can: sign in, create an event, configure it, upload a KB document, upload an orders CSV, and see the parsed result. The simulator, agent loop, escalation queue, and reporting are nav targets that render empty stubs. Those are subsequent issues, not this one.

**In scope.** Database schema with RLS, magic-link auth, multi-operator scoping, event CRUD, KB upload + parse + list, orders CSV upload + validate + list, simulator/escalations/conversations/report empty shells in the navigation.

**Out of scope.** Agent loop, classifier, generator, state machine wiring, WhatsApp channel, Meta verification, Langfuse, Sentry, PostHog, payment integration, ticketing platform adapter, post-event PDF generation, multi-tenant billing, role granularity beyond owner.

---

## 2. Stack

| Layer | Pick |
|---|---|
| Framework | Next.js 14 App Router, TypeScript strict mode |
| DB + Auth + Storage | Supabase (Postgres 15, Auth, Storage buckets) |
| UI | shadcn/ui on Tailwind |
| Forms | react-hook-form + zod for validation |
| Tables | @tanstack/react-table |
| File upload | Supabase Storage with signed URLs |
| Hosting | Vercel (frontend), Supabase (DB) |
| Local dev | Supabase CLI for DB migrations and seed |

No state management library (Server Components + URL state). No CSS-in-JS beyond Tailwind. No additional package without explicit approval.

---

## 3. Database Schema

Run as Supabase migrations. All tables have `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` unless otherwise stated. All FKs are `ON DELETE CASCADE` unless specified.

### 3.1 Core tables

```sql
-- Tenant root. One row per operator (Coastline Events FZE, Nightline Hospitality FZE, etc.)
CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_entity_name TEXT,
  country_code CHAR(2) NOT NULL,         -- ISO 3166-1 alpha-2, e.g. 'AE', 'SA'
  default_currency CHAR(3) NOT NULL DEFAULT 'AED',  -- ISO 4217
  default_locale TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users belonging to an operator. user_id maps to auth.users.id (Supabase Auth).
-- A user may belong to multiple operators (uncommon in v1, supported anyway).
CREATE TABLE operator_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'agent')),
  invited_email TEXT,                     -- email used for invitation; null for the founding owner
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, user_id)
);
CREATE INDEX ON operator_users (user_id);
CREATE INDEX ON operator_users (operator_id);

-- Events under an operator.
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,                     -- URL-safe identifier, unique per operator
  event_type TEXT NOT NULL CHECK (event_type IN ('festival', 'club', 'concert', 'conference', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  venue_name TEXT NOT NULL,
  venue_city TEXT NOT NULL,
  capacity INT,
  age_minimum INT NOT NULL CHECK (age_minimum >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed', 'archived')),
  -- The full EventConfig blob. Matches the TypeScript type in refund_deflection.ts.
  -- Stored as JSONB so the agent runtime can read without joins.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, slug)
);
CREATE INDEX ON events (operator_id) WHERE deleted_at IS NULL;
CREATE INDEX ON events (start_date) WHERE deleted_at IS NULL;
CREATE INDEX ON events USING GIN (config);

-- Per-event user scoping. Optional in v1: if no rows for an event, all operator
-- users with role >= 'agent' have access. If rows exist, only listed users access.
CREATE TABLE event_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  operator_user_id UUID NOT NULL REFERENCES operator_users(id),
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, operator_user_id)
);
```

### 3.2 KB and content tables

```sql
-- A KB upload. One row per file the operator uploads.
CREATE TABLE kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('markdown', 'json', 'pdf')),
  storage_path TEXT NOT NULL,             -- Supabase Storage path: events/{event_id}/kb/{filename}
  uploaded_by UUID NOT NULL REFERENCES operator_users(id),
  section_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON kb_documents (event_id);

-- Individual KB sections parsed from a document. The agent reads from this table.
CREATE TABLE kb_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  kb_document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,               -- Human-readable, e.g. 'policy.refund.standard'
  category TEXT,
  intent TEXT,                            -- One of the intent taxonomy values
  escalation_needed BOOLEAN NOT NULL DEFAULT false,
  question_en TEXT,
  answer_en TEXT NOT NULL,
  question_ar TEXT,
  answer_ar TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, section_id)
);
CREATE INDEX ON kb_sections (event_id);
CREATE INDEX ON kb_sections (event_id, intent);
-- Full-text search index for keyword retrieval (no vector DB in v1)
CREATE INDEX kb_sections_fts_en_idx ON kb_sections
  USING GIN (to_tsvector('english', coalesce(question_en, '') || ' ' || answer_en));
CREATE INDEX kb_sections_fts_ar_idx ON kb_sections
  USING GIN (to_tsvector('arabic', coalesce(question_ar, '') || ' ' || coalesce(answer_ar, '')));
```

### 3.3 Orders tables

```sql
-- An orders import batch. One row per CSV upload.
CREATE TABLE order_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES operator_users(id),
  row_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON order_imports (event_id);

-- Individual orders. The agent looks up by phone or order_id.
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  order_import_id UUID REFERENCES order_imports(id),
  order_id TEXT NOT NULL,                 -- External order ID from ticketing platform
  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  preferred_language TEXT DEFAULT 'en',
  ticket_type TEXT,
  quantity INT NOT NULL DEFAULT 1,
  amount_paid NUMERIC(12, 2),
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  purchase_date DATE,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'payment_failed', 'payment_pending', 'refunded')),
  vip_flag BOOLEAN NOT NULL DEFAULT false,
  transfer_eligible BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  raw_row JSONB,                          -- Original CSV row for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, order_id)             -- Re-import overwrites by (event_id, order_id)
);
CREATE INDEX ON orders (event_id);
CREATE INDEX ON orders (event_id, customer_phone_e164);
CREATE INDEX ON orders (event_id, vip_flag) WHERE vip_flag = true;

CREATE TABLE order_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_import_id UUID NOT NULL REFERENCES order_imports(id),
  row_number INT NOT NULL,
  error_message TEXT NOT NULL,
  raw_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON order_import_errors (order_import_id);
```

### 3.4 Stub tables (created now, populated later)

These exist so RLS, foreign keys, and migrations are correct from day one. Issues #7+ wire the application logic.

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  customer_phone_e164 TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'simulator' CHECK (channel IN ('simulator', 'whatsapp', 'email')),
  language TEXT NOT NULL DEFAULT 'en',
  state TEXT NOT NULL DEFAULT 'START',
  matched_order_id UUID REFERENCES orders(id),
  refund_case_id UUID,                    -- FK added below after refund_cases exists
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON conversations (event_id);
CREATE INDEX ON conversations (event_id, state);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'human_operator')),
  text TEXT NOT NULL,
  classified_intent TEXT,
  cited_section_ids TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, created_at);

CREATE TABLE escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  event_id UUID NOT NULL REFERENCES events(id),
  reason TEXT NOT NULL,
  summary_for_ops TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'resolved', 'reopened')),
  claimed_by UUID REFERENCES operator_users(id),
  resolved_by UUID REFERENCES operator_users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON escalations (event_id, status);

CREATE TABLE refund_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  event_id UUID NOT NULL REFERENCES events(id),
  order_id UUID REFERENCES orders(id),
  reason TEXT,
  outcome TEXT CHECK (outcome IN ('resolved_deflected', 'resolved_refund_approved_by_human', 'resolved_other', 'escalated_unresolved', NULL)),
  alternative_offered TEXT,
  alternative_accepted BOOLEAN,
  estimated_value_saved NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON refund_cases (event_id);

ALTER TABLE conversations ADD CONSTRAINT conversations_refund_case_fk
  FOREIGN KEY (refund_case_id) REFERENCES refund_cases(id);

-- Append-only audit log. Every operator action and every agent decision lands here.
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID REFERENCES operators(id),
  event_id UUID REFERENCES events(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (event_id, created_at DESC);
CREATE INDEX ON audit_log (operator_id, created_at DESC);
```

### 3.5 Row-Level Security policies

RLS is enabled on every table. Without policies, no one reads anything.

```sql
-- Helper function: returns operator_ids the current authenticated user belongs to.
CREATE OR REPLACE FUNCTION current_user_operator_ids()
RETURNS SETOF UUID
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT operator_id FROM operator_users WHERE user_id = auth.uid();
$$;

-- Enable RLS on all tables
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_import_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Operators: users see operators they belong to.
CREATE POLICY operators_select ON operators FOR SELECT
  USING (id IN (SELECT current_user_operator_ids()));

-- Operator_users: users see other users in their operators.
CREATE POLICY operator_users_select ON operator_users FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));

-- Events: scoped by operator_id.
CREATE POLICY events_all ON events FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));

-- Event_users: scoped by event's operator.
CREATE POLICY event_users_all ON event_users FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

-- KB documents: scoped via event_id.
CREATE POLICY kb_documents_all ON kb_documents FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

-- KB sections: same scoping pattern. Apply identical policies to:
--   kb_sections, order_imports, orders, order_import_errors,
--   conversations, messages (via conversations.event_id),
--   escalations, refund_cases, audit_log
-- Pattern below repeats for each.

CREATE POLICY kb_sections_all ON kb_sections FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY order_imports_all ON order_imports FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY orders_all ON orders FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY order_import_errors_all ON order_import_errors FOR ALL
  USING (order_import_id IN (SELECT id FROM order_imports WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))))
  WITH CHECK (order_import_id IN (SELECT id FROM order_imports WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))));

CREATE POLICY conversations_all ON conversations FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY messages_all ON messages FOR ALL
  USING (conversation_id IN (SELECT id FROM conversations WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))))
  WITH CHECK (conversation_id IN (SELECT id FROM conversations WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))));

CREATE POLICY escalations_all ON escalations FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY refund_cases_all ON refund_cases FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

-- Audit log: read-only via RLS, writes via service role only.
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));
```

### 3.6 Seed data

Migration `0099_seed_demo.sql` runs in dev only (not production). Inserts:

  - Demo operator: "Coastline Events FZE" (id stable for testing)
  - Demo event: "Coastline Festival 2026" with config populated from `kb_coastline_festival.json`
  - 19 orders from `orders_coastline_festival.csv`
  - 65 KB sections from `kb_coastline_festival.json`
  - Second demo event: "Nightline Club" with 68 sections and 20 orders

Provide a script `pnpm seed:demo` that wipes and reseeds in dev only. Production migrations stop at `0098_`.

---

## 4. TypeScript types

Create `lib/types.ts`. Types must match the DB schema and the `EventConfig` type in `refund_deflection.ts`.

```ts
export type EventStatus = 'draft' | 'live' | 'closed' | 'archived';
export type EventType = 'festival' | 'club' | 'concert' | 'conference' | 'other';
export type OrderStatus = 'completed' | 'payment_failed' | 'payment_pending' | 'refunded';
export type EscalationStatus = 'open' | 'claimed' | 'resolved' | 'reopened';
export type RefundShape = 'strict' | 'tiered' | 'lenient';

export interface RefundTier {
  days_before_event: number;
  refund_pct: number;
}

export interface RefundPolicy {
  shape: RefundShape;
  tiers: RefundTier[];
  allowed_alternatives_after_window: string[];
  credit_validity_months: number;
  medical_exception_section_id: string;
  hard_no_language?: { en: string; ar: string };
}

// Mirrors EventConfig in refund_deflection.ts. Stored as events.config JSONB.
export interface EventConfig {
  event_id: string;
  event_name: string;
  event_date_iso: string;
  refund_policy: RefundPolicy;
  escalation_keywords: string[];
  vip_orders_always_escalate: boolean;
  dress_code: string;
  age_minimum: number;
  doors_open_local: string;        // 'HH:mm'
  doors_close_local: string;
  last_entry_local: string;
  parking_info: string;
  escalation_contacts: { name: string; hours: string; method: string }[];
  ticket_tiers: { name: string; price?: number; description?: string }[];
}

export interface Operator { id: string; name: string; country_code: string; default_currency: string; }
export interface Event {
  id: string; operator_id: string; name: string; slug: string;
  event_type: EventType; start_date: string; end_date: string;
  timezone: string; venue_name: string; venue_city: string;
  capacity: number | null; age_minimum: number;
  status: EventStatus; config: EventConfig;
}
export interface KBSection {
  id: string; event_id: string; section_id: string;
  category: string | null; intent: string | null;
  escalation_needed: boolean;
  question_en: string | null; answer_en: string;
  question_ar: string | null; answer_ar: string | null;
}
export interface Order {
  id: string; event_id: string; order_id: string;
  customer_phone_e164: string; customer_name: string | null;
  ticket_type: string | null; quantity: number;
  amount_paid: number | null; currency: string;
  status: OrderStatus; vip_flag: boolean; transfer_eligible: boolean;
}
```

---

## 5. Routes and pages

App Router structure under `app/`.

```
app/
├── (marketing)/                    public landing, deferred
├── login/page.tsx                  magic-link login
├── auth/callback/route.ts          Supabase Auth callback
├── admin/
│   ├── layout.tsx                  auth guard, operator switcher, sidebar nav
│   ├── page.tsx                    /admin — redirect to first event or onboarding
│   ├── onboarding/page.tsx         first-time setup (create operator, create first event)
│   ├── events/
│   │   ├── page.tsx                events list
│   │   ├── new/page.tsx            create event form
│   │   └── [eventId]/
│   │       ├── layout.tsx          event nav (tabs)
│   │       ├── page.tsx            event overview / dashboard
│   │       ├── setup/page.tsx      event config form
│   │       ├── kb/page.tsx         KB upload + listing
│   │       ├── kb/[sectionId]/page.tsx   section detail (read-only in v1)
│   │       ├── orders/page.tsx     orders import + listing
│   │       ├── simulator/page.tsx  EMPTY stub
│   │       ├── conversations/page.tsx  EMPTY stub
│   │       ├── escalations/page.tsx    EMPTY stub
│   │       └── report/page.tsx     EMPTY stub
│   └── settings/page.tsx           operator settings (deferred to issue #15)
└── api/
    ├── kb/upload/route.ts          POST handler for KB upload + parse
    └── orders/import/route.ts      POST handler for CSV import + validation
```

### Wireframes

**Sidebar (persistent on admin):**

```
┌───────────────────────────┐
│  Coastline Events ▾       │  ← operator switcher
├───────────────────────────┤
│  Events                   │
│  ├ Coastline Festival '26 │  ← active
│  │   ├ Setup              │
│  │   ├ Knowledge Base     │
│  │   ├ Orders             │
│  │   ├ Simulator    [WIP] │
│  │   ├ Conversations[WIP] │
│  │   ├ Escalations  [WIP] │
│  │   └ Report       [WIP] │
│  └ Nightline Club          │
│                           │
│  + New Event              │
├───────────────────────────┤
│  Settings                 │
│  Sign out                 │
└───────────────────────────┘
```

**Event setup form:**

```
┌──── Event Setup ──────────────────────────────────────────────────┐
│                                                                    │
│  ▢ Basic Information                                               │
│    Name        [Coastline Festival 2026                        ]   │
│    Slug        [coastline-festival-2026]  (auto-from name)         │
│    Type        ( ) Festival  ( ) Club  ( ) Concert  ...            │
│    Start       [2026-07-17]   End [2026-07-18]                     │
│    Timezone    [Asia/Dubai ▾]                                      │
│    Venue       [Designated festival grounds, Coastal City      ]   │
│    Capacity    [10000]                                             │
│    Age min     [18]                                                │
│                                                                    │
│  ▢ Refund Policy                                                   │
│    Shape       ( ) Strict   (●) Tiered   ( ) Lenient               │
│    Tiers       30 days before: 100% refund  [- +]                  │
│                14 days before: 50% refund   [- +]                  │
│                 0 days before:  0% refund   [- +]                  │
│    Alternatives [✓] Transfer  [✓] Credit  [ ] Upgrade  [ ] Date    │
│    Credit valid [12] months                                        │
│                                                                    │
│  ▢ Logistics                                                       │
│    Doors open  [20:00]    Doors close [02:00]                      │
│    Last entry  [02:00]                                             │
│    Dress code  [Smart casual. Local customs apply.             ]   │
│    Parking     [Free at venue. Gate opens 16:00 ...            ]   │
│                                                                    │
│  ▢ Escalation                                                      │
│    VIP orders auto-escalate?  (●) Yes  ( ) No                      │
│    Keywords (comma-separated): [police, media, lawyer          ]   │
│    Escalation contacts:                                            │
│      [Ops Manager  | 12:00-02:00 GST | in-app handoff] [×]         │
│      [+ Add contact]                                               │
│                                                                    │
│  ▢ Ticket Tiers                                                    │
│      [GA - Day 1   | 200 AED | General entry             ] [×]     │
│      [GA - Day 2   | 200 AED | General entry             ] [×]     │
│      [GA - 2-Day   | 350 AED | Both nights               ] [×]     │
│      [Backstage    | 1200 AED| Backstage + GA            ] [×]     │
│      [+ Add tier]                                                  │
│                                                                    │
│                                       [ Cancel ]  [ Save Event ]   │
└────────────────────────────────────────────────────────────────────┘
```

**KB upload page:**

```
┌──── Knowledge Base ───────────────────────────────────────────────┐
│                                                                    │
│  Upload a KB document                                              │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Drop .md, .json, or .pdf here, or click to browse         │    │
│  │  Max 5 MB                                                  │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ─── Uploaded documents ───────────────────────────────────────    │
│   kb_coastline_festival.md     65 sections   uploaded 12:43 PM     │
│   coastline_terms.md           18 sections   uploaded 12:45 PM     │
│                                                                    │
│  ─── Sections ── 83 total ─────────────────────────────────────    │
│   [filter: category ▾] [filter: intent ▾] [search: ____________]   │
│                                                                    │
│   section_id                category         intent      esc?      │
│   policy.refund.standard    Ticketing        refund      ✓         │
│   policy.refund.medical     Ticketing        refund      ✓         │
│   policy.dress_code         Admission        dress_code  ·         │
│   event.gate_times          Event & Venue    event_time  ·         │
│   ... (paginated, 25 per page)                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Orders import page:**

```
┌──── Orders ───────────────────────────────────────────────────────┐
│                                                                    │
│  Import orders CSV                                                 │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Drop CSV here. Required columns shown below.              │    │
│  │  [Download template CSV]                                   │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                    │
│  Required: order_id, customer_phone_e164, customer_name,           │
│            ticket_type, quantity, amount_paid_aed, status,         │
│            vip_flag                                                │
│  Optional: customer_email, preferred_language, purchase_date,      │
│            transfer_eligible, notes                                │
│                                                                    │
│  ─── Recent imports ───────────────────────────────────────────    │
│   orders_coastline_festival.csv   19 ok, 0 errors   May 22 13:01   │
│                                                                    │
│  ─── Orders ── 19 total ──────────────────────────────────────     │
│   [filter: status ▾] [filter: vip ▾] [search: ____________]        │
│                                                                    │
│   order_id     phone          name             tier    status      │
│   ORD-001001   +9715XXXXXXXX  Alex Morgan      GA-2D   completed   │
│   ORD-001009   +9715XXXXXXXX  Casey Brennan    Back.   completed★  │
│   ORD-001014   +9715XXXXXXXX  Taylor Reed      GA-2D   failed      │
│   ... (paginated)                                                  │
└────────────────────────────────────────────────────────────────────┘
```

★ marks VIP-flagged orders.

---

## 6. Forms and validation

All forms use react-hook-form + zod. Definitions live in `lib/schemas.ts`.

### 6.1 Event setup form

```ts
import { z } from 'zod';

export const eventSetupSchema = z.object({
  name: z.string().min(3).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(80),
  event_type: z.enum(['festival', 'club', 'concert', 'conference', 'other']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1),
  venue_name: z.string().min(3),
  venue_city: z.string().min(2),
  capacity: z.number().int().positive().nullable(),
  age_minimum: z.number().int().min(0).max(99),

  refund_policy: z.object({
    shape: z.enum(['strict', 'tiered', 'lenient']),
    tiers: z.array(z.object({
      days_before_event: z.number().int().min(0),
      refund_pct: z.number().min(0).max(100),
    })).min(1),
    allowed_alternatives_after_window: z.array(z.enum([
      'transfer_to_another_person', 'credit_for_future_event',
      'ticket_upgrade', 'date_change_if_multi_day',
    ])),
    credit_validity_months: z.number().int().min(1).max(36),
    medical_exception_section_id: z.string().default('policy.refund.medical'),
  }),

  doors_open_local: z.string().regex(/^\d{2}:\d{2}$/),
  doors_close_local: z.string().regex(/^\d{2}:\d{2}$/),
  last_entry_local: z.string().regex(/^\d{2}:\d{2}$/),
  dress_code: z.string().max(500),
  parking_info: z.string().max(1000),

  vip_orders_always_escalate: z.boolean().default(true),
  escalation_keywords: z.array(z.string()).max(50),
  escalation_contacts: z.array(z.object({
    name: z.string().min(1),
    hours: z.string().min(1),
    method: z.string().min(1),
  })).min(1),

  ticket_tiers: z.array(z.object({
    name: z.string().min(1),
    price: z.number().nonnegative().optional(),
    description: z.string().optional(),
  })).min(1),
}).refine(d => new Date(d.end_date) >= new Date(d.start_date), {
  message: 'end_date must be on or after start_date',
  path: ['end_date'],
}).refine(d => {
  const tiers = d.refund_policy.tiers;
  return tiers.every((t, i) => i === 0 || t.days_before_event < tiers[i - 1].days_before_event);
}, { message: 'Refund tiers must be in descending days_before_event order', path: ['refund_policy', 'tiers'] });
```

On submit:
  - Persist top-level fields (`name`, `slug`, `event_type`, `start_date`, `end_date`, `timezone`, `venue_name`, `venue_city`, `capacity`, `age_minimum`) to the `events` row.
  - Compose the `EventConfig` JSON from the remaining fields and persist to `events.config`.
  - Write `audit_log` row with action `event.updated` or `event.created`.

### 6.2 KB upload

Client uploads via `POST /api/kb/upload`. Multipart form with `file` and `event_id`.

Server:
  1. Validate operator can write to the event (RLS check via Supabase client with user JWT).
  2. Reject if file > 5 MB.
  3. Detect format from extension: `.md` → markdown, `.json` → JSON, `.pdf` → PDF.
  4. Upload file to Supabase Storage at `events/{event_id}/kb/{timestamp}_{filename}`.
  5. Insert `kb_documents` row.
  6. Parse:
     - **Markdown**: split by `## ` headers. The heading text becomes a fallback section_id (lowercased, kebab-cased). If a heading immediately precedes a code block with metadata (yaml frontmatter), use that for section_id, category, intent, escalation_needed. Body text under the heading becomes `answer_en`.
     - **JSON**: expect the schema from `kb_coastline_festival.json`. Map `entries[]` directly to `kb_sections` rows.
     - **PDF**: text extraction with pdf-parse, then treat as markdown without headers (single section per page). Flag PDF support as v1.1 if it adds complexity.
  7. Upsert each parsed section into `kb_sections` (conflict on `(event_id, section_id)`).
  8. Update `kb_documents.section_count`.
  9. Return `{ document_id, sections_parsed, errors[] }`.

### 6.3 Orders CSV import

Client uploads via `POST /api/orders/import`. Multipart with `file` and `event_id`.

Server:
  1. Validate operator can write.
  2. Reject if file > 10 MB or row count > 100,000.
  3. Upload to Supabase Storage.
  4. Insert `order_imports` row with status `processing`.
  5. Parse CSV with `papaparse` (header: true, dynamicTyping: true).
  6. Validate each row against schema below. Collect errors with row numbers.
  7. Upsert valid rows into `orders` (conflict on `(event_id, order_id)` → update).
  8. Insert errors into `order_import_errors`.
  9. Update `order_imports.status` to `completed` (or `failed` if 0 valid rows).
  10. Return `{ import_id, row_count, error_count, errors[] }`.

CSV row schema:

```ts
export const orderRowSchema = z.object({
  order_id: z.string().min(1).max(120),
  customer_phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
  customer_name: z.string().min(1).max(200).optional().nullable(),
  customer_email: z.string().email().optional().nullable(),
  preferred_language: z.enum(['en', 'ar', 'ru', 'mixed']).default('en'),
  ticket_type: z.string().max(120),
  quantity: z.coerce.number().int().positive(),
  amount_paid_aed: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().length(3).default('AED'),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['completed', 'payment_failed', 'payment_pending', 'refunded']).default('completed'),
  vip_flag: z.coerce.boolean().default(false),
  transfer_eligible: z.coerce.boolean().default(true),
  notes: z.string().optional().nullable(),
});
```

Row-level errors include the row number, field name, and message. Example: `Row 14: customer_phone_e164 must match E.164 format (got "0501234567")`.

---

## 7. Acceptance criteria per issue

### Issue #2 — Bootstrap repo and CI

- pnpm + Next.js 14 App Router + TypeScript strict
- ESLint, Prettier, Tailwind, shadcn/ui initialized
- GitHub Actions on push: install, typecheck, lint, build
- `.env.example` documents all required env vars
- README has 10-minute local setup instructions
- All commits pass CI on `main`

### Issue #3 — Supabase schema and RLS

- All tables from section 3 created via migrations in `supabase/migrations/`
- RLS policies enabled and tested with two synthetic users
- `current_user_operator_ids()` function created
- `pnpm seed:demo` populates Coastline + Nightline demo data
- Integration test: user A in operator 1 cannot read events from operator 2
- Schema diagram updated in `docs/schema.png` (any drawing tool)

### Issue #4 — Auth shell

- Supabase Auth magic link login on `/login`
- `/auth/callback` handles token exchange
- `/admin/*` routes redirect to `/login` if unauthenticated
- `layout.tsx` shows operator switcher in sidebar header
- Sign-out works and clears session
- New users without operator_users membership are sent to `/admin/onboarding`

### Issue #5 — Event setup

- `/admin/events` lists events the user can see
- `/admin/events/new` creates an event with the form in section 6.1
- `/admin/events/[id]/setup` edits the same form, prefilled
- Slug is auto-derived from name but editable
- `events.config` JSONB is written correctly and round-trips
- audit_log row written on create and update
- Validation errors displayed inline below fields

### Issue #6 — KB upload + parse + list

- `/admin/events/[id]/kb` shows upload dropzone and section list
- POST `/api/kb/upload` accepts .md, .json (PDF deferred if needed)
- Markdown parser handles `## ` headers and produces stable section_ids
- JSON parser accepts the exact schema from `kb_coastline_festival.json`
- Sections list paginates (25 per page), filterable by category and intent
- Reupload of same filename creates a new kb_documents row (history kept)
- Section detail page shows EN + AR Q&A and metadata
- audit_log row on each successful parse

### Issue #7 (folded in) — Orders CSV import

- `/admin/events/[id]/orders` shows upload + recent imports + orders list
- POST `/api/orders/import` validates and upserts
- "Download template CSV" button generates a 1-row template
- Row-level errors shown in a table with row number, field, message
- Orders list paginated, filterable by status and VIP
- Re-importing same order_id updates the row (does not duplicate)
- audit_log row on each successful import

---

## 8. Mapping reference: schema ↔ EventConfig ↔ UI

Quick reference for the contractor.

| UI Field | Schema | EventConfig field | Notes |
|---|---|---|---|
| Name | events.name | event_name | Required |
| Slug | events.slug | n/a | URL identifier, unique per operator |
| Type | events.event_type | n/a | enum |
| Start date | events.start_date | event_date_iso (start) | DATE |
| End date | events.end_date | n/a | DATE |
| Venue name | events.venue_name | n/a | TEXT |
| Capacity | events.capacity | n/a | INT |
| Age min | events.age_minimum | age_minimum | INT |
| Refund shape | config | refund_policy.shape | strict/tiered/lenient |
| Refund tiers | config | refund_policy.tiers | Array |
| Alternatives | config | refund_policy.allowed_alternatives_after_window | Array |
| Credit validity | config | refund_policy.credit_validity_months | INT |
| Doors open | config | doors_open_local | HH:mm |
| Doors close | config | doors_close_local | HH:mm |
| Last entry | config | last_entry_local | HH:mm |
| Dress code | config | dress_code | TEXT |
| Parking | config | parking_info | TEXT |
| VIP auto-escalate | config | vip_orders_always_escalate | BOOL |
| Escalation keywords | config | escalation_keywords | Array |
| Escalation contacts | config | escalation_contacts | Array of objects |
| Ticket tiers | config | ticket_tiers | Array of objects |

The runtime agent (issues #8+) reads `events.config` as a single fetch; it does not join.

---

## 9. Out of scope (do NOT build)

  - Agent classifier, generator, state machine wiring
  - WhatsApp Business API integration
  - Email channel integration
  - Real-time conversation view / WebSocket
  - Escalation queue logic beyond table existence
  - Refund case logic beyond table existence
  - Post-event report generation
  - Operator billing or subscription
  - Role-based granular permissions (everyone is owner in v1)
  - Multi-language UI (English only)
  - Mobile-responsive design beyond reasonable breakpoints
  - Analytics / PostHog integration
  - Sentry / Langfuse integration
  - PII redaction layer (deferred to issue #14)
  - Inngest / background jobs
  - Operator invitations / team management UI
  - PDF parsing if it adds more than 2 hours of work

These are real things the system needs, but they are not this issue.

---

## 10. Definition of done

The contractor can demo the following end-to-end:

  1. Log in via magic link from a fresh email
  2. Land on onboarding, create an operator, create their first event
  3. Fill in the event setup form completely and save
  4. Upload `kb_coastline_festival.md` and see 65 sections parsed
  5. Upload `kb_coastline_festival.json` and see sections deduplicated correctly
  6. Upload `orders_coastline_festival.csv` and see 19 orders imported
  7. Switch to a second operator account, confirm no access to first operator's data
  8. Visit the Simulator, Conversations, Escalations, Report tabs and see clean empty states with "coming soon" copy

Timeline: 4 to 6 calendar days for a strong full-stack contractor at ~15 hours/day cap (60 to 90 hours).

---

*Spec version 1.0 — May 2026*
