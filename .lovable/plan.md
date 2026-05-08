# Mobile-Adaptive UI for Theo Dashboard

**Short answer:** Not difficult. The stack (Tailwind + shadcn + a `useIsMobile` hook) is already mobile-ready. The blockers are inline `style={{}}` fixed widths and 2-column grids hard-coded in pixels — not architecture. Estimated scope: ~1 focused pass across the shell + ~5 main pages.

## What's standing in the way today

- `AppLayout` always renders a 196px fixed sidebar (`width: 196`) — on a 430px phone it eats half the screen.
- A second "Mobile header" exists but is shown alongside the desktop sidebar, not instead of it. No hamburger / drawer.
- Pages use inline `gridTemplateColumns: "3fr 2fr"`, `"1fr 1fr"`, `repeat(3, 1fr)` — these never collapse.
- Topbar search has `maxWidth: 380` and the user chip — fine on desktop, cramped on phones.
- Tables (Transactions, Payout history) overflow horizontally with no scroll wrapper or card-stack fallback.
- Modals are mostly OK (already use `maxWidth: "92vw"`).

## Plan

### 1. Responsive shell (`src/components/theo/Layout.tsx`)
- Hide the desktop sidebar below `md` (already 196px fixed → wrap in a Tailwind `hidden md:flex` container).
- Promote the existing "Mobile header" to a real top bar with a hamburger button.
- Add a `Sheet` (shadcn) drawer that slides the same nav items in from the left on mobile; close on route change.
- Move the avatar/user chip into the drawer footer on mobile; keep it in the top bar on desktop.
- Reduce main content padding from `28px` → `16px` under `md`.
- Make the global search bar full-width on mobile (drop `maxWidth: 380`, hide the right-side user chip on small screens — already in the drawer).

### 2. Fluid grids on key pages
Replace fixed `gridTemplateColumns` with Tailwind responsive classes:
- **Payout.tsx** — `3fr 2fr` (form + history) → `grid-cols-1 lg:grid-cols-[3fr_2fr]`. Recipient/amount inner `1fr 1fr` → `grid-cols-1 sm:grid-cols-2`.
- **Balance.tsx** — wallet cards `repeat(min(n,3), 1fr)` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Action buttons row stays as flex but wraps.
- **Convert.tsx** — same treatment for the wire/local summary cards and amount/recipient inputs.
- **Dashboard.tsx** — KPI tiles and any 2-column splits.

### 3. Tables → scroll + stack
- Wrap all `<table>` blocks in `<div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">` so they scroll edge-to-edge on phone.
- For the Transactions list specifically: under `md`, render each row as a stacked card (date → reference → amount → status) instead of forcing a horizontal scroll. Cleaner UX for the CFO use case.

### 4. Touch targets & typography
- Bump primary buttons / nav rows to `min-h-[44px]` on mobile (Apple HIG / a11y).
- Inputs already 14px font — bump to 16px on mobile to prevent iOS zoom-on-focus.
- Confirm dialogs (Balance reveal-secret, Payout confirm) already use `maxWidth: 92vw` — verify, no change needed.

### 5. Future: multi-sig signing on mobile
No code in this pass, but the responsive shell sets us up for it. When multi-sig lands:
- The "pending signatures" inbox fits naturally as a list view in the same drawer/dashboard.
- Signing a tx is a single confirm modal — already mobile-friendly pattern.
- For real device-key signing later, we'd add WebAuthn / passkey or a Capacitor wrapper (separate plan).

## Files touched
- `src/components/theo/Layout.tsx` — shell + mobile drawer (biggest change, ~80 lines)
- `src/pages/Dashboard.tsx`, `Balance.tsx`, `Payout.tsx`, `Convert.tsx`, `Transactions.tsx` — class-only edits, no logic changes
- (Optional) `src/index.css` — add a `@media (max-width: 768px)` rule to bump base input font-size

## Out of scope (call out before approving)
- No PWA / installable app in this pass (separate decision — see Capacitor option later).
- No redesign of pages, colors, or flows. Pure layout adaptation.
- Admin pages (`AdminKyb`, `AdminTools`, `AdminConversions`) get table scroll wrappers only — not a full mobile redesign, since admins are desktop users.

## Effort
Roughly one implementation pass. Shell refactor is the bulk; per-page edits are mechanical class swaps. Reply "go" to proceed.
