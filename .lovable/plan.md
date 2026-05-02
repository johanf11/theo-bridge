## Goal

Give the next engineer (and you) a single place to see how Theo is wired up:
1. A new in-app **Architecture** page at `/architecture` rendering a Mermaid diagram + narrative.
2. A repo-root **HANDOFF.md** with concrete next steps to push the project further (Stellar testnet release flow we discussed).

---

## 1. `/architecture` page

**File:** `src/pages/Architecture.tsx`
- Wrap in `AppLayout` (matches Dashboard/Convert styling).
- Brand-consistent: cream bg, eyebrow + Playfair tagline, gold rule, white cards.
- Sections:
  - **System overview** — Mermaid diagram (rendered via `mermaid` npm pkg, dynamic import, render on mount into a ref). Light/dark safe colors.
  - **Data model** — table of core tables: `profiles`, `user_roles`, `kyb_submissions`, `orders`, `pool_balances` (read from `src/integrations/supabase/types.ts`).
  - **Order state machine** — second Mermaid stateDiagram: `QUOTED → FUNDED → RELEASING → COMPLETED` with `EXPIRED`/`FAILED` branches.
  - **Edge functions** — list `create-quote` (deployed) + planned `simulate-spih-payment`, `release-usdc`.
  - **Env / secrets** — `STELLAR_DISTRIBUTOR_SECRET`, `STELLAR_USDC_ISSUER`, `LOVABLE_API_KEY` (already auto).
- Admin-only? No — useful for any signed-in user. Gate with `ProtectedRoute` (no `adminOnly`).

**Wiring:**
- `src/App.tsx`: add `<Route path="/architecture" element={<ProtectedRoute><Architecture /></ProtectedRoute>} />`.
- `src/components/theo/Layout.tsx`: add sidebar nav item "Architecture" (Lucide `Network` icon) under main section.

**Dep:** `bun add mermaid` (small, ~600kb gz; dynamic import keeps it out of main chunk).

---

## 2. `HANDOFF.md` (repo root)

Concise markdown, ~150 lines. Sections:

- **What's built** — auth (email + Google), KYB submit/admin review, quote creation via `create-quote` edge fn, order status page with realtime, brand system in `index.css` + `tailwind.config.ts`.
- **What's stubbed** — SPIH payment matching, USDC release on Stellar, admin orders/pool/customers pages (links exist, pages missing).
- **Next milestone: end-to-end testnet flow**
  1. Add secrets `STELLAR_DISTRIBUTOR_SECRET`, `STELLAR_USDC_ISSUER` (testnet issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`).
  2. Edge fn `simulate-spih-payment`: admin-only; flips `QUOTED → FUNDED`, enqueues release.
  3. Edge fn `release-usdc`: builds + signs payment op via `@stellar/stellar-sdk`, submits to Horizon testnet, writes `stellar_tx_hash`, transitions to `COMPLETED`.
  4. UI: admin "Simulate payment received" button on `OrderStatus`.
  5. Friendbot the distributor account, establish USDC trustline (one-shot script in `scripts/stellar-bootstrap.ts`).
- **Testing checklist** — create quote → simulate payment → verify tx on `stellar.expert/explorer/testnet`.
- **Known risks** — quote expiry race, idempotency on release (use order id as memo + DB lock), RLS on `orders` already restricts to owner.
- **File map** — short pointer list (pages, layout, auth, edge fns).

---

## Diagram (preview of system overview)

```text
Browser (React SPA)
  ├─ Auth (Supabase) ──► profiles, user_roles
  ├─ KYB form ─────────► kyb_submissions
  ├─ Convert ──► edge: create-quote ──► orders (QUOTED)
  └─ OrderStatus (realtime)
         ▲                                    │
         │                                    ▼
   release-usdc ◄── simulate-spih-payment ──► orders (FUNDED→COMPLETED)
         │
         ▼
   Stellar Horizon (testnet)
```

---

## Files

- create `src/pages/Architecture.tsx`
- edit `src/App.tsx` (route)
- edit `src/components/theo/Layout.tsx` (nav item)
- edit `package.json` (+ `mermaid`)
- create `HANDOFF.md`

No DB changes, no secrets required for this step.