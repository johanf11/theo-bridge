# Theo — Handoff Notes

Last updated: 2026-06-05

A reference for the next person (or future you) picking up this project. For full architecture detail see `docs/architecture.md`. For the infrastructure and mainnet roadmap see `REBUILD.md`.

---

## Current state (June 2026)

Fully operational on **Stellar testnet**. The following flows work end-to-end with real on-chain transactions:

| Flow | Status |
|---|---|
| HTG → USDC conversion (deposit + USDC release) | ✅ Working |
| HTG-C mint (deposit + HTG-C delivery) | ✅ Working |
| HTG-C ↔ USDC swap (two-leg, auto-refund on failure) | ✅ Working |
| Off-ramp (burn HTG-C, record bank withdrawal) | ✅ Working |
| USDC payout (wallet-to-wallet, memo type aware) | ✅ Working |
| Internal transfer (move-funds between own wallets) | ✅ Working |
| Invoices (create, share public link, QR payment) | ✅ Working |
| Billing (itemized fee statements + PDF export) | ✅ Working |
| Compliance (live reserve proof, regulatory controls table) | ✅ Working |
| Blend yield (deposit, accrue, withdraw) | ✅ Working |
| Org team roles (invite, assign, permissions) | ✅ Working |
| KYB submit + admin review | ✅ Working |
| Double-entry ledger (observational, gate disabled) | ✅ Working |
| Admin ledger (trial balance, reconciliation, CSV export) | ✅ Working |

---

## What's not yet built

- **SPIH bank-feed matching** — orders never auto-transition out of `QUOTED` in production. Admin manually clicks "Confirm receipt" or uses `simulate-spih-payment`.
- **Email notifications** — none sent.
- **Quote expiry cron** — stale `QUOTED` orders are not auto-expired.
- **BSA/AML reporting** — no SAR/CTR workflows, no transaction monitoring thresholds.
- **Admin revenue dashboard** — `theo_fee_usdc` data exists per order; no aggregation UI.
- **Real key custody** — secrets live in Supabase edge function env. See Phase 5 in `REBUILD.md`.
- **Mainnet** — everything runs on Stellar testnet.

---

## Critical files and their roles

| File | Purpose |
|---|---|
| `src/App.tsx` | All routes |
| `src/components/theo/Layout.tsx` | App shell, sidebar nav, global search |
| `src/lib/auth.ts` | `useAuth`, `useRoles` |
| `src/lib/i18n.ts` | All UI strings (EN + FR) — add here for new strings |
| `src/lib/statement.ts` | jsPDF fee statement generator |
| `src/lib/receipt.ts` | jsPDF receipt generator |
| `src/lib/balance.ts` | Horizon balance helpers |
| `supabase/functions/_shared/stellar-signer.ts` | **Only file that reads `STELLAR_DISTRIBUTOR_SECRET`** |
| `supabase/functions/_shared/ledger.ts` | `safePostLedger`, `getOrCreateCustomerUsdcAccount` |
| `supabase/functions/_shared/ensure-wallet-ready.ts` | Idempotent trustline setup — call before any payment |
| `supabase/functions/_shared/tx-limits.ts` | Min 1 USDC / max 1,000,000 USDC per payment |
| `supabase/migrations/` | Applied in timestamp order — do not edit applied migrations |

---

## Memo type system (payout path)

The `send-payment` edge function supports two Stellar memo types:

| Type | When to use | Validation |
|---|---|---|
| `MEMO_TEXT` | Salaries, supplier references, descriptions | ≤ 28 UTF-8 bytes (hard reject, never truncate) |
| `MEMO_ID` | Exchange destination tags (Binance, Kraken, etc.) | Digits only, ≤ uint64 max (18446744073709551615) |

**Rules that must not be broken in any rebuild:**
- `memoType` is **required** when `memo` is non-empty (server returns 400 otherwise — no silent "text" default).
- Validation is **byte-aware** (not character-count). Use `TextEncoder().encode(val).length`.
- `memoType` is stored on the `payouts` row so audits/retries can reconstruct the correct Stellar memo type.
- `saved_recipients` stores `memo` + `memo_type` so they auto-fill on contact selection.

---

## DB schema additions (June 2026)

These columns were added after the initial schema and are not in the original `create_payouts` migration:

| Table | Column | Type | Notes |
|---|---|---|---|
| `payouts` | `memo_type` | `text check (in ('text','id'))` | Stellar memo type — required when memo is set |
| `saved_recipients` | `memo` | `text` | Stored memo value for this contact |
| `saved_recipients` | `memo_type` | `text check (in ('text','id'))` | Stored memo type for this contact |
| `federation_addresses` | `memo_type` | `text check (in ('text','id'))` | Tightened from `('text','id','hash')` — `hash` rejected by `send-payment` |

---

## Known SQL gotcha (fixed)

`neq("memo", "x")` in Supabase JS silently drops rows where `memo IS NULL` because `NULL != 'x'` evaluates to `NULL` in SQL (not `TRUE`). Use `.or("memo.is.null,memo.neq.x")` when you want to exclude a specific value while keeping null rows. This was fixed in `loadPayouts` in `Payout.tsx`.

---

## Secrets (edge function env)

| Secret | Purpose |
|---|---|
| `STELLAR_DISTRIBUTOR_SECRET` | Signs distributor → customer payments |
| `STELLAR_HTGC_ISSUER_SECRET` | Signs HTG-C trustline auth and mint/burn |
| `STELLAR_USDC_ISSUER` | G-address of testnet USDC issuer |
| `SUPABASE_URL` | Auto-injected by Supabase runtime |
| `SUPABASE_ANON_KEY` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |

Never log or return signing secrets. Never read `STELLAR_DISTRIBUTOR_SECRET` outside `_shared/stellar-signer.ts`.

---

## Testnet addresses

```
HTG-C Issuer:    GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT
Distributor:     GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X
Horizon:         https://horizon-testnet.stellar.org
Explorer:        https://stellar.expert/explorer/testnet
```

---

## Next priorities (as of June 2026)

See `REBUILD.md` for the full roadmap. The immediate gates before real customers:

1. **Phase 0** — Transfer Supabase project ownership away from Lovable Cloud (founder must own the DB and deploy pipeline).
2. **Phase 2** — Finish chain indexer so ALL on-chain movements (including manual) book to ledger; close the reconciliation gap.
3. **Phase 5** — KMS + MPC custody (the wall to production). No real customer funds until this is done.
