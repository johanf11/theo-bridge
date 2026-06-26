## Goal
For the demo, Theo charges no fee on Odoo-originated payments. Owlting's crypto→fiat fee is handled separately by Owlting and not by Theo.

## Change
In `supabase/functions/theo-api-quote/index.ts`:

- Force `theoBps = 0`, `corrBps = 0`, `totalBps = 0` (ignore the customer's `fee_bps` / `corridor_bps` for this code path).
- Result: `feeUsd = 0`, `theoFeeUsdc = 0`, `totalDebitUsd = amountUsd`, and for HTG-C sources `debitHtgc = amountUsd * rate`.
- Order row written with `fee_bps = 0`, `theo_fee_bps = 0`, `corridor_bps = 0`, `fee_usdc = 0`, `theo_fee_usdc = 0`.
- Response shape unchanged (`fee_usd: 0`, `total_debit_usd === amount_usd`).

Then redeploy `theo-api-quote`.

## Out of scope
- No change to `Convert` / on-app flows — fees stay as configured there.
- No change to `theo-api-pay` (it just executes the quoted order).
- No change to receipt template — it will simply render $0.00 fee for these orders.
- No retroactive edit of already-completed Odoo orders (e.g. THEO-ODO-SPBVTQ).
