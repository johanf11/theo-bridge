## Add "Lifetime Savings" stat card to Dashboard

Show users how much they've saved vs a 5% market FX baseline across all completed conversions.

### Calculation
For each completed order:
```
savings = usdc_amount * 0.05 - usdc_amount * (totalBps / 10_000)
```
where `totalBps = customer.fee_bps + customer.corridor_bps` (defaults 130 + 70 = 200, matching `Convert.tsx`). Fetch all completed orders' `usdc_amount` for the customer and sum.

### Edits in `src/pages/Dashboard.tsx`

1. **Imports**: add `Info` from `lucide-react` and `Tooltip*` from `@/components/ui/tooltip`.
2. **Customer type**: add `fee_bps: number | null; corridor_bps: number | null`.
3. **State**: add `lifetimeSavings` (number).
4. **Customer select**: include `fee_bps, corridor_bps`.
5. **Fetch**: add a query for `orders` where `customer_id = c.id` and `status = 'COMPLETED'` selecting `usdc_amount`. Compute savings with the formula above using the customer's bps (fallback 200) and store the sum.
6. **UI**: insert a new stat card in the existing grid (before "Transactions"). Update grid columns: `grid-cols-5` → `grid-cols-6` when `hasYield`, else `grid-cols-4` → `grid-cols-5`.
   - Background: `#EFFBF3` (subtle green for "gain").
   - Eyebrow: `LIFETIME SAVINGS` with a small `Info` Lucide icon wrapped in a Tooltip explaining: "We calculate this by comparing our low fees to the 5% average markup charged by traditional banks and wire services."
   - Big number: `$X,XXX.XX` in green (`hsl(150 70% 25%)`).
   - Subtext: `Compared to standard 5% market FX rates`.
7. The value updates automatically because it's derived from fetched orders in the same effect.

### Constraints honored
- Uses semantic Theo tokens for surrounding chrome; the green tint is the accepted "success" color already used elsewhere on the page (`#EFFBF3`).
- No gradients, no purple, Lucide icon only.