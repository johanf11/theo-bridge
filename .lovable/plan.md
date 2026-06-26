## Goal

Bridge: theo-api-quote + theo-api-pay accept Odoo's new memo fields, persist them on `orders`, and attach the correct on-chain memo to USDC wallet→wallet Stellar payouts.

## Schema migration

Add to `public.orders` (nullable, no backfill):
- `vendor_memo TEXT`
- `stellar_memo TEXT`
- `stellar_memo_source TEXT CHECK (stellar_memo_source IN ('vendor','theo_ref'))`

(Reuse existing `reference_number`, `payout_memo`, `payout_memo_type` — keep them populated as today.)

## Shared helper

New file `supabase/functions/_shared/stellar-memo.ts`:

```text
resolveStellarMemo({ referenceNumber, vendorMemo, prePicked? })
  → { memo, source: 'vendor'|'theo_ref', memoType: 'text'|'id' }
validateMemoBytes(memo)  // ≤28 UTF-8 bytes else throws invalid_memo
pickMemoType(memo)       // numeric & ≤ uint64 → 'id', else 'text'
```

Hierarchy: `prePicked` (Odoo's `stellar_memo` on pay) → vendor memo → `reference_number`.

## theo-api-quote changes

- Extract vendor memo from `settlement.beneficiary.memo`, `supplier.memo`, or `supplier.vendor_memo`.
- Validate ≤28 bytes → `invalid_memo` (400) on overflow.
- Resolve `stellar_memo` + `stellar_memo_source` at quote time using helper (vendor wins, else `reference_number`).
- For `rail === 'usdc'`: force `platform_fee_usd = 0` (already true via `calcOwltingPlatformFeeUsd`, confirm).
- Persist new columns on insert; include in `beneficiary_metadata` mirror.
- Extend replay response (`buildQuoteReplayResponse`) and fresh response with: `vendor_memo`, `stellar_memo`, `stellar_memo_source`, `reference_number` (already returned).
- Idempotency seed: include vendor memo so a memo change doesn't replay an old quote.

## theo-api-pay changes

- Accept `theo_reference`, `stellar_memo`, `stellar_memo_source`, `vendor_memo`, `external_invoice_ref`.
- Re-resolve memo via helper: prefer caller's `stellar_memo` if valid, else quote's stored vendor_memo, else `reference_number`. Compute memo type via `pickMemoType` (numeric → MEMO_ID, else MEMO_TEXT).
- Override the existing `payout_memo` / `Memo.text(reference_number)` block to use resolved memo + memo type.
- Persist final `stellar_memo` + `stellar_memo_source` (+ `payout_memo`/`payout_memo_type` mirrors) on the order on COMPLETED.
- Return `reference_number`, `stellar_tx_hash`, `stellar_memo`, `stellar_memo_source`, `settled_at` (= `completed_at`).
- Reject memos >28 bytes with `invalid_memo` (400).

## Stellar tx builder

In theo-api-pay's TransactionBuilder:

```text
if (/^\d+$/.test(memo) && BigInt(memo) <= 9223372036854775807n) Memo.id(memo)
else Memo.text(memo)  // already byte-validated
```

USDC wallet rail must never send a memo-less tx — helper guarantees fallback to `reference_number`.

## Out of scope (do not change)

- `theo-api-convert`, `theo-api-pay-bank`, `theo-api-payments`, `theo-api-wallets`
- Auth / idempotency / wallet endpoints
- HTG-C convert flow except passing through `reference_number` (already does)
- Uncapped Odoo bill amounts

## Acceptance

1. Quote with vendor memo `48291736` → response includes `stellar_memo:"48291736"`, `stellar_memo_source:"vendor"`, `platform_fee_usd:0`.
2. Quote with no vendor memo on `usdc` rail → `stellar_memo == reference_number`, source `theo_ref`.
3. Pay attaches MEMO_ID `48291736` (numeric) or MEMO_TEXT (`THEO-ODO-…`) on Stellar; tx hash visible on Horizon.
4. Memo >28 bytes → 400 `invalid_memo` on quote and pay.
5. `orders` row stores `vendor_memo`, `stellar_memo`, `stellar_memo_source`, plus existing `reference_number`.
