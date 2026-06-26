## Root cause

Odoo `Pay with Theo` (HTG‑C → USDC → wire to Owlting) failed on `THEO-ODO-GPK3W7` ($48,000 → 49,200 USDC incl. 0.5% platform fee). The quote succeeded, but the USDC payment in `theo-api-pay-bank` was rejected by Horizon with:

- `transaction: tx_failed`
- `operations: ["op_no_destination"]`

Reason: the Owlting omnibus address
`GDLAQLNZNXLDJ2J2LDG3J5EAYAKAHAUSDFTKURMNED2J7LXJ7UET65RQ`
configured in `app_settings.owlting_omnibus_address` does **not exist** on Stellar testnet (Horizon returns 404). An unfunded account cannot receive USDC, and even after funding it still needs a USDC trustline.

The order is now `status = FAILED` with `failure_reason` set. No USDC was sent; on‑chain state is clean. The DB row needs to be reconciled (any HTG‑C debit reversed if posted) so the customer ledger matches reality.

## Plan

### 1. Provision the Owlting omnibus account on testnet (one‑time fix)

Create a new edge function `admin-provision-owlting` (admin‑gated, like `admin-setup-wallet`) that:

1. Reads `app_settings.owlting_omnibus_address`.
2. If the account is missing on Horizon, calls Friendbot to fund it. If the account has no `STELLAR_OWLTING_OMNIBUS_SECRET` configured, returns a clear error explaining we don't control the keypair and need a different demo address we own.
3. Adds a USDC trustline (asset = `USDC` / `STELLAR_USDC_ISSUER`) signed by the omnibus secret.
4. Optionally adds HTG‑C trustline for symmetry.
5. Returns the resulting balances + trustlines.

Because the current omnibus pubkey was supplied externally (Owlting), the matching secret almost certainly isn't in our secrets. Two options for the demo:

- **A. Rotate to a Theo‑managed demo omnibus**: generate a new keypair locally, store the secret as `STELLAR_OWLTING_OMNIBUS_SECRET`, update `app_settings.owlting_omnibus_address` to the new pubkey, then run the provisioner. Recommended — keeps the demo fully self‑contained.
- **B. Keep the Owlting pubkey**: Owlting must fund + trust USDC on testnet themselves. Until they do, every wire payout will fail the same way.

I'll proceed with **Option A** unless you say otherwise.

### 2. Harden `theo-api-pay-bank` against this class of failure

Before submitting the USDC payment, pre‑flight the destination:

- `loadAccount(dest)` → if it 404s, fail fast with `503 destination_not_provisioned` and leave the order in `QUOTED` (not `FAILED`) so a retry works once the omnibus is set up.
- Check that `dest` has a USDC trustline; if missing, same `503` behavior.

This avoids burning quotes (and confusing customers) when the omnibus is misconfigured.

### 3. Reconcile the stuck order `THEO-ODO-GPK3W7`

- Confirm via `ledger_entries` that no HTG‑C was actually debited (the USDC send failed before any ledger post). If a debit did post, write a reversing transaction via `post_ledger_entries`.
- Leave the order as `FAILED` with a human‑readable `failure_reason` ("Owlting omnibus not provisioned on testnet — fixed; please retry from Odoo").
- Odoo can re‑click **Pay with Theo** on BILL/2026/06/0008 to create a fresh quote and complete the payment.

### 4. Redeploy + verify

- Deploy `admin-provision-owlting` and updated `theo-api-pay-bank`.
- Run the provisioner once; assert Horizon now shows the omnibus account with a USDC trustline.
- Curl `theo-api-pay-bank` with a bogus body to confirm it still returns `401 Missing API key` (slug live).
- Ask you to retry the bill in Odoo; expect `status: COMPLETED` with a `stellar_tx_hash`.

## Out of scope

- No changes to `supabase/functions/_shared/*` (per project constraint).
- No schema changes.
- No change to fee structure.

## Confirm before I proceed

1. Go with **Option A** (Theo‑managed demo omnibus, new keypair, update `app_settings`)? Or keep the externally‑provided Owlting pubkey?
2. OK to leave `THEO-ODO-GPK3W7` as `FAILED` and have you click **Retry** in Odoo to issue a fresh quote after the fix?
