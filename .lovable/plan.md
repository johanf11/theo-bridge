## Problem

Yield positions accrue continuously (computed from `deposited_at` × `net_apy`), but accrued earnings are only visible on the **Balance** page inside the Yield panel. On **Transactions**, the yield row only shows the original deposit amount with status "EARNING" — there is no indication that earnings have grown. On **Dashboard**, yield is not surfaced at all.

After a day of accrual, the user reasonably expects to see "you earned $X" somewhere prominent.

## Plan

### 1. Transactions page — show accrued earnings on each yield row

In `src/pages/Transactions.tsx`, enrich the yield rows built from `blend_positions`:

- Compute `accrued = deposited * (e^(net_apy * years) - 1)` using `deposited_at` and `net_apy` (same formula already used in `useBlendPositions` and `blend-positions` edge function — keep this consistent).
- Add `accrued` and `net_apy` to the merged transaction row.
- Update the **Details** column for `tx.type === "yield"` to read:
  `From {wallet} → Yield treasury · +{fmtUSDC(accrued)} earned ({netApy*100}% APY)`
- Update the status pill from "EARNING" to a live value like `+$0.42 earned` so the table communicates the gain at a glance. Keep the green "Yield Sweep" type chip.
- Tick the page once per minute (lightweight `setInterval`) so accrued numbers update without a refresh, matching the existing live-tick pattern in `useBlendPositions`.

### 2. Dashboard — add a compact "Yield earned" stat

In `src/pages/Dashboard.tsx`, add a small KPI card next to the existing balance/activity stats:

- Use the existing `useBlendPositions` hook (already returns live-accrued positions and APY).
- Show two numbers:
  - **Total earning**: sum of `deposited + accrued` across positions
  - **Earned so far**: sum of `accrued` (highlighted in green/cyan, with `+` prefix)
  - Subtitle: `{netApy*100}% net APY · since {earliest depositedAt, formatted}`
- Click-through navigates to `/balance` Yield panel.
- If user has no positions, hide the card (don't push the "earn yield" CTA here — that already lives on Balance).

### 3. No backend changes

`blend-positions` already returns `deposited_at`, `net_apy`, and `last_synced_at`. All accrual math is client-side and consistent with the existing implementation. No migrations, no edge function changes.

## Files touched

- `src/pages/Transactions.tsx` — enrich yield rows with live accrued amount + APY in details column and status pill; add 60s tick.
- `src/pages/Dashboard.tsx` — add "Yield earned" KPI card backed by `useBlendPositions`.

## Out of scope

- Changing accrual model (still continuous compounding at `net_apy`).
- New transaction types for "yield accrual events" — accrual is continuous, not discrete, so we display it as a live number rather than synthesizing fake transactions.
