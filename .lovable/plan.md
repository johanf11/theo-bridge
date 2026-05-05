## Problem

Two issues with the HTG-C ↔ USDC swap flow:

1. **UX bug** — the "Retry payout" button on `/transactions` is visible to any authenticated user (the `isAdmin` check works, but conceptually retrying a half-failed swap is an internal operations action, not a customer one). Customers should never see it.
2. **Critical safety bug** — in `execute-swap`, if leg 1 succeeds (user → distributor) but leg 2 fails (distributor → user), the order is marked `FAILED` and the user's funds are left sitting in the distributor account. With real money this is catastrophic. The code already has a recovery path (`admin-refund-distributor`, `retry-swap-payout`) but it's manual.

## Fix

### 1. Auto-refund leg 1 when leg 2 fails (`supabase/functions/execute-swap/index.ts`)

When the leg-2 try/catch catches an error, before persisting the order, attempt a compensating refund:
- Reload distributor account, build a payment back to `wallet.stellar_address` for `sourceAmount` of `sourceAsset`, memo `reference` + `-RFND`, sign with distributor key, submit.
- If refund succeeds → mark order `REFUNDED` (or keep `FAILED` with a clear `failure_reason: "Leg 2 failed: <err>. Auto-refunded leg 1 in tx <hash>"` and store the refund hash). User ends up net-zero on chain.
- If refund itself fails → mark `FAILED`, set `failure_reason` to include both the leg-2 error AND the refund error, and surface a clear message so ops knows manual intervention is needed.
- Wrap in its own try/catch so a refund exception never crashes the response.

Return shape on partial failure becomes `{ error, orderId, leg1Hash, refundHash?, refundFailed? }` so the UI can show "Swap failed — funds returned to wallet" instead of a scary "Swap partially failed".

### 2. Improve client-side error message (`src/pages/Convert.tsx` or wherever swap result is handled)

When the swap response includes `refundHash`, show a non-alarming toast: "Swap couldn't complete — your funds were returned to your wallet." When refund also failed, show "Swap failed and funds are stuck — Theo support has been notified" (and optionally insert a row into a support/incidents table — out of scope for this pass; just log loudly).

### 3. Remove "Retry payout" button from customer UI (`src/pages/Transactions.tsx`)

- Delete the retry button block (lines ~364-378), the `retryingId` state, the `handleRetry` function, and the `isAdmin` lookup if it has no other consumer on this page.
- The `retry-swap-payout` edge function stays deployed for now (admin tooling) — it's just not surfaced anywhere in the customer app. When proxy-mode lands later, it can be wired into the admin/proxy view.

### 4. Note on existing FAILED orders

The current FAILED orders (e.g. SWP-4C9CE718) were created before auto-refund existed. They stay as-is — the 80K USDC has already been manually refunded. No data migration needed.

## Files touched

- `supabase/functions/execute-swap/index.ts` — add auto-refund block between leg-2 catch and order insert
- `src/pages/Transactions.tsx` — remove retry button, related state, handler, and the now-unused admin lookup
- `src/pages/Convert.tsx` (or the swap caller) — read `refundHash`/`refundFailed` from the response and adjust the toast

## Out of scope

- Proxy/impersonation mode for admins (future work, as you mentioned)
- Moving the retry tool into a dedicated admin console
- Database column for `REFUNDED` status (keeping `FAILED` + descriptive `failure_reason` keeps the existing enum intact)
