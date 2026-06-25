
# Theo for Odoo — API keys + public payment API

Scope is the Theo side only: a way for org **owners** to mint API keys in Settings, and a small public REST surface the Odoo `theo_payment` module will call. The Odoo Python module itself ships separately and is out of scope for this project.

## 1. Database

New migration adds `public.api_keys`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `customer_id` | uuid → customers | org scope |
| `name` | text | user label, e.g. "Odoo prod" |
| `prefix` | text | `theo_live_xxxx` shown in UI |
| `last_four` | text | last 4 chars for display |
| `hashed_key` | text | sha-256 hex; raw key never stored |
| `scopes` | text[] | default `{payments:write,wallets:read,balance:read,quotes:write}` |
| `created_by` | uuid → auth.users | |
| `created_at` / `last_used_at` / `revoked_at` | timestamptz | |

Migration also: GRANTs (`authenticated` SELECT/UPDATE, `service_role` ALL); RLS — owners only (`is_org_owner(customer_id)`) can SELECT/INSERT/UPDATE; `service_role` full; nothing for `anon`. Index on `(hashed_key)` for fast lookup.

## 2. Edge function `api-keys` (authenticated, JWT-verified)

- `POST /create` `{ name, scopes? }` — owner-only check via `is_org_owner`. Generates `theo_live_` + 32 hex chars, stores SHA-256 hash, returns the raw key **once**.
- `POST /revoke` `{ id }` — sets `revoked_at`.
- Listing uses Supabase client + RLS from the UI (no list endpoint needed).

## 3. Settings UI — new "API & Integrations" section

In `src/pages/Settings.tsx`, owner-only (uses existing `usePermissions().isOwner`). Adds an "Odoo & API" card:

- Endpoint URL (read-only, copy button).
- "Generate API key" → modal showing the raw key once with a copy button + "I've saved it" confirmation; toast warns it won't be shown again.
- Table of existing keys: name, `prefix···last_four`, created, last used, Revoke button. Revoked keys greyed out.
- Helper link "Install the Odoo plugin" pointing to the docs page.

Non-owners see a notice that only owners can manage API keys.

## 4. Public REST API (verify_jwt = false, Bearer api-key auth)

New shared helper `_shared/api-key-auth.ts` (this is a new file, not a modification of the existing _shared perimeter): hashes the `Authorization: Bearer …` header, looks up `api_keys`, rejects if missing/revoked, returns `{ customer_id, scopes }`, bumps `last_used_at`. Wide-open CORS (Odoo servers are arbitrary). Never logs the raw key.

Endpoints, each its own function:

- `GET  theo-api-ping` → `{ ok: true, customer: { id, company_name } }` (Test Connection).
- `GET  theo-api-wallets` → `[{ id, label, currency, available_balance }]` for every wallet the customer can pay from. Includes USDC wallets (live Horizon balance) and the HTG-C internal balance as a synthetic wallet entry. The plugin uses this to render the wallet picker + balance.
- `POST theo-api-quote` `{ source_wallet_id, amount_usd, supplier: { name, stellar_address?, bank? } }` →
  - If source is a USDC wallet with ≥ amount: returns `{ quote_id, source_currency: "USDC", debit_usdc: amount_usd, fee_usd, total_debit_usd, rate: 1, expires_at }`.
  - If source is HTG-C: returns `{ quote_id, source_currency: "HTGC", debit_htgc, rate, fee_usd, expires_at }` using the live BRH rate from `rate_snapshots` + standard fee bps — same math as `create-quote`.
  - Persists a row in `orders` (status `QUOTED`, kind `usdc_conversion` or new `odoo_payment`) with 15-min TTL so `theo-api-pay` is idempotent.
- `POST theo-api-pay` `{ quote_id, external_invoice_ref }` → executes settlement to the supplier address using existing `send-payment` / `execute-swap` logic internally, returns `{ reference_number, stellar_tx_hash, status }`. Validates quote is unexpired + belongs to caller's customer.

All endpoints validate input with Zod, enforce scopes, and rate-limit (simple per-key per-minute counter in `job_queue`-style table or in-memory — basic limit, 60 req/min).

Supplier details are **always passed inline** on quote/pay — no vendor sync built now. Adding a `theo_vendors` mirror later is a separate feature.

## 5. Docs page

New static React route `/docs/odoo` (no auth) with: endpoint base URL, sample curl for each endpoint, install steps for the Odoo module, error code table. Linked from the Settings card.

## 6. Out of scope (separate work)

- The `theo_payment` Odoo 17 Python/XML module + docker-compose — shipped as a separate ZIP.
- Vendor sync (Odoo → Theo supplier mirror). Possible follow-up once the inline flow is in production.
- OAuth / per-user keys. Single org-level API key model only.

## Technical notes

- Key format: `theo_live_` + 32 hex chars (16 bytes). Hash with `crypto.subtle.digest('SHA-256')`. Prefix = first 14 chars; last_four = last 4 of the raw key.
- Owner check uses existing `public.is_org_owner(customer_id)` SQL function for both RLS and the create endpoint.
- Reuses existing `_shared/stellar-signer.ts`, `tx-limits.ts`, rate snapshots, and the same fee math (`fee_bps` + `corridor_bps`) — no parallel pricing logic.
- No new project secrets needed; everything uses existing infra.
- `_shared/api-key-auth.ts` is a new file and does not touch any existing `_shared/*` helper (per project security constraint).
