# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Theo is a fintech web app for HTG (Haitian Gourdes) ↔ USDC conversion. Users deposit HTG via SPIH bank transfer, receive USDC on Stellar, and can also mint HTG-C (a 1:1 HTG stablecoin on Stellar). The app also supports yield on USDC deposits via the Blend protocol.

This is a **Vite + React + TypeScript** frontend backed by **Supabase** (Postgres + Auth + Edge Functions) and **Stellar** (testnet currently).

## Commands

```bash
npm run dev          # Start dev server (Vite)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Run tests once (Vitest)
npm run test:watch   # Watch mode
```

Run a single test file:
```bash
npx vitest run src/path/to/file.test.ts
```

## Architecture

### Frontend structure

- `src/App.tsx` — all React Router routes; two route types: public and `<ProtectedRoute>` (with optional `adminOnly` flag)
- `src/components/theo/` — app-specific shell components: `Layout` (sidebar + app shell), `AuthLayout`, `ProtectedRoute`, `StatusBadge`, `WalletKeys`
- `src/components/ui/` — shadcn/ui primitives (do not edit these directly)
- `src/pages/` — one file per route
- `src/lib/auth.ts` — `useAuth()` and `useRoles()` hooks; source of truth for auth state
- `src/lib/balance.ts` — Stellar Horizon API calls for live USDC/HTG-C balances
- `src/lib/format.ts` — shared number formatters (`fmtUSD`, `fmtHTG`, `fmtHTGC`, `fmtUSDC`, `fmtRate`)
- `src/hooks/useCustomerBalance.ts` — sums live Horizon balances across all customer wallets
- `src/hooks/useBlendPositions.ts` — fetches yield positions from `blend-positions` edge fn, ticks every second for live accrual display
- `src/hooks/usePermissions.ts` — org-level permission checks (`convert`, `payout_send`, `balance_view_keys`, etc.)
- `src/integrations/supabase/` — **auto-generated**; never edit `client.ts` or `types.ts`

### Auth and roles

Two independent role systems coexist:

1. **Platform roles** (`user_roles` table + `useRoles()`): `admin` or `customer`. Controls access to `/admin/*` routes via `<ProtectedRoute adminOnly>`. Roles are never stored on `profiles`.
2. **Org-level permissions** (`org_members` + `role_permissions` tables + `usePermissions()`): fine-grained feature permissions for invited org members. The org owner always has all permissions.

### Order lifecycle

The core conversion flow: `QUOTED → FUNDED → RELEASING → COMPLETED` (or `FAILED` / `EXPIRED`).

- `/convert` calls the `create-quote` edge function → creates an `orders` row in `QUOTED` status with a 15-min expiry and a `THEO-XXXXXX` reference number
- `/orders/:id` subscribes to realtime Postgres changes on `orders` + 5s polling fallback, displays a step-progress UI and countdown timer
- Order kinds: `usdc_conversion` (default) or `htgc_mint`
- Admins see a "Simulate SPIH payment" button on the order page (calls `simulate-spih-payment` edge fn)

### Supabase edge functions

Located in `supabase/functions/`. Each function is a Deno script. Shared utilities are in `supabase/functions/_shared/`:
- `stellar-assets.ts` — exports `HTGC_ISSUER` constant (the canonical HTG-C issuer address)
- `ensure-wallet-ready.ts` — shared wallet setup helper

Key functions: `create-quote`, `simulate-spih-payment`, `release-usdc`, `blend-positions`, `blend-sweep`, `blend-withdraw`, `execute-swap`, `send-payment`, `move-funds`, `fetch-brh-rate`, `create-wallet`

Edge functions use two Supabase clients: a caller-scoped client (user JWT, respects RLS) and a service-role client (bypasses RLS). Always use the service-role client only when intentionally bypassing RLS.

### Stellar integration

- Testnet only (`https://horizon-testnet.stellar.org`)
- HTG-C issuer is `HTGC_ISSUER` from `supabase/functions/_shared/stellar-assets.ts` — always import from there, never hardcode
- Accrual formula (continuous compounding): `accrued = deposited * (e^(netApy * years) - 1)` — used in both `useBlendPositions` and the `blend-positions` edge function; keep consistent

### Styling conventions

- **Only semantic Tailwind tokens** in components — e.g. `bg-primary`, `text-theo-blue`. No raw hex, no arbitrary color values.
- All colors defined as HSL CSS variables in `src/index.css`; mapped to Tailwind in `tailwind.config.ts` under the `theo.*` namespace
- Fonts: `font-sans` = Plain/Inter (body), `font-display` = Playfair Display (headings)
- Icons: Lucide React only — no emoji in UI

### Database conventions

- `user_roles` table for platform roles — never add roles to `profiles`
- `has_role(auth.uid(), 'admin')` is a security-definer function used in RLS policies
- Realtime: tables must be explicitly added via `ALTER PUBLICATION supabase_realtime ADD TABLE <table>`
- KYB statuses: `PENDING | UNDER_REVIEW | APPROVED | REJECTED`

## What's not yet built

Several admin sidebar links exist but the pages are stubs: `/admin/orders`, `/admin/pool`, `/admin/customers`. Email notifications, quote-expiry cron job, and real SPIH bank-feed matching are also not implemented. See `HANDOFF.md` for the full roadmap including the end-to-end Stellar testnet flow.
