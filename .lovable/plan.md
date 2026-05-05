# Real HTG-C ↔ USDC swaps + Transactions display fixes

Today the Swap tab is a fake `setTimeout` + toast — no funds move on Stellar. We'll wire it to a real edge function that submits actual testnet transactions, persist a swap order, and clean up how `htgc_mint` and the new swap rows render in Transactions.

## What changes

### 1. Database — add `htgc_usdc_swap` to `order_kind`

Single migration that extends the existing enum:
```text
ALTER TYPE order_kind ADD VALUE IF NOT EXISTS 'htgc_usdc_swap';
```
No new columns needed — `orders` already has `htg_amount`, `usdc_amount`, `rate`, `stellar_tx_hash`, `status`, `reference_number`.

### 2. New edge function: `execute-swap`

`supabase/functions/execute-swap/index.ts`, public config block in `config.toml` with `verify_jwt = false` (in-code auth, matching the rest of the project).

**Request body:**
```text
{ wallet_id: uuid, amount: number, direction: "htgc_to_usdc" | "usdc_to_htgc" }
```

**Flow (uses the user's server-stored `stellar_secret` — same model as `move-funds`):**

1. Verify caller's JWT, look up their `customer_id`.
2. Load the wallet row (must belong to caller); fetch `stellar_address` + `stellar_secret`.
3. Pull the latest `rate_snapshots.spot_rate` for pricing.
4. Compute the two legs:
   - `htgc_to_usdc`: user sends `amount` HTG-C to distributor → distributor sends `amount / rate` USDC back to user's address.
   - `usdc_to_htgc`: user sends `amount` USDC to distributor → distributor sends `amount * rate` HTG-C back to user.
5. Auto-establish the destination trustline on the user wallet if missing (reuse the pattern from `move-funds`).
6. Submit **leg 1** (signed by user wallet's `stellar_secret`) → wait for hash.
7. Submit **leg 2** (signed by `STELLAR_DISTRIBUTOR_SECRET`) → wait for hash.
8. Insert a row into `orders`:
   ```text
   order_kind = 'htgc_usdc_swap'
   status = 'COMPLETED'
   htg_amount = <HTG-C side of the swap>
   usdc_amount = <USDC side of the swap>
   rate = <spot_rate used>
   stellar_tx_hash = <leg 2 hash>   (the distributor payout)
   reference_number = SWP-<short id>
   completed_at = now()
   ```
9. If leg 1 succeeds but leg 2 fails: still insert the order with `status = 'FAILED'` and `failure_reason` so it's visible in Transactions and we don't silently lose the user's HTG-C. (Manual reconciliation acceptable for testnet.)
10. Return `{ ok: true, orderId, hash }`.

CORS + error envelope match the existing functions (`release-usdc`, `move-funds`).

### 3. Wire up `Convert.tsx` — Swap tab

Replace the fake `handleSwapSubmit` (lines 396–404) with a real call:
```text
const { data, error } = await supabase.functions.invoke("execute-swap", {
  body: { wallet_id: <selectedSwapWallet>, amount: swapAmountRaw, direction: swapDir },
});
if (error || data?.error) { toast.error(...); return; }
toast.success("Swap completed");
navigate(`/orders/${data.orderId}`);
```

The Swap tab currently doesn't have a wallet selector — it uses an aggregated `walletBalances`. We'll add a small wallet picker to the Swap card (reusing the same `walletOptions` already loaded for the deposit tab) so we know which wallet's keypair signs leg 1. Default to the first wallet.

### 4. Transactions page fixes (`src/pages/Transactions.tsx`)

Two issues to fix in the orders → unified row mapping (~line 80):

- **`htgc_mint` rows show `0.00 USDC`** because `usdc_amount` is null. Fix: when `order_kind === 'htgc_mint'`, render the Amount column as the HTG amount (`fmtHTG(htg_amount)`) instead of `fmtUSDC`. Type badge stays "Conversion" but label could read "HTG-C Mint" for clarity.
- **`htgc_usdc_swap` rows**: add a new `"swap"` branch to the unified type:
  - Type badge: `Swap` (cyan palette to distinguish from Conversion gold).
  - Amount column: USDC side (`fmtUSDC(usdc_amount)`).
  - Details column: `25,000 HTG-C → $383.24 USDC` (or reverse based on direction — derivable from comparing legs, or persist direction in `reference_number` prefix).
  - Reference: `reference_number`.

Also extend `typeFilter` dropdown options to include `"Swap"` and `"HTG-C Mint"`.

Select the order_kind column in the orders query so the mapping has it available.

### 5. Format helpers

`fmtHTGC` already exists in `src/lib/format.ts` — reuse it for the HTG-C side of swap details.

## Files touched

```text
supabase/functions/execute-swap/index.ts        (new)
supabase/config.toml                            (add [functions.execute-swap])
migration                                       (ALTER TYPE order_kind ADD VALUE)
src/pages/Convert.tsx                           (real swap submit + wallet picker)
src/pages/Transactions.tsx                      (htgc_mint + swap row rendering)
```

## Out of scope / accepted trade-offs

- No client-side Stellar signing — relies on the existing server-stored `stellar_secret` model already in use by `move-funds` and `send-payment`.
- No atomic two-leg swap (Stellar path payments would need a DEX order book for HTGC/USDC). If leg 2 fails after leg 1 settled, the order is recorded as `FAILED` with the user's HTG-C now sitting at the distributor — admin reconciles manually. Acceptable for testnet.
- No new `swap_direction` column; direction can be inferred from `htg_amount` vs. `usdc_amount` and the SWP- prefix.
