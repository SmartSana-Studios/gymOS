# GymOS

Multi-tenant gym management platform: member mobile app, gym admin dashboard, and super admin dashboard on a shared Supabase backend.

## Apps & Packages

- `apps/dashboard` — Gym Admin Dashboard (Next.js)
- `apps/super-admin` — Super Admin Dashboard (Next.js, separate deployment)
- `apps/mobile` — Member App (Expo + Router, Android & iOS)
- `packages/types` — shared generated Supabase types, Zod schemas, error mapping, Supabase client factory
- `supabase/` — migrations, Edge Functions, pgTAP tests

## Prerequisites

- Node 20+
- pnpm 10+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (for local Supabase via `supabase start`)

## Getting Started

```bash
pnpm install
pnpm dev   # starts local Supabase + all three apps concurrently
```

See `_bmad-output/planning-artifacts/architecture.md` for the full architecture and directory structure, and `docs/decisions.md` for sandbox-spike outcomes.
