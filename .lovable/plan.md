## Goal

Replace the stubbed `handleSweep` in `src/pages/Balance.tsx` with a real Soroban contract call to a Blend Capital lending pool on Stellar testnet. Same pattern as `send-payment`: signing happens server-side in an edge function using the wallet's `stellar_secret`, so the browser never touches keys.

## Approach

Mirror the existing `send-payment` architecture. Create two new edge functions that wrap the Blend SDK and a new `blend_positions` table to track on-chain state. Wire the UI to invoke them and refresh real positions instead of mutating local React state.

## Backend

### 1. Migration — `blend_positions` table

```text
blend_positions
  id              uuid pk
  customer_id     uuid -> customers(id)
  wallet_id       uuid -> wallets(id)
  pool_address    text                 -- Blend pool contract id
  reserve_asset   text default 'USDC'
  deposited_usdc  numeric(20,7) default 0
  last_tx_hash    text
  last_synced_at  timestamptz
  created_at, updated_at
  unique (wallet_id, pool_address)
```

RLS: customers can SELECT their own rows (via `customer_id` -> `customers.user_id = auth.uid()`); writes only via service_role.

### 2. Edge function `blend-sweep`

Path: `supabase/functions/blend-sweep/index.ts`

- Auth: verify caller JWT, resolve `customer_id`.
- Body: `{ sourceWalletId, amount }`. Validate with Zod; amount > 0.
- Load wallet (must belong to customer) → get `stellar_address` + `stellar_secret`.
- Build Soroban tx using `npm:@blend-capital/blend-sdk` and `npm:@stellar/stellar-sdk@12.3.0`:
  - Use Blend testnet pool address (from SDK constants or env `BLEND_POOL_ADDRESS`).
  - Build `RequestType.SupplyCollateral` (or `Supply`) request via `PoolContractV1.submit({ from, spender, to, requests: [{ request_type, address: USDC_ASSET_ADDRESS, amount }] })`.
  - Wrap with `SorobanRpc.Server('https://soroban-testnet.stellar.org')`, simulate → assemble → sign with `Keypair.fromSecret` → submit → poll until success.
- On success: upsert `blend_positions` row (add to `deposited_usdc`, store `last_tx_hash`, `last_synced_at = now()`).
- Return `{ ok, hash, position }`.
- On failure: return 502 with the Soroban diagnostic event message; do not write to DB.

### 3. Edge function `blend-withdraw`

Path: `supabase/functions/blend-withdraw/index.ts`

- Same auth/loading.
- Body: `{ walletId, amount }` (amount can be `"max"` → use position's deposited+accrued from on-chain query).
- Build a `RequestType.Withdraw` (or `WithdrawCollateral`) submit call against the same pool, signed by the wallet keypair.
- On success: subtract from `deposited_usdc`; if 0, delete row. Update `last_tx_hash`.

### 4. Edge function `blend-positions`

Path: `supabase/functions/blend-positions/index.ts`

- GET, returns the customer's live positions:
  - Read `blend_positions` rows (per wallet).
  - For each, query the Blend pool via SDK (`Pool.load` → `pool.loadUser(address)`) to get the *current* supply balance in USDC (principal + accrued interest in bToken units, converted to underlying).
  - Return `[{ walletId, walletLabel, deposited, current, accrued, apy }]`. Pull pool APY from `pool.metadata` / reserve data so the UI no longer hard-codes 9.2%.

### 5. config.toml

Add three function blocks with `verify_jwt = false` (we validate inside the function), matching existing convention.

## Frontend (`src/pages/Balance.tsx`)

- Remove local `BlendPosition` state mutation. Replace with a `useBlendPositions()` hook that calls the `blend-positions` edge function and refreshes after sweep/withdraw.
- Replace `BLEND_APY` constant with the live APY returned by the function (fall back to a sensible default while loading).
- `handleSweep`:
  ```ts
  const { data, error } = await supabase.functions.invoke("blend-sweep", {
    body: { sourceWalletId: sweepWallet.id, amount: sweepAmountNum },
  });
  if (error) return toast.error(error.message);
  await Promise.all([refreshTotal(), loadWallets(), refreshBlend()]);
  toast.success(`Swept · tx ${data.hash.slice(0,8)}…`);
  ```
- `handleWithdraw`: same pattern against `blend-withdraw`, `{ walletId, amount: "max" }`.
- After both actions, re-fetch live Horizon balances so the wallet card drops by the correct amount (no manual `setBalances` math).

## Secrets to add

- `BLEND_POOL_ADDRESS` — testnet Blend pool contract id (e.g. the public USDC pool from blend.capital docs). I'll prompt via `add_secret` if it's not present.
- `BLEND_USDC_ASSET_ADDRESS` — Soroban asset contract id for testnet USDC (matches `STELLAR_USDC_ISSUER` wrapped). Optional — can derive at runtime via `Asset.contractId(networkPassphrase)`.

`STELLAR_USDC_ISSUER` and `STELLAR_DISTRIBUTOR_SECRET` are already configured.

## Out of scope

- Multi-pool selection UI — sweeping always targets one configured pool.
- Mainnet support.
- Auto-sweep rules / scheduled rebalancing.
- Position interest accrual chart.

## Files to add / edit

- `supabase/migrations/<ts>_blend_positions.sql` (new)
- `supabase/functions/blend-sweep/index.ts` (new)
- `supabase/functions/blend-withdraw/index.ts` (new)
- `supabase/functions/blend-positions/index.ts` (new)
- `supabase/config.toml` (add 3 function entries)
- `src/hooks/useBlendPositions.ts` (new)
- `src/pages/Balance.tsx` (replace stub handlers + remove hard-coded APY)

## Test plan (testnet)

1. Confirm distributor + a customer wallet have USDC trustline + balance.
2. UI → "Sweep to Blend" 100 USDC → expect Horizon balance to drop, `blend_positions.deposited_usdc=100`, tx visible on stellar.expert/testnet (Soroban invoke).
3. Reload Balance page → live position pulled from on-chain shows ≥100 USDC supplied.
4. "Withdraw" → balance returns, row deleted, tx hash visible.
5. Failure path: try sweep with 0 trustline → function returns 502 with diagnostic, UI toasts the error, no DB row.
