Move the "Doc" button from the Actions column into its own dedicated "Document" column on the Admin KYB table.

**Changes in `src/pages/AdminKyb.tsx`:**
1. Update table headers array: add "Document" between "Status" and "Actions" → 8 columns total.
2. Extract the `viewDoc` button from the Actions `<td>` into a new preceding `<td>`.
3. Update `colSpan` on expanded detail rows from `7` to `8`.