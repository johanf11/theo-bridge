## Goal

Fix the Odoo "Pay with Theo" 500 error on Local / USDC / ACH rails, unify Stellar off-ramp destination resolution so wire and non-wire rails share the same config, and ship an updated API integration spec the Odoo plugin author can paste into their Cursor builder.

## Cursor's analysis — review

Cursor's root cause is correct:
- `theo-api-quote`, `theo-api-pay`, `theo-api-payments` use `owltningOfframpAddress()` (env `OWLTING_OFFRAMP_STELLAR_ADDRESS`) for every rail except `wire`.
- `wire` already reads `app_settings.owlting_omnibus_address`. The env secret was never set, so non-wire rails 500.

What Cursor missed / should improve:
1. The omnibus address `GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW` is already wired up, authorized, and works for wire. Using two different Stellar destinations for "wire" vs "local/ach" on the same demo is the actual bug — there is only one off-ramp on testnet. Unify on the omnibus.
2. Status code should be `503 destination_not_configured` (matches the existing `theo-api-pay-bank` convention), not `500`. 500 leaks "config error" as an app bug to the plugin and makes the Odoo wizard treat it as a non-retryable crash.
3. The error string should be machine-readable (`code: "destination_not_configured"`) so the Odoo wizard can open the modal with a clean message instead of swallowing the popup.
4. `OWLTING_OFFRAMP_STELLAR_ADDRESS` should remain a documented **fallback only** (legacy), not the primary path. Otherwise we'll keep drifting between two configs.
5. Odoo's wizard also needs a fix: a 500 with no JSON body shouldn't suppress the modal — surface the upstream `error`/`code` in the dialog.

## Changes — backend (build mode)

### 1. `supabase/functions/_shared/odoo-settlement.ts`
Add helper:

```ts
export async function resolveOfframpStellarDestination(
  admin: SupabaseClient,
  rail: SettlementRail,
): Promise<{ address: string } | { error: string; code: string; status: number }>
```

- For all rails (`wire | local | ach | usdc-to-fiat`): first read `app_settings.owlting_omnibus_address`.
- Fallback to `Deno.env.get("OWLTING_OFFRAMP_STELLAR_ADDRESS")` if set.
- Else return `{ status: 503, code: "destination_not_configured", error: "Owlting off-ramp destination not configured" }`.
- For `rail === "usdc"` with explicit `beneficiary.wallet_address`, the caller still uses the beneficiary address directly — helper not called.

### 2. Update callers to use the helper
- `theo-api-quote/index.ts` lines 127–137 → replace the `isBankWire` branching with one call to `resolveOfframpStellarDestination`. Keep `isBankWire` only for downstream `settlement_method` labeling.
- `theo-api-pay/index.ts` and `theo-api-payments/index.ts` → same swap.
- Remove the standalone `owltningOfframpAddress()` export once unused (or mark deprecated and re-export from helper for back-compat).

### 3. Migration: seed omnibus if empty
`supabase/migrations/<ts>_seed_owlting_omnibus.sql`:

```sql
insert into public.app_settings(key, value)
values ('owlting_omnibus_address',
        jsonb_build_object('address','GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW'))
on conflict (key) do nothing;
```

### 4. Set the legacy env secret (belt-and-suspenders)
Set `OWLTING_OFFRAMP_STELLAR_ADDRESS = GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW` via `set_secret`. This satisfies any legacy code path still relying on the env.

### 5. Redeploy
`theo-api-quote`, `theo-api-pay`, `theo-api-pay-bank`, `theo-api-payments`.

## Changes — docs (for Odoo plugin Cursor builder)

### 6. Rewrite `docs/theo-odoo-integration.md` API contract sections

Tighten the contract so the plugin always succeeds. Key updates:

- **Endpoint matrix** — one table per flow (USDC-direct, bank wire, local payout, ACH) showing required body fields and which endpoint pair to call: `quote` then `pay-bank` (wire) or `pay` (others).
- **Required vs optional body keys** for `/theo-api-quote`:
  - Always: `source_wallet_id`, `amount_usd`, one of `invoice_ref` / `settlement.external_ref` / `supplier.memo`.
  - For wire/local/ach: full `settlement.beneficiary` (name, bank_name, account_number, swift for wire; bank_name + account_number + currency for local; bank_name + account_number for ach).
  - For usdc-to-wallet: `settlement.beneficiary.wallet_address` (G…).
- **Error envelope** — every non-2xx now returns `{ error, code }`. List `code` values the plugin should branch on: `destination_not_configured (503)`, `quote_expired (410)`, `quote_already_used (409)`, `kyb_required (403)`, `invalid_settlement (400)`.
- **Wizard popup robustness** — instruct the plugin to:
  - Always parse the JSON body even on 5xx; never gate the modal on `response.ok`.
  - Surface `error` + `code` in the modal so the user sees `destination_not_configured` instead of a blank popup.
  - Retry only on `502`/`503` with `code` in `{ destination_not_configured, on_chain_transient }`.
- **Test connection flow** — plugin "Test Connection" button must call `/theo-api-ping` only. Document that `/theo-api-quote` is not idempotent for health checks (already enforced server-side).

### 7. New section in docs: "Triggering the wizard safely"

Pseudo-code the Odoo `theo_payment_wizard.py` should follow:

```text
1. POST /theo-api-quote
2. If response.status == 200: open wizard with quote breakdown.
3. Else: open wizard in error state showing body.code + body.error.
   Never raise UserError before opening — it swallows the popup.
```

### 8. Update `src/pages/DocsOdoo.tsx`

Mirror the new error codes and the wizard popup guidance so an Odoo dev hitting our hosted docs gets the same contract.

## Acceptance criteria

- `POST /theo-api-quote` with `settlement.rail: "local"` + MXN beneficiary → `200` with `quote_id` and `off_ramp.stellar_address = omnibus`.
- `POST /theo-api-pay` for that quote → completes; USDC arrives at the omnibus on testnet.
- `POST /theo-api-quote` against a non-omnibus-configured project → `503` with `{ code: "destination_not_configured" }`, plugin opens modal with that message instead of suppressing it.
- Bank wire (Miami Foods) flow unchanged: still 200, still uses omnibus.
- Updated docs (`docs/theo-odoo-integration.md` + `DocsOdoo.tsx`) include endpoint matrix, error code table, wizard popup guidance.

## Out of scope

- Mainnet provisioning of a real Owlting address (still demo-only).
- Removing `OWLTING_OFFRAMP_STELLAR_ADDRESS` env entirely — kept as documented fallback for one release.
- Building the Odoo Python module (lives in the plugin repo).
