## Bug

The "Converted this month" card on `/dashboard` is wrong because:

1. It sums only the **5 most recent** orders (the dashboard only fetches `limit(5)` for the recent-tx feed). Any conversion older than the 5 most recent is excluded.
2. It sums `usdc_amount` and prefixes the value with `$`, but conversions are HTG → HTG-C. The right field is `htg_amount` and the right unit is HTG-C.
3. The "Transactions · Last 30 days" card has the same problem — it only counts the 6 merged items, not real 30-day activity.

## Fix

In `src/pages/Dashboard.tsx`:

- Add a second, dedicated query for this month's completed conversions:
  ```
  orders WHERE customer_id = c.id
         AND status = 'COMPLETED'
         AND created_at >= <first of this month>
  ```
  Sum `htg_amount` across all rows. Store in state.
- Add a 30-day count query (orders + payouts since now-30d) for the "Transactions" card.
- Render the converted total as `{amount.toLocaleString(...)} HTG-C` (drop the `$`). Keep the same typography.
- Keep the existing 5-row recent-tx feed unchanged.

## Files touched

- `src/pages/Dashboard.tsx` — replace the in-memory derivation with the two scoped queries and update the two cards.

No DB changes.
