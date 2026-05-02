# Theo — Handoff Notes

Last updated: 2026-05-02

A reference for the next person (or future you) picking up this project. For a visual map, sign in and visit `/architecture`.

---

## What's built

- **Brand system** — `src/index.css` and `tailwind.config.ts`. Flat-color Theo palette (blue + gold + cyan accent), Inter + Playfair, semantic tokens only.
- **Auth** — email/password + Google OAuth via Lovable Cloud. `src/lib/auth.ts` exposes `useAuth` and `useRoles`. `ProtectedRoute` gates app pages; `adminOnly` flag for admin pages.
- **Roles** — `user_roles` table + `has_role()` security-definer function. Never store roles on `profiles`.
- **KYB** — `/kyb` form + `/admin/kyb` review page. `kyb_submissions` table with status `PENDING | UNDER_REVIEW | APPROVED | REJECTED`.
- **Quote** — `/convert` posts to `supabase/functions/create-quote`. Edge fn validates KYB approval, locks rate, inserts an `orders` row with `QUOTED` status and 15-min `quote_expires_at`.
- **Order status** — `/orders/:id` with realtime subscription + 5s polling fallback, countdown timer, SPIH payment instructions, terminal states.
- **Architecture page** — `/architecture` (mermaid diagrams of system + state machine).

## What's stubbed or missing

- **SPIH bank-feed matching** — no real integration. Orders never auto-transition out of `QUOTED`.
- **USDC release on Stellar** — no edge function yet.
- **Admin pages** — sidebar links to `/admin/orders`, `/admin/pool`, `/admin/customers` exist but pages aren't built.
- **Email notifications** — none.
- **Quote expiry sweeper** — no cron job to flip stale `QUOTED` → `EXPIRED`.

---

## Next milestone: end-to-end testnet flow

Goal: create a quote in the UI, simulate the bank payment, and watch USDC actually land on a Stellar testnet wallet.

### 1. Bootstrap a Stellar testnet distributor

One-shot, outside the app:

1. Generate a keypair (e.g. `npx @stellar/stellar-sdk` or https://laboratory.stellar.org).
2. Fund it via friendbot: `curl "https://friendbot.stellar.org?addr=<PUBKEY>"`.
3. Establish a USDC trustline against the testnet USDC issuer (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` is the common testnet issuer; confirm the one you want).
4. Send some testnet USDC to the distributor (issuer can mint, or use a faucet).

Save:
- `STELLAR_DISTRIBUTOR_SECRET` (S…) as a Lovable Cloud secret.
- `STELLAR_USDC_ISSUER` (G…) as a Lovable Cloud secret.

### 2. Edge function: `simulate-spih-payment`

Admin-only debug function. Body: `{ orderId }`.

- Verify caller is admin via `has_role(auth.uid(), 'admin')`.
- Load order, ensure status = `QUOTED` and not expired.
- Update to `FUNDED`, then call `release-usdc` (or insert a job row).

### 3. Edge function: `release-usdc`

Body: `{ orderId }`. Idempotent — must tolerate retries.

- Load order, ensure `FUNDED`. Atomically transition to `RELEASING` (use a conditional update on status to lock).
- Build a Stellar payment op with `@stellar/stellar-sdk`:
  - asset = `Asset(USDC, STELLAR_USDC_ISSUER)`
  - destination = customer's Stellar wallet (need to capture this — extend `profiles` or `orders` with `stellar_wallet`)
  - amount = `order.usdc_amount`
  - memo = `order.reference_number` (also used for idempotency)
- Sign with `Keypair.fromSecret(STELLAR_DISTRIBUTOR_SECRET)`, submit to `https://horizon-testnet.stellar.org`.
- On success: write `stellar_tx_hash`, set status `COMPLETED`.
- On failure: status `FAILED`, set `failure_reason`.

### 4. UI tweaks

- Capture customer Stellar wallet in `/convert` (or `/kyb`).
- On `OrderStatus`, show admin-only "Simulate payment received" button when status = `QUOTED`.
- Already wired: realtime updates push `RELEASING` and `COMPLETED` automatically.

### 5. Test checklist

1. Sign up, complete KYB, admin approves.
2. `/convert` — create a quote (e.g. 5,000 HTG).
3. As admin on `/orders/:id`, click "Simulate payment received".
4. Watch status step through `FUNDED → RELEASING → COMPLETED`.
5. Click the tx hash → opens `stellar.expert/explorer/testnet/tx/...` and shows the USDC payment.

---

## Known risks

- **Idempotency** — if `release-usdc` is invoked twice, you must not double-pay. Conditional `UPDATE … WHERE status = 'FUNDED'` is the lock; use `reference_number` as Stellar memo so a retry that didn't update the DB can still be reconciled by querying Horizon.
- **Quote expiry race** — a payment could land just as the quote expires. Decide policy (honor or refund) before going live.
- **RLS** — `orders` is owner-restricted. Admin reads need `has_role()`-based policies; service-role edge functions bypass RLS by design.
- **Secret leakage** — `STELLAR_DISTRIBUTOR_SECRET` must only ever live in edge function env, never in the client bundle.

---

## File map

| Path | Purpose |
|---|---|
| `src/App.tsx` | Routes |
| `src/components/theo/Layout.tsx` | App shell + sidebar |
| `src/components/theo/AuthLayout.tsx` | Login/Register shell |
| `src/components/theo/ProtectedRoute.tsx` | Auth + admin gating |
| `src/lib/auth.ts` | `useAuth`, `useRoles` |
| `src/pages/Landing.tsx` | Marketing page |
| `src/pages/Login.tsx` / `Register.tsx` | Auth |
| `src/pages/Dashboard.tsx` | Balance + recent orders |
| `src/pages/Convert.tsx` | Quote form |
| `src/pages/OrderStatus.tsx` | Live order page |
| `src/pages/Kyb.tsx` / `AdminKyb.tsx` | KYB submit / review |
| `src/pages/Architecture.tsx` | This handoff, visualised |
| `supabase/functions/create-quote/` | Quote edge fn |
| `src/index.css`, `tailwind.config.ts` | Brand tokens |

---

## Conventions

- Semantic Tailwind tokens only. No raw hex in components.
- All colors HSL in `index.css`.
- Lucide icons, no emoji in UI.
- Realtime: enable per-table via `ALTER PUBLICATION supabase_realtime ADD TABLE ...`.
- Never edit `src/integrations/supabase/{client,types}.ts` — auto-generated.
