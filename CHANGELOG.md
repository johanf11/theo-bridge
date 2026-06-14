# Changelog

Notable changes to Theo Bridge. Format follows [Keep a Changelog](https://keepachangelog.com).

## 2026-06-13 — Security hardening pass

Pre-mainnet hardening of edge function auth, CORS, server-to-server calls, and credential handling. Maps to the planning document at `security_hardening_audit_04802536.plan.md`.

### Tier 1 — Auth and token integrity (PR #5, #6)
- Replaced forgeable JWT role check in `process-email-queue` with timing-safe exact-match against `SUPABASE_SERVICE_ROLE_KEY`. Removed `parseJwtClaims` (signature-less `atob` decode).
- Added explicit `verify_jwt = false` in `supabase/config.toml` for cron-invoked functions (`scheduled-tx`, `daily-seed`, `backfill-wallet-trustlines`) that authenticate via `x-cron-secret`.
- New shared helper `_shared/secret-compare.ts` with constant-time string equality.

### Tier 2a — CORS allowlist across edge functions (PR #7)
- Replaced `Access-Control-Allow-Origin: *` on 31 edge functions with a shared `_shared/cors.ts` helper backed by an explicit origin allowlist (overridable via `ALLOWED_ORIGINS` env).
- `federation` endpoint retains wildcard (SEP-0002 requires public access).
- Closes a CSRF-style risk where any origin's browser could call money-moving edge functions like `send-payment`, `execute-swap`, `withdraw-htgc`, and `reveal-wallet-secret`.

### Tier 2b — `fetch-brh-rate` admin/cron gate (PR #8)
- Restricted BRH rate refresh to admin user JWT or valid `x-cron-secret`. Customers continue to read cached rates from `rate_snapshots` via RLS (no behavior change for end users).
- Closes a rate-poisoning / DoS vector where any authenticated user could trigger BRH scrapes and service-role writes.
- Added daily pg_cron job (`fetch-brh-rate-daily`, 13:00 UTC weekdays) so the cache stays fresh after gating customer triggers. Weekday-only to avoid masking real BRH publications with stale Friday data.

### Tier 2c — HMAC-bound `notify-admin → simulate-spih-payment` (PR #9, #10)
- HMAC-signed server-to-server call binds the Telegram confirm flow to a specific `orderId`. Closes the attack where a leaked `TELEGRAM_WEBHOOK_SECRET` could be combined with a forged `callback_query` to drive `simulate-spih-payment` against arbitrary orders via the service-role bypass.
- New shared helper `_shared/hmac.ts` (HMAC-SHA256 via Web Crypto, constant-time verify).
- Requires new edge function secret `SPIH_CONFIRM_HMAC_SECRET`. Fails closed if unset (Telegram confirm path returns an explicit misconfiguration error rather than silently proceeding).
- Hotfix (PR #10) replaced `crypto.timingSafeEqual()` (Node API not available in Deno Edge Runtime) with a portable XOR-loop constant-time compare in `_shared/secret-compare.ts`.

### Tier 2d — Revocable share token for public invoices (PR #11, #12, #13)
- Decoupled the public-sharing capability from the internal invoice id. New `invoices.share_token` (32-byte random hex, UNIQUE) and optional `share_token_expires_at`; route `/inv/:token` replaces `/inv/:id`.
- `get-public-invoice` accepts `{ token }` instead of `{ id }`, returns `410 Gone` on expiry, and strips `share_token_expires_at` from the response.
- Tokens are independently rotatable, so a leaked or forwarded share URL can be revoked without deleting the invoice.
- Follow-up (PR #13) added column-level `DEFAULT encode(gen_random_bytes(32), 'hex')` on `share_token` and locked down `EXECUTE` on the auto-generation trigger function to `service_role` only (revoked from `PUBLIC`/`anon`/`authenticated`).
- Breaking change for any previously shared `/inv/<uuid>` URLs (they now 404) — acceptable at testnet stage.

### Operational notes
- All changes verified end-to-end on Stellar Testnet with live conversions through `THEO-CNV-37ADJM` and `THEO-CNV-CZ9722`, and a live invoice render through `INV-20260614-953`.
- One Supabase platform-side change surfaced during the pass: gateway now rejects requests where `apikey` and `Authorization` carry different `sb_` keys ("Conflicting API keys"). Patched in `simulate-spih-payment → release-usdc` server-to-server call by dropping the redundant `apikey` header.
- One operational gap surfaced and logged: no admin UI path to manually trigger `release-usdc` on a stuck `FUNDED` order. Resolution required curl invocation with a copied JWT. Tier 4 follow-up: add a "Force release" admin action visible when an order stays in `FUNDED` past a threshold without a tx hash.
- One ledger drift surfaced and reconciled: `topup-distributor-usdc` posts `CR Treasury / DR Distributor`, but the on-chain mint is `issuer → distributor`; Treasury was never debited on chain. Resolved via a one-time balanced journal entry (`DR Treasury / CR Opening Balance Equity`, $500,000). Root cause is in the function's posting logic — fix tracked as a Tier 4 follow-up.

## 2026-06-11 — Initial testnet build (`3d4fcda`)
- Stellar HTG/USD anchor: HTG-C asset issuance, customer wallets, conversion and payout flows, KYB workflow, admin compliance dashboard, SPIH manual confirmation path, ledger reconciliation panel.
- Frontend: 24 customer and admin pages.
- Backend: 34 edge functions on Supabase.
- Database: 122 schema migrations.
- ~37,000 lines of production code.
