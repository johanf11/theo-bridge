## Allow 50,000 USDC net to actually go through

The backend already permits gross up to 52,000 USDC (so net 50,000 after the ~2% fee). The frontend is rejecting the gross amount before it reaches the backend.

### Edits in `src/pages/Convert.tsx`

1. **Line 255** — USDC tab `submit()`: change `usdcRaw > 50000` → `usdcRaw > 52000`.
2. **Line 466** — `handleHtgSubmit()`: change `usdcGrossRounded > 50000` → `usdcGrossRounded > 52000`.
3. **Lines 400–403** — HTG input cap: compute the max HTG so the resulting **net** USDC is 50,000:
   ```
   maxGross = 50_000 / (1 - totalBps/10_000)
   maxHtg = floor(maxGross * liveRate)
   ```
   instead of capping at `50_000 * liveRate` (which caps gross, not net).

The USDC-net input cap (lines 425–430) already correctly limits **net** to 50,000 — leave unchanged. No backend changes needed.