## Goal

1. The Proof-of-Reserve comparison should use **HTG-C in customer wallets (circulation)**, not total minted. Treasury float is just unissued buffer — it doesn't need bank backing.
2. Remove redundancy in the 4-card stats row. Today: Total Minted (15.79M), In Circulation (11.07M), Treasury Float (4.72M), Backing Ratio. Total Minted = Circulation + Treasury, so it's derivable. Replace it with a non-redundant metric.

## Changes — `src/pages/Compliance.tsx`

### A. Proof-of-Reserve panel (lines ~181–306)

- Change `displayedHtgBalance` and `ratio` to use `reserve.circulation` instead of `reserve.totalMinted`.
- Update the **left side** label from "HTG-C in circulation (on-chain)" — keep label, but value becomes `reserve.circulation` (currently shows totalMinted, which is wrong for the headline).
- Right side stays: shows attested HTG = circulation, so ratio = 100%.
- Result: panel reads `11,075,001 HTG-C = 11,075,001 HTG · 100% collateralised`.

### B. Stats row (lines ~349–376)

Replace the dark-blue "Total HTG-C Minted" card with **"HTG in Bank Reserve"**, sourced from the latest `reserve_attestations.htg_balance` (already fetched as `attestation`):

```
HTG IN BANK RESERVE  (accent / dark blue)
20,000,000  HTG
Q2 2026 · attested by Deloitte Haiti S.A.
```

Final 4 cards:
1. **HTG in Bank Reserve** (accent) — attested bank balance, ties Proof-of-Reserve to a real-world figure.
2. **In Circulation** — HTG-C in customer wallets.
3. **Treasury Float** — distributor pre-mint buffer.
4. **Backing Ratio** — 1 : 1.

This removes the redundant "Total Minted" (= Circulation + Treasury) and surfaces the attested bank reserve instead, which is the most meaningful single number on a transparency page.

## Note

If you'd rather keep "Total Minted" and drop a different card, say which — but Bank Reserve is the strongest replacement because it's the off-chain anchor that backs the on-chain supply.