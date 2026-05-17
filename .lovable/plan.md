## Goal
Let users reorder wallet cards on the Balance page by pressing and holding a card, then dragging it into a new position. Order persists across reloads.

## UX
- Press and hold (~250ms) on any wallet card to "pick it up" — card lifts slightly (scale + shadow), cursor becomes grabbing.
- Drag over another card to see live reordering with a smooth animation.
- Release to drop. New order saves immediately to the database.
- Works on both desktop (mouse) and mobile (touch).
- Clicking normally (without holding) still opens/uses the card as today — hold delay prevents accidental drags.
- Applies to both the top wallet grid (lines ~569) and the wallet detail list below (line ~729), kept in sync.

## Persistence
Add a `display_order` integer column to the `wallets` table. On reorder, update the affected rows' `display_order`. Wallets are fetched ordered by `display_order` (with `created_at` as fallback for legacy rows).

## Technical details
- Library: `@dnd-kit/core` + `@dnd-kit/sortable` (lightweight, accessible, supports press-delay activation on both pointer and touch sensors).
- Add `PointerSensor` with `activationConstraint: { delay: 250, tolerance: 5 }` so a hold is required.
- Wrap wallet lists in `<DndContext><SortableContext>`; each card becomes a `useSortable` item.
- On `onDragEnd`, reorder local state with `arrayMove`, then `upsert` the changed rows' `display_order` values to Supabase.
- Migration: `ALTER TABLE wallets ADD COLUMN display_order integer`; backfill existing rows with row_number ordered by created_at per customer.
- Update Balance.tsx fetch query to `.order("display_order", { ascending: true, nullsFirst: false }).order("created_at")`.

## Steps
1. DB migration: add `display_order` column, backfill, no RLS change needed (existing wallet policies cover it).
2. Install `@dnd-kit/core` and `@dnd-kit/sortable`.
3. Refactor wallet card render in Balance.tsx into a `SortableWalletCard` component used inside `SortableContext`.
4. Add `handleDragEnd` that calls `arrayMove`, updates state, and persists new `display_order` values.
5. Apply same treatment to the lower wallet list so both stay consistent.
