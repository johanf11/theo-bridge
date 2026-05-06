## Goal

In `src/pages/Convert.tsx`, on the "Deposit HTG → USDC" sub-mode (tab `htg` with `htgReceiveMode === "usdc"`), replace the single "HTG to deposit" input with a Coinbase-style two-field widget where the user can type in either HTG or USDC and the other field auto-fills using the live rate and fee.

The HTG-C 1:1 mint sub-mode is unchanged.

## Widget UX

```text
┌─────────────────────────────────────────┐
│  You send                               │
│  [ 130,870 ]                   HTG      │
├──────────────── ↕ ──────────────────────┤
│  You receive                            │
│  [ 1,000.00 ]                  USDC     │
└─────────────────────────────────────────┘
```

- One outer rounded card; two stacked rows separated by a hairline divider.
- Centered round `↕` icon button (`ArrowUpDown` from lucide-react) overlapping the divider. Visual only — clicking it does nothing functional (stays inert; can be `aria-disabled`).
- Both fields are editable text inputs with thousands-comma formatting; HTG shows 0 decimals, USDC shows up to 2.
- The field the user is NOT currently typing in is rendered in a slightly muted color (e.g. `hsl(var(--theo-mid))`) but remains an editable input — focusing it makes it the active field.
- Right-aligned currency label (HTG / USDC) inside each row.

## Math

Constants already present: `liveRate`, `feeBps`, `corridorBps`, `totalBps = feeBps + corridorBps`.

Let `f = totalBps / 10_000` (≈ 0.022 at 220 bps).

- User edits HTG (`htgAmountRaw`):
  - `usdcGross = htgAmountRaw / liveRate`
  - `usdcNet   = usdcGross * (1 - f)`  → shown in USDC field
- User edits USDC (treated as net the user receives):
  - `usdcGross    = usdcNet / (1 - f)`
  - `htgAmountRaw = usdcGross * liveRate`  → shown in HTG field

A small `lastEdited: "htg" | "usdc"` state tracks which side drives the other. Updates propagate on every keystroke (200 ms debounce is fine; immediate is also acceptable since math is cheap). When `liveRate` or `totalBps` changes, recompute the derived field from the last-edited side.

## Fee line (kept, slightly relabelled)

Below the widget, inside the existing blue quote box, show:

```
Theo fee (2.20%)    − $22.00 USDC
You receive net       $978.00 USDC
```

The 2.20% comes from `totalBps / 100`. Net = `usdcNet`, fee = `usdcGross - usdcNet`. Existing "Rate" and "Quote lock" rows remain.

The current "You receive (≈)" row in the quote box is removed (the widget itself shows it).

## Submit

`handleHtgSubmit` (USDC branch, lines 357–383) keeps the same shape but now sends the **gross** USDC:

- `usdc_amount: usdcGross` (rounded to 7 decimals to match Stellar precision)
- Validation: `usdcGross` must be between 1,000 and 50,000 (matches existing min/max). Show the existing toast on violation.
- Destination wallet selector, KYB gate, rate-source badge, corridor sidebar — all unchanged.

The edge function (`create-quote`) already treats incoming `usdc_amount` as gross and deducts the fee server-side, so no backend change is needed.

## Out of scope

- HTG-C 1:1 mint sub-mode UI
- Tab 2 (swap) and Tab 3 (off-ramp)
- Any backend / migration changes

## Files touched

- `src/pages/Convert.tsx` — widget JSX, state (`lastEdited`, `usdcNetRaw`, `usdcNetDisplay`), input handlers, fee-line tweak, submit payload.

No new dependencies (`ArrowUpDown` already exists in `lucide-react`).
