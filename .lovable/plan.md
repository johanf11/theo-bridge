## Changes

**1. Unify type display for Odoo transactions (`src/pages/Transactions.tsx`)**
- In the row renderer that maps `order_kind` → type badge ("Swap" / "Conversion" / etc.), add a precedence check: if `reference_number` starts with `THEO-ODO-`, render the type badge as **"Odoo"** regardless of the underlying `order_kind`.
- Use the existing `tx.type.odoo` i18n key already added previously.
- Keep the "Odoo" filter behavior unchanged (still matches `THEO-ODO-*`).

**2. Database cleanup**
- Delete all `THEO-ODO-*` orders currently in `QUOTED` status (the "Awaiting payment" rows visible in the screenshot — e.g. `THEO-ODO-5X3D3K`, `THEO-ODO-XKGV2M`, and any others) via the insert/delete tool.

No edge function or schema changes.
