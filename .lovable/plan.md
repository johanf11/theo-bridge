# Plan: Theo-API hardening for Odoo plugin

Three coordinated changes across the `theo-api-*` edge functions plus docs. Memory note: shared edge helpers normally require approval — flagging that this plan touches `supabase/functions/_shared/`, which is required to fix the bug. Confirming via this plan satisfies that gate.

## 1. Unified off-ramp Stellar destination resolver

A helper already exists (`resolveOfframpStellarDestination` in `_shared/odoo-settlement.ts`) but isn't used everywhere. Rename to the spec name and apply consistently.

**`supabase/functions/_shared/odoo-settlement.ts`**
- Rename `resolveOfframpStellarDestination` → `resolveOwltingStellarDestination(admin)` returning `string | null` (drop the embedded error envelope so callers compose 503 via the shared error helper).
- Order: `app_settings.owlting_omnibus_address` → `OWLTING_OFFRAMP_STELLAR_ADDRESS` env → null. Validate `G…` and length ≥50.
- Keep `owltningOfframpAddress()` exported for one release as a deprecated alias.

**Callers updated to use the resolver for every rail (drop the wire-only branch):**
- `theo-api-quote/index.ts`
- `theo-api-pay/index.ts` — also compare `order.destination_stellar_address` against the **resolved** address, not env-only.
- `theo-api-pay-bank/index.ts` — same validation against resolved address.
- `theo-api-payments/index.ts`
- `theo-api-wallets/index.ts` — populate `off_ramp.stellar_address` from resolver so Odoo caches the correct value.

When resolver returns `null` → `apiError("Owlting off-ramp Stellar destination not configured", "destination_not_configured", 503)`.

## 2. Structured error envelope `{ error, code }`

**New file `supabase/functions/_shared/api-errors.ts`:**

```ts
export function apiError(message: string, code: string, status: number)
  : { body: { error: string; code: string }; status: number };
```

Plus a small `jsonError(req, message, code, status)` that wraps `corsHeaders(req, { wildcard: true })`. Edge functions return the wrapped Response directly.

**Applied across all `theo-api-*` endpoints** using this code map:

| HTTP | code | Trigger |
|---|---|---|
| 400 | `invalid_request` | missing fields, bad method |
| 400 | `invalid_settlement` | bad settlement / beneficiary / stellar addr |
| 401 | `unauthorized` | missing/invalid API key |
| 403 | `kyb_required` | KYB not APPROVED |
| 403 | `forbidden` | wrong customer / missing scope |
| 404 | `not_found` | quote/wallet/customer missing |
| 409 | `quote_already_used` | pay on used quote (non-replay) |
| 410 | `quote_expired` | past `quote_expires_at` |
| 500 | `internal_error` | DB / config / unconfigured issuer |
| 502 | `on_chain_failed` | Stellar submit failure (include Horizon message in `error`) |
| 503 | `destination_not_configured` | no omnibus + no env |

Touches: `theo-api-quote`, `theo-api-pay`, `theo-api-pay-bank`, `theo-api-payments`, `theo-api-wallets`, `theo-api-convert`, `theo-api-ping` (only auth/method errors). Existing `error` strings stay human-readable — only the envelope gains `code`. `authenticateApiKey` callers add `code` based on its `status` (401 → `unauthorized`, 403 → `forbidden`/`kyb_required`).

## 3. Expired-quote replay fix in `theo-api-quote`

When looking up an existing order by `api_idempotency_key`:
- If `status` ∈ {`FAILED`, `CANCELLED`, `EXPIRED`} **or** `quote_expires_at < now()` → ignore the stale row and create a fresh quote (new `quote_id`, new expiry, new idempotency row scoped by attempt).
- Only return `{ idempotent_replay: true }` when status ∈ {`QUOTED`, `FUNDED`} and still unexpired.

Implementation: extend the existing idempotency lookup with the expiry/status guard before the `return existing` branch.

## 4. Admin UI (small)

`src/pages/AdminOwlting.tsx` — call a tiny new internal endpoint (or compute client-side via existing app_settings query + env probe through an admin function) to show the **resolved** address plus a "destination_not_configured" warning banner when neither source is set. Scope: read-only badge above the omnibus card.

## 5. Docs

`docs/theo-odoo-integration.md`:
- §2 Prerequisites: omnibus preferred, env fallback, 503 `destination_not_configured`.
- §5.3: remove env-only language; reference `off_ramp.stellar_address`.
- §1 diagram: wire → `/theo-api-pay-bank`.
- §6 error table: align to the code map above.
- §12.3: add explicit HTG-C convert step.

`src/pages/DocsOdoo.tsx` — sync error-codes section with the same table.

## 6. Ops / deploy

- Verify `app_settings.owlting_omnibus_address` is set on prod (already seeded to `GDXYHOGRCS5AU745ZAIWVYI2TZ5TFZPZPGTLKOYRMYI2UHWSGJBTCEAW`); env fallback also already set.
- Deploy: `theo-api-quote`, `theo-api-pay`, `theo-api-pay-bank`, `theo-api-payments`, `theo-api-wallets`, `theo-api-convert`, `theo-api-ping`.

## Acceptance checks (curl against deployed BASE)

1. `GET /theo-api-wallets` → `off_ramp.stellar_address` populated.
2. Monterrey-style local MXN quote → 200 with `quote_id`, **not** 500.
3. Temporarily wipe both omnibus + env → 503 `{ code: "destination_not_configured" }`.
4. Miami wire quote → still 200 + 200 pay-bank.
5. HTG-C: quote → convert (`READY_TO_PAY`) → pay-bank.
6. Reopen wizard after `quote_expires_at` → new `quote_id`, no 410 on convert.

## Out of scope

- Odoo plugin changes (separate repo).
- Removing the legacy `OWLTING_OFFRAMP_STELLAR_ADDRESS` env entirely — kept as deprecated fallback.
- Mainnet provisioning.
