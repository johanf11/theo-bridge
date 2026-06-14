# REBUILD.md — Theo Bridge: Lovable → Owned Infrastructure → Mainnet

**Audience:** A fresh Claude Code session with no prior context on this project.
**Purpose:** Port the existing, working Theo codebase off Lovable Cloud onto infrastructure the founder fully owns, then harden it from testnet prototype to a production Stellar anchor on mainnet.

> **READ FIRST — the prime directive:** This is a **PORT, then HARDEN — NOT a rewrite.**
> The existing code is a working, on-chain-proven Stellar anchor. Do **not** scaffold a new app or rewrite working logic from scratch. Preserve the existing architecture, schema, and edge functions. Change infrastructure ownership and add production hardening incrementally, verifying at each step. Read `CLAUDE.md` in full before touching anything — it documents conventions, file locations, Stellar constants, and decision rules that still apply.

---

## 0. What Theo is (context)

Theo is a Stellar-native B2B FX platform for Haiti. A Haitian business deposits Haitian Gourdes (HTG) and receives USDC in a Stellar wallet they control, settled in seconds at a published rate. It is the on/off-ramp ("anchor") between Haitian gourdes and Stellar.

- **Stack:** React + Vite + TypeScript frontend; Supabase (Postgres + Auth + edge functions) backend; Stellar (`@stellar/stellar-sdk` via Horizon) for settlement.
- **Core flow:** HTG deposit → HTG-C mint → USDC release → customer wallet settlement → PDF receipt.
- **HTG-C:** a gourde-backed Stellar asset issued by Theo, with `Authorization Required`, `Revocable`, and `Clawback` flags for regulatory compliance (BRH = Banque de la République d'Haïti).
- **Current state:** fully operational on **Stellar testnet**, built solo by the founder. The hard technical bet is already proven on-chain.
- **Goal of this document:** own the backend, prove financial integrity, migrate key custody to KMS + MPC, deploy to mainnet, and list as a SEP-24 anchor.

Key docs already in the repo (read them):
- `CLAUDE.md` — conventions, commands, Stellar constants, file map, decision rules.
- `docs/architecture.md` — full system architecture, data model, edge function contracts.
- `docs/design.md` — design system.
- `docs/adr/0001-stellar-native-no-rehive.md` — why Stellar-native; flags the custody migration as isolated to `_shared/stellar-signer.ts`.
- `docs/stellar-queries.md` — Horizon debugging runbook, key addresses.

---

## Phase 0 — Own the infrastructure (do this first, nothing else works without it)

The current Supabase project is **owned and managed by Lovable Cloud** (project ref `nlbnmsiqfywskuxhqjon`). The founder's CLI/MCP credentials cannot deploy edge functions to it (403), there is no staging environment, and Lovable pushes straight to live production. For a money-moving anchor this is unacceptable. Fix ownership before anything else.

**Evidence the gap is real, not theoretical:** during the 2026-06-13 security hardening pass, the Lovable agent made multiple unauthorized in-place changes that bypassed PR review and would have introduced regressions:
- Widened `_shared/cors.ts` to suffix-match `*.lovable.app` / `*.lovable.dev` (catching this would have given any Lovable-hosted project a trusted origin against Theo's money-moving edge functions). Reverted after surfacing.
- Patched `_shared/secret-compare.ts` directly in the deployed bundle to work around a `crypto.timingSafeEqual` runtime error; the matching commit was opened as PR #10 separately, but the in-place patch happened first.
- Added an `as never` cast to `src/pages/Invoices.tsx` to suppress a generated-types mismatch instead of pausing for the underlying fix.

Each was disclosed honestly when surfaced, but the pattern is the point: as long as Lovable can edit shared/security code in the deploy path without a reviewed PR, the security perimeter is enforced by trust, not by the repo. Phase 0 closes that.

1. **Fresh repo.** Copy this codebase into a new git repo under the founder's control. Remove any Lovable-specific config (e.g. any `.lovable`/Lovable build config). Do **not** commit `.cursor/mcp.json`.
2. **Own a Supabase project.** Create a new Supabase project in the founder's own org/billing — **plus a separate `staging` project**. (Confirm with Lovable first whether the existing project can be *transferred* to the founder's org; if so that may be simpler than a fresh project. Either way, the founder must end up with full admin + CLI deploy rights.)
3. **CI/CD.** Wire deploys from the new repo (GitHub Actions or similar): migrations + edge functions deploy to `staging` on merge to a staging branch, to `prod` on merge to main. Never deploy straight to prod by hand.
4. **Outcome:** founder owns the DB, the secrets, and the deploy pipeline. No third-party low-code platform in the custody/settlement path.

---

## Phase 0.5 — Reconcile schema drift ⚠️ CRITICAL, easy to get wrong

The migration files in `supabase/migrations/` are the *intended* schema. **But the Lovable Cloud SQL editor runs against live production**, so there may be schema changes (tables, columns, RLS policies, functions, triggers) that were applied directly via SQL and were **never captured as migration files.** If you trust the migrations blindly you will reproduce a *different, incomplete* schema.

Do this before relying on the migrations:

1. Dump the **live** Lovable-managed DB schema (schema only, no data) — e.g. via `pg_dump --schema-only` against the live connection string, or the Supabase dashboard.
2. Spin up a scratch DB, apply `supabase/migrations/` in order, dump *its* schema.
3. **Diff the two schemas.** For every difference (missing table/column/policy/function/trigger/index), write a new migration file that captures it, so the migration set fully reproduces live.
4. Re-run from clean and confirm zero drift.
5. Pay special attention to: RLS policies (both `authenticated` and `service_role`), `SECURITY DEFINER` functions, triggers (e.g. `on_auth_user_created`), and the ledger schema if present.

Only proceed once the migrations reproduce the live schema exactly.

**Known drifts surfaced during the 2026-06-13 ledger reconciliation backfill** (illustrative; not exhaustive — a full pg_dump diff will likely find more):

- `ledger_entries`: migration `20260516111333_ledger_schema.sql` defines `amount numeric(18,7)` + `side text`. Live table uses split `debit numeric(18,7)` + `credit numeric(18,7)` columns instead. The intended schema never reached production.
- `ledger_accounts`: migration defines a `balance numeric(18,7)` column. Live table has no `balance` column at all.
- `ledger_accounts`: migration defines `account_type text`. Live table column is `type text`.
- `chart_of_accounts`: migration seeds `OPENING_BALANCE_EQUITY`. Live row exists as `OPENING_BALANCE_USDC` instead (same semantics, different identifier).

Each of these was discovered the slow way — by writing SQL that failed on the live schema. A proper Phase 0.5 pass eliminates that whole class of "discovered while debugging production" surprises.

---

## Phase 1 — Port onto the owned project (testnet, no behavior changes)

Goal: identical app, running on the founder's Supabase project, verified end-to-end on testnet.

1. **Apply migrations** to the new staging + prod projects via the founder's CLI.
2. **Deploy edge functions** from `supabase/functions/` via the founder's CLI (the 403 is gone now that the founder owns the project).
3. **Recreate secrets** in the new project(s) — see `CLAUDE.md` "Environment variables / Edge function secrets":
   - `STELLAR_DISTRIBUTOR_SECRET`, `STELLAR_HTGC_ISSUER_SECRET`, `STELLAR_USDC_ISSUER`, plus `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` and any others.
   - **Generate FRESH testnet keypairs** for the new environment; do not reuse the Lovable env's secrets.
4. **Regenerate auto-generated files** against the new project ref (they currently hardcode `nlbnmsiqfywskuxhqjon`):
   - `src/integrations/supabase/client.ts`
   - `src/integrations/supabase/types.ts`
   - Frontend env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
5. **Data:** start clean. Carry over no customer/wallet data — it's testnet and mainnet will use new wallets. Re-seed only reference data (chart of accounts, role definitions) from migrations.
6. **Verify on testnet:** run `bun install`, `bun run dev`, `npx tsc --noEmit`, `bun run lint`, `bun run test`. Then exercise the full core flow end-to-end (deposit → mint → USDC release → wallet balance → PDF receipt) and confirm a real tx hash on Stellar testnet (`stellar.expert`). The HTG-C asset and a sample conversion must be verifiable on-chain.

**Gate:** do not proceed past Phase 1 until the ported app passes the full testnet flow on the owned infrastructure.

---

## Phase 2 — Financial integrity (double-entry ledger)

A money-moving anchor must prove its books match the chain. There is an existing plan for this — look for a ledger plan (the founder has one titled "Phase 2 — Double-Entry Ledger Wiring, Backfill, Admin UI & Tests"). Implement it:

- `chart_of_accounts`, `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `ledger_posting_failures` tables with a balanced-posting trigger (per-currency debits == credits; entry currency must match account currency).
- `post_ledger_entries` RPC (idempotent via `source_key`) and `safePostLedger` helper in `supabase/functions/_shared/ledger.ts`, gated by `LEDGER_GATE_ENABLED`.
- Wire ledger postings into `execute-swap` and `admin-rectify-htgc`.
- `backfill-ledger` function + reconciliation against Horizon balances. Recommended rollout: backfill → verify trial balance zeroes → enable gate.
- `replay-ledger-failure` function + an `AdminLedger.tsx` page (reconciliation card, transaction history, per-customer trial balance, posting-failure retry).
- Vitest tests for balanced/unbalanced/mixed-currency postings and idempotency.
- **Fee persistence:** confirm every order record persists `theo_fee_usdc`, `corridor` fee, gross/net (Phase 1 fee model). Revenue ledger query must return non-zero.
- **Chain indexer — book ALL distributor/issuer/treasury activity, not just app-initiated flows.** 🔴 The shadow ledger today only records money that moves through a Theo function (conversion, swap, payout, withdrawal). Any transfer made **directly on-chain** — a manual top-up, seeding a demo wallet, an operator moving funds by hand — is invisible to both the ledger and the activity feed, and silently breaks reconciliation. *This is not hypothetical:* on testnet a net −30,000 USDC of manual distributor transfers (a 30k issuer top-up + two 30k sends to demo wallets on 2026-05-18/05-25, tx `21c4470f`, `730b0451`, `2fe06959`) never hit the ledger and produced exactly a −30,000 chain-minus-book delta on the Distributor account. Fix structurally: run a **Horizon indexer/cursor that ingests every payment on the distributor, issuer, and treasury accounts and posts a ledger entry for each**, regardless of how it was initiated (with `source_key = "chain:" + tx_hash + ":" + op_index` for idempotency). Unmatched on-chain movements post against a `External Counterparty Flow` / `Opening Balance Equity` clearing account and surface for review — so a human moving funds by hand can never create an invisible drift. On mainnet this indexer is the authoritative reconciliation source.

**Gate:** trial balance reconciles to on-chain balances (residual < ~$1 on testnet) before holding real reserves. With the chain indexer in place, residual from manual/out-of-band transfers should be **zero**, not just small.

---

## Phase 3 — Reliability under failure

A failed mid-flight transaction must never double-mint, double-pay, or lose funds.

- Wire the existing `job_queue` table to a real executor (cron/scheduled function) with retry + backoff.
- Make every money operation **idempotent** — extend the `source_key` pattern from the ledger to minting, USDC release, and payouts so a retry can't duplicate a settlement.
- End-to-end error handling across all edge functions; harden the BRH rate engine with fallback logic and staleness guards (reject/queue on stale rate rather than transacting on a bad price).
- `ensureWalletReady()` (in `_shared/ensure-wallet-ready.ts`) must remain idempotent and run before any payment.
- **Memo validation on outgoing payments — never silently truncate or coerce a memo.** A wrong-*type* or cut memo on a payout to an exchange misroutes funds **irreversibly** (the chain can't reverse it; the exchange may never credit it). The Send flow must: (1) let the sender pick the memo **TYPE** (`MEMO_TEXT` vs `MEMO_ID` — the numeric "destination tag" many exchanges require; consider `MEMO_HASH`/`MEMO_RETURN` too); (2) **validate by type** — `TEXT` ≤ 28 bytes (reject, don't `.slice()`), `ID` is a digits-only `uint64` (≤ 2^64−1); (3) build the on-chain memo with the matching SDK type (`Memo.id` for numeric, not `Memo.text`); (4) **reject with a clear error** rather than send a corrupted memo. Implemented in `send-payment` + `Payout.tsx` — keep this guarantee in any rebuild of the payment path. (Nice-to-have: a "send a small test transaction first" prompt for new recipients.)
- **Run the Phase 2 Horizon chain indexer as a durable, resumable cursor.** It is part of reliability, not just integrity: persist the Horizon paging cursor so the indexer resumes exactly where it left off after a restart, never double-posts (idempotent by `source_key = "chain:" + tx_hash + ":" + op_index`), and never skips an operation. If it falls behind or errors, it must catch up on next run — a gap in the indexer is a gap in reconciliation. This is what guarantees that *every* on-chain movement (including manual/out-of-band transfers) is eventually booked, closing the −30k-style drift class permanently.

---

## Phase 4 — Security audit

**Status (2026-06-14):** the first hardening pass (Tier 1 + Tier 2 of `security_hardening_audit_04802536.plan.md`) is **complete**. See `CHANGELOG.md` for the per-PR record. Items still outstanding from the original audit (Tier 3 server-side trust boundaries, Tier 4 correctness/hygiene, Tier 5 centralized signing) remain below as scheduled future work — Tier 5 is the gate to Phase 5 (KMS+MPC custody) and is intentionally deferred until that work begins.

Completed in the 2026-06-13 → 2026-06-14 pass:
- ✅ Forgeable JWT auth removed from `process-email-queue`; replaced with timing-safe `SUPABASE_SERVICE_ROLE_KEY` exact match (PR #5, #6). The `backfill-ledger` forged-JWT class of bug was already closed prior; the audit confirmed no other functions reintroduced the pattern.
- ✅ Cron auth path declared: `verify_jwt = false` set explicitly for `x-cron-secret`-only functions (`scheduled-tx`, `daily-seed`, `backfill-wallet-trustlines`).
- ✅ CORS allowlist replaces wildcard `Access-Control-Allow-Origin: *` on 31 edge functions including all money-moving endpoints; `federation` retains wildcard per SEP-0002 (PR #7).
- ✅ `fetch-brh-rate` gated to admin JWT or `x-cron-secret`; daily pg_cron job keeps the rate cache fresh without customer-triggered scrapes (PR #8).
- ✅ HMAC binding between `notify-admin` and `simulate-spih-payment` closes the leaked-Telegram-secret + forged-`callback_query` attack against the service-role bypass (PR #9). Constant-time-compare runtime hotfix landed alongside (PR #10).
- ✅ `get-public-invoice` rotated to a revocable `share_token` decoupled from the internal invoice id; URL leaks/forwarding no longer permanent (PR #11, #12, #13).

**Items below are remaining audit scope — implement as scheduled future work.**

- **RLS:** every table has correct policies for both `authenticated` and `service_role`. No table holding money/keys is client-writable. Confirm `stellar_secret` is **never** SELECT-able from the client — only via the `reveal-wallet-secret` edge function. ⚠️ Tier 4 follow-up flagged: the `Admins manage wallets` SELECT policy grants admins the column at the RLS layer; the column-level REVOKE is the only defense. Add an explicit RLS exclusion (or a view) until Phase 5 eliminates the column entirely.
- Every edge function verifies caller identity (`supabase.auth.getUser()`); admin-only functions additionally check `user_roles` for `role='admin'`. Service-role key is never returned to the client.
- All Stellar signing goes through `_shared/stellar-signer.ts` — no `Keypair.fromSecret(...)` anywhere else. (Tier 5 of the original audit — the prerequisite for the Phase 5 custody migration; track ~18 outstanding `Keypair.fromSecret` call sites.)
- **No function may trust unverified/decoded JWT claims.** Service-role auth is **exact-secret-match only** (`token === SERVICE_ROLE_KEY`) or a **signature-verified** token — never `atob(token.split('.')[1])` + a `role`/`ref` claim check, which is forgeable because the project ref is public. *This actually happened:* `backfill-ledger` decoded the bearer JWT payload without verifying the signature and granted admin if `role==="service_role"` and `ref===<project ref>`, allowing anyone to forge a token and rewrite the entire ledger. Grep every edge function for `atob(token`, unverified `payload?.role`, and any auth path that doesn't end in either an exact secret match or `getUser()` + `user_roles` admin check.
- Secrets never logged or returned. Dependency audit.
- Run the `security-review` skill on the diff. Commission a third-party pen test before mainnet.

---

## Phase 5 — Key custody migration (KMS + MPC) 🔴 THE BIG GATE

This is the highest-stakes work and the wall between "great demo" and "production." It is isolated to `supabase/functions/_shared/stellar-signer.ts` by design — keep it there behind a stable signing interface so callers don't change.

**Design (non-custodial — the customer holds their own key share):**
- **Distributor / issuer keys:** operational key in **AWS KMS** (hardware-backed, audit-logged signing, key never leaves the boundary) + a hardware recovery key in cold storage.
- **Customer wallet signing:** **two-share MPC, with the customer's share carried by a passkey.**
  - Share 1 stored in AWS KMS, never leaves the signing environment.
  - Share 2 **bound to a customer passkey (WebAuthn / platform authenticator — Face ID, fingerprint, device PIN)** and **never accessible to Theo's servers.**
  - **The passkey is the chosen mechanism — not SMS, not WhatsApp, not TOTP.** Rationale: passkeys are *lower* friction than typing OTP codes (a single biometric tap), don't depend on flaky Haitian mobile networks, and the same credential serves triple duty — login factor, transaction-authorization (step-up) factor, and the non-custodial signing share. SMS/WhatsApp are phishable and the wrong trust tier for authorizing fund movement; use WhatsApp only for *notifications* and as a *login* convenience fallback, never to authorize money movement. Keep **TOTP as a secondary fallback factor** only.
  - The two shares combine via the MPC protocol to produce a valid Stellar **Ed25519** signature **without ever reconstructing the full private key.**
  - Because Theo never holds the customer's share, **Theo cannot unilaterally move client funds.** This must be literally true — do not implement a "session-derived" share that the backend can regenerate; that would break the non-custodial claim.
- **MPC provider must support Ed25519 threshold signing** (Stellar uses Ed25519, not secp256k1 — verify the provider does Ed25519 well before committing).
- Enforce per-transaction and per-customer daily limits **at the signing layer** (see `_shared/tx-limits.ts`), with a full audit log on every signing request (timestamp, amount, wallet, approving credential).
- **Account recovery & backup — design this DURING ONBOARDING, not after.** 🔴 This is the make-or-break detail for passkey + non-custodial MPC: a lost device must not mean lost funds, and recovery must **never** let Theo (or an attacker who compromises Theo) reconstruct the customer's share and impersonate them. The recovery/backup ceremony has to be part of the onboarding flow so the customer is never single-device-dependent from day one. Decide and document:
  - **Backup at enrollment:** require the customer to register **≥2 passkeys / authorized devices** during onboarding (e.g. phone + laptop), or provision a recovery credential, *before* the account can transact. No single point of failure on day one.
  - **Lost-device recovery:** how a customer re-establishes their share on a new device using a surviving registered credential — with a recovery path that does not route the full share through Theo's servers.
  - **Multi-user orgs:** Theo already has org-level permissions. Each authorized user gets their own passkey + share, with explicit authority rules (who can authorize fund movement, approval thresholds for large transfers).
  - **Synced vs device-bound passkeys:** platform passkeys sync across a user's devices via iCloud Keychain / Google Password Manager (convenient, good for recovery). Decide whether synced passkeys are acceptable as the signing-share carrier, or whether high-value orgs require device-bound (non-synced) credentials. This is a security-vs-recovery tradeoff — make it deliberately, per risk tier.
  - **Hard requirement:** an account cannot reach a transacting state until a working backup/recovery method is registered. Treat "no recovery configured" as a blocking onboarding gate.

**Gate:** no raw key material in the application layer; Theo provably cannot sign without the customer's share; limits + audit log live. Do not put real customer funds on the line until this is done.

---

## Phase 6 — Mainnet migration

- Deploy **HTG-C issuer on Stellar mainnet** with `Authorization Required`, `Revocable`, `Clawback` flags verified on-chain.
- Switch from testnet USDC to **real USDC** (Circle's mainnet issuer); update `_shared/stellar-assets.ts` constants and `NETWORK_PASSPHRASE` to `Networks.PUBLIC`, `HORIZON_URL` to mainnet.
- Publish **`stellar.toml`** at the asset home domain with full legal documentation; restrict mint/burn to the compliance-reviewed issuer keypair via the admin dashboard only.
- Fund the distributor with initial real USDC liquidity.
- Start with **small per-tx and daily limits**; raise gradually after live observation.
- All edge functions point at mainnet Horizon; customer dashboard live at production domain.

---

## Phase 7 — Liquidity + bank rails

- **MoneyGram FX API** integration: automated rate fetching, order routing, settlement instructions; live corridor cost reflected in order fee calc.
- **MGUSD / MoneyGram on-chain as a replenishment rail.** In 2026 MoneyGram launched **MGUSD** — a native-Stellar USD stablecoin (issued by Bridge/Stripe, M0 mint/burn, Fireblocks custody) under a 5-year Stellar Development Foundation partnership, aimed at on-demand local-currency conversion in inflation-hit markets. Because it's native Stellar, it's directly composable with Theo. Evaluate **MGUSD as a settlement asset** and **MoneyGram on-chain as the buffer-replenishment rail** (tier ② / ③ in `docs/target-architecture.md`). **Stay settlement-asset-agnostic: support USDC *and* MGUSD** (just another asset/trustline) rather than hard-wiring USDC, so liquidity can come from whichever rail is cheapest. Treat MoneyGram as a *possible* rail, not a guaranteed partner — they have their own stablecoin strategy — which is exactly why the FX swap facility below (a Theo-controlled channel) must stay independent.
- **FX swap facility:** structure/term sheet for a direct funded conversion channel independent of any single corridor partner.
- **SPIH integration** (Système de Paiement Interbancaire d'Haïti): bridge inbound HTG bank wires → match to open order → auto-trigger HTG-C mint + USDC release, no manual step.

---

## Phase 8 — Compliance & legal

- Production **KYB** workflow: document collection, approve/reject controls, audit logging, hard order gating by compliance status.
- **BSA/AML** framework and automated compliance reporting.
- **BRH regulatory engagement**; HTG-C legal documentation; per-customer KYB legal review.

---

## Phase 9 — SEP-24 anchor + directory listing

- Implement **SEP-24** (interactive deposit/withdraw) + **SEP-10** auth so any Stellar wallet (Lobstr, Freighter, etc.) can ramp through Theo without the proprietary dashboard.
- Publish the compliant `stellar.toml`; submit to the **Stellar anchor directory**.
- This is what makes Theo a *listed, interoperable* anchor.

---

## Cross-cutting — observability (do throughout, not at the end)

- Uptime monitoring + alerting on failed signings/settlements and ledger posting failures.
- Structured logging that **never** logs secrets or full PII.
- A reconciliation dashboard (book vs. on-chain) that is actually watched.
- **Admin activity log must reflect EVERY customer-impacting movement** — conversions, swaps, **payouts (USDC), and bank withdrawals (HTG-C redemptions)**, plus yield. Today the admin log is ledger-sourced, so any movement not booked to the ledger (seed data, or anything that bypassed the ledger path) is invisible — which breaks client support ("did my payment / bank withdrawal go through?"). Interim fix already shipped: the admin log merges `payouts` and `htgc_withdrawal` orders directly, deduped against ledger-booked rows. The durable fix is the Phase 2/3 chain indexer booking *all* movements so the ledger is the single complete source and the admin log needs no per-table merges. Acceptance: an admin can pull up any client's payout or bank withdrawal by reference/customer and see its status.

---

## Recommended sequencing

```
Phase 0  (own infra)              ──┐ gate everything
Phase 0.5 (reconcile drift)       ──┘
Phase 1  (port, verify testnet)     ← prove parity on owned infra
Phase 2  (ledger + reconciliation)  ← prove books == chain
Phase 3  (reliability)
Phase 4  (security audit)
Phase 5  (KMS + MPC custody)        🔴 the wall to production
Phase 6  (mainnet, tiny limits)
Phase 7/8 (liquidity, compliance)   ← in parallel, for the pilot
Phase 9  (SEP-24 listing)
```

The two items that gate *everything* downstream are **Phase 0 (own the backend)** and **Phase 5 (real key custody)**. Until both are done, the app is demo-ready, not production-ready.

---

## Commands (from CLAUDE.md)

```bash
bun install            # deps
bun run dev            # dev server (port 8080)
bun run build          # production build
npx tsc --noEmit       # typecheck
bun run lint           # lint
bun run test           # tests
```

## Conventions that still apply (see CLAUDE.md for full list)

- HTG is integer-only (no cents). DB amounts use 7 decimal places. USDC displays at 2 dp. Fee rates in bps.
- No crypto jargon in customer-facing UI ("HTG Balance" not "HTG-C balance"; "Convert"/"On/Off Ramp" not "swap").
- Inline styles for page content; all colors via `--theo-*` CSS variables. No emoji, no gradients, Lucide icons only.
- New RLS policies: always add both `authenticated` and `service_role`.
- Testnet only until the mainnet migration (Phase 6).
- Do not edit `src/integrations/supabase/client.ts` / `types.ts` by hand — regenerate them.
