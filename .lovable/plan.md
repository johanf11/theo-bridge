## What to build

### 1. Fix the "verify on-chain" link in `src/pages/Convert.tsx`
The link currently points to the distributor account, which only shows treasury float — not total in circulation. Change it to point to the **HTG-C asset page** on Stellar Expert, which is the canonical place to see total supply + every holder:

```
https://stellar.expert/explorer/testnet/asset/HTGC-{HTGC_ISSUER}
```

Reuse the existing `HTGC_ISSUER` constant from `supabase/functions/_shared/stellar-assets.ts` (already imported in `src/lib/balance.ts`).

### 2. Add a Proof of Reserve panel to `src/pages/Compliance.tsx`
A new card at the top of the page showing three live numbers side-by-side:

- **HTG-C in circulation** — fetched live from Horizon: `GET /assets?asset_code=HTGC&asset_issuer={HTGC_ISSUER}` → `amount` field.
- **HTG in segregated bank** — pulled from a new `reserve_attestations` table (latest row), with attestation period label (e.g. "Q2 2026").
- **Collateral ratio** — `bank / minted * 100`, color-coded:
  - ≥ 100.00%: green ✓
  - 99.00–99.99%: amber
  - < 99.00%: red

Two CTAs below:
- "Verify on-chain ↗" → asset page link above
- "Download attestation (PDF) ↗" → uses `attestation_pdf_url` from the latest attestation row

### 3. New table: `reserve_attestations`
Stores each quarter's attested bank balance. Admin-writable, public-readable.

```text
id                uuid (pk)
period_label      text          e.g. "Q2 2026"
attested_at       timestamptz   when the auditor signed
htg_balance       numeric       HTG held in segregated account
auditor_name      text
attestation_pdf_url text         public link to signed PDF
created_at        timestamptz
```

RLS:
- SELECT: anyone authenticated (and we'll keep it readable on /compliance which is already auth-gated).
- INSERT/UPDATE/DELETE: admins only.

Seed with one demo row matching current testnet supply.

### 4. Existing distributor reference
Keep the distributor balance display elsewhere on `/compliance` if it exists, but relabel it "Treasury float" so it's not confused with circulating supply.

## Why issuer (not distributor)

- **Issuer asset page** = total minted minus burned = exactly what must match HTG in bank.
- **Distributor account** = only HTG-C sitting in Theo's treasury wallet, *not* the tokens already in customer wallets. Linking distributor would understate the obligation and confuse anyone trying to verify.

## Files touched

- `src/pages/Convert.tsx` — swap one URL.
- `src/pages/Compliance.tsx` — add Proof of Reserve card; relabel distributor section if present.
- `supabase/migrations/<timestamp>_reserve_attestations.sql` — new table + RLS + seed row.

## Out of scope

- Mainnet asset URL (still testnet for now — switch when going live).
- Auditor upload UI (admins seed rows via SQL for now; can add later).
- Historical attestations list (just show the latest for now).
