## Move funds between accounts

Today, customers can fund a wallet (Convert), pay external recipients (Payout), sweep into Yield, and withdraw from Yield — but they cannot shift USDC from one of their own wallets to another (e.g. Operations → Reserve). This plan adds that.

### UX

On `/balance`:

1. New header button **"⇄ Move funds"** next to "+ Fund wallet" / "+ Add account".
2. Each wallet card and each ledger row gets a small **"Move"** action that opens the same modal pre-filled with the source.
3. Modal: **Move between accounts**
   - From: dropdown of the customer's wallets (defaults to the row clicked)
   - To: dropdown of the customer's *other* wallets
   - Amount in USDC (with **Max** chip — capped at source's available balance)
   - Optional memo (max 28 chars, Stellar text-memo limit)
   - Helper line: "On-chain Stellar transfer · Settles in seconds · No fee"
   - Buttons: Cancel / **Move $X →**
4. On success: toast "Moved $X from A to B · `<hash>`", balances + ledger refresh, modal closes.

Permission: gated by the existing `payout_send` permission (same risk class as sending USDC).

### Transactions log

Moves show up in `/transactions` as a new type **"Transfer"** (cyan badge, like Yield), with details `From <A> → <B>` and the Stellar tx hash as the receipt. The existing `payouts` table is the cleanest place to record these (one row per move) — we'll set `recipient_name` to the destination wallet's label and `memo` to `"internal-transfer"` so we can distinguish them in the UI.

### Backend — new edge function `move-funds`

Mirrors `send-payment` but enforces destination is one of the caller's own wallets:

```
POST /functions/v1/move-funds
Body: { sourceWalletId, destinationWalletId, amount, memo? }
```

Steps:
1. Auth caller, look up `customers.id` for `auth.uid()`.
2. Load source wallet — must belong to customer, must have `stellar_secret`.
3. Load destination wallet — must belong to same customer, must have `stellar_address`, must differ from source.
4. Validate amount > 0; let Horizon reject if insufficient (no need to pre-check).
5. Insert `payouts` row (PENDING) with:
   - `recipient_name` = dest wallet label
   - `recipient_address` = dest stellar address
   - `memo` = `"internal-transfer"` (so the UI can identify it)
   - `source_wallet_id` = source
6. Build + sign + submit Stellar USDC payment from source → destination, with optional user memo (truncated to 28 chars).
7. On success: update payout to COMPLETED with `stellar_tx_hash`. On failure: FAILED + `failure_reason`.
8. Return `{ ok, hash, payoutId }`.

No DB schema changes needed.

### Transactions page changes

In `src/pages/Transactions.tsx`, when fetching payouts also classify rows where `memo === 'internal-transfer'` as `type: "transfer"`:
- New badge: "Transfer" in cyan
- Details cell: `From <source label> → <recipient_name>` (we already join source wallet by id)
- Add "Transfer" to the Type filter dropdown

### Files

**New**
- `supabase/functions/move-funds/index.ts`

**Edited**
- `src/pages/Balance.tsx` — add Move modal + button + handler, wire `move-funds` invoke
- `src/pages/Transactions.tsx` — recognize internal-transfer payouts, render Transfer badge, extend filter

### Out of scope

- Cross-currency moves (still USDC only)
- Scheduling / recurring transfers
- Bulk transfers
