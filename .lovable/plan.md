
# End-to-end Stellar testnet release

Goal: take an order all the way from `QUOTED → FUNDED → RELEASING → COMPLETED` with a real Stellar testnet transaction hash.

## 1. Secrets to add (build mode)

- `STELLAR_DISTRIBUTOR_SECRET` — `S…` secret key of the Theo testnet distributor account.
- `STELLAR_USDC_ISSUER` — `G…` issuer of the test USDC asset (we'll use one we control on testnet so we can mint freely).
- `STELLAR_NETWORK` — defaults to `"testnet"` if unset.

I'll prompt for these via `add_secret` once we enter build mode.

## 2. Edge function: `simulate-spih-payment`

Path: `supabase/functions/simulate-spih-payment/index.ts`

- POST `{ orderId }`. Validates JWT, checks `has_role(uid, 'admin')`.
- Conditional update: `orders SET status='FUNDED', funded_at=now() WHERE id=:id AND status='QUOTED'` (idempotent lock).
- If row updated: invoke `release-usdc` with the same `orderId` (fire-and-forget via `supabase.functions.invoke`).
- Returns `{ ok: true, status: 'FUNDED' }`.

## 3. Edge function: `release-usdc`

Path: `supabase/functions/release-usdc/index.ts`

- POST `{ orderId }`. Service-role internal — admin JWT or shared check.
- Conditional update: `status='RELEASING' WHERE id=:id AND status='FUNDED'` to lock.
- Load order + customer (`stellar_wallet_address`, `usdc_amount`, `reference_number`).
- Build with `npm:@stellar/stellar-sdk`:
  - `Server('https://horizon-testnet.stellar.org')`
  - load distributor account
  - `Operation.payment({ destination, asset: new Asset('USDC', issuer), amount })`
  - `Memo.text(reference_number)` for idempotent reconciliation
  - sign with `Keypair.fromSecret(...)`, network = `Networks.TESTNET`
  - submit to Horizon
- Success: `status='COMPLETED'`, `stellar_tx_hash=<hash>`, `released_at=now()`, `completed_at=now()`.
- Failure: `status='FAILED'`, `failure_reason=<error>`.

`supabase/config.toml` gets entries for both functions (verify_jwt = false, validate in code).

## 4. UI: `src/pages/OrderStatus.tsx`

- Add admin-only "Simulate SPIH payment received" button when `status === 'QUOTED'`. Calls `supabase.functions.invoke('simulate-spih-payment', { body: { orderId } })`.
- Add a `RELEASING` info card (spinner + "Sending USDC on Stellar testnet…").
- Existing realtime subscription will auto-render `COMPLETED` + tx hash + stellar.expert link.

## 5. UI: `src/pages/Convert.tsx` — wallet capture for test KYB

- Extend the existing "Approve test KYB" helper with a Stellar `G…` address input that writes `customers.stellar_wallet_address` alongside flipping `kyb_status='APPROVED'` (admin-only path).

## 6. Setup steps you'll run once

I'll include this as a short section in `HANDOFF.md`:

1. Generate distributor keypair at https://laboratory.stellar.org → Account creation → Friendbot fund.
2. Establish trustline to `USDC:<your test issuer G…>`.
3. From issuer account, send some USDC to distributor.
4. Generate customer keypair → Friendbot → USDC trustline.
5. Paste customer `G…` into "Approve test KYB" on `/convert`.
6. Add `STELLAR_DISTRIBUTOR_SECRET` + `STELLAR_USDC_ISSUER` secrets when prompted.

## Test flow

`/convert` → quote 1,000 USDC → `/orders/:id` → "Simulate SPIH payment" → watch `FUNDED → RELEASING → COMPLETED` live → click tx hash → stellar.expert/testnet shows the USDC payment.

## Files to add / edit

- `supabase/functions/simulate-spih-payment/index.ts` (new)
- `supabase/functions/release-usdc/index.ts` (new)
- `supabase/config.toml` (add function blocks)
- `src/pages/OrderStatus.tsx` (admin button + RELEASING card)
- `src/pages/Convert.tsx` (wallet address in test-approve helper)
- `HANDOFF.md` (testnet setup steps)

## Out of scope (next round)

- Real SPIH CSV import + matcher.
- `job_queue` worker / scheduled retries (we invoke `release-usdc` inline for now).
- Customer-side wallet self-service in `/kyb`.
- Refund path on `FAILED`.
