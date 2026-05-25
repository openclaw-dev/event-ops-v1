# Event Ops v1

AI customer support and revenue recovery layer for live event operators in the GCC.
WhatsApp-first, Arabic + English native. See `docs/spec/` for the source-of-truth specs.

This repo is the operator admin shell: auth, event setup, KB upload, orders CSV import.
Agent loop, WhatsApp channel, and reporting are subsequent issues.

## Stack

- Next.js 14 (App Router) + TypeScript strict
- Tailwind + shadcn/ui
- Supabase (Postgres 15, Auth, Storage) with RLS
- react-hook-form + zod, @tanstack/react-table, papaparse
- Claude SDK (Sonnet 4.6 generator, Haiku 4.5 classifier) — wired in later issues

## Local setup (10 minutes)

Prereqs: Node 20+, pnpm 9+, Supabase CLI (only needed once DB migrations land).

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local and fill in the values (see docs/spec/admin_shell_spec.md §2 for what each is).

# 3. Run the dev server
pnpm dev
# Open http://localhost:3000
```

## Scripts

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `pnpm dev`           | Start Next.js dev server on :3000           |
| `pnpm build`         | Production build                            |
| `pnpm start`         | Run the production build                    |
| `pnpm typecheck`     | `tsc --noEmit` over the whole project       |
| `pnpm lint`          | `next lint`                                 |
| `pnpm format`        | Format with Prettier                        |
| `pnpm format:check`  | Check formatting without writing            |

## CI

GitHub Actions runs `install → typecheck → lint → build` on every push and PR.
See `.github/workflows/ci.yml`.

## Repo layout

```
src/
  app/        Next.js App Router pages and API routes
  lib/        Shared utilities (cn, schemas, supabase clients — added later)
supabase/     Migrations and seed (added in issue #3)
docs/
  spec/       Specs — admin shell, project status
  reference/  Reference implementations (refund deflection state machine)
  data/       Demo KBs, test messages, post-event report template
```

## Documentation

- `docs/spec/project_status.md` — current state, scope, what's done and pending
- `docs/spec/admin_shell_spec.md` — full build spec, source of truth for v1
- `docs/reference/refund_deflection.ts` — reference state machine

## Boundaries

No real customer PII. Demo data only. No MDLBEAST data or branding.
See `docs/spec/project_status.md` § Boundaries.
