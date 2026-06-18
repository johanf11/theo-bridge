## Goal

On the Deposit HTG order detail page (`src/pages/OrderStatus.tsx`), when `order.order_kind === "htgc_mint"` and `order.status === "QUOTED"`, render a "Sending from" section directly above the existing "Pay via SPIH" panel. Reuse the customer's existing `bank_accounts` rows (same source used in `Convert.tsx`'s Withdraw to Bank tab). No DB or backend changes.

## Changes (single file: `src/pages/OrderStatus.tsx`)

1. **Fetch the customer's default bank account** alongside the existing order load:
   - After resolving `order.customer_id`, query `bank_accounts` with `select("id, bank_name, account_name, account_number, routing_code, is_default").eq("customer_id", customerId).order("is_default", { ascending: false }).limit(1)`.
   - Store the first row in a `linkedBank` state (nullable). Skip the query for non-mint orders.

2. **Add a helper** local to the file:
   - `maskAccount(num: string)` → returns `**** ${num.slice(-4)}` (mirrors `Convert.tsx`).
   - `bankInitials(name: string)` → first letters of up to 2 words for the avatar circle.

3. **Render the "Sending from" block** inside the `order.status === "QUOTED"` branch, gated by `order.order_kind === "htgc_mint"`, placed immediately above the existing `Pay via SPIH` panel (around line 273).

   Structure:
   - Card: `rounded-2xl border bg-card p-5 mb-4`
   - Eyebrow: `SENDING FROM` (11px, 700, uppercase, tracking 0.18em, cyan).
   - Row: 40px initials circle (theo-blue-soft bg, theo-blue text) + bank name (bold theo-blue) and `${bank_name} · ${maskAccount(account_number)}` line + owner name underneath in `theo-mid` + right-aligned green "Linked" badge (theo-cyan-soft style chip with check icon, green text `#1A7F37`).
   - Footer text link: "Change account" → routes to `/convert` (Withdraw to Bank tab) using `<Link>`, styled as cyan underline-on-hover.

4. **Render the compact transfer summary panel** directly below the bank card and above the SPIH panel, using `--theo-blue-soft` background:
   - `rounded-xl mb-4 p-4` with `background: hsl(var(--theo-blue-soft))`, `border: 1px solid hsl(var(--theo-blue-chip))`.
   - Rows (label left in `theo-mid`, value right bold `theo-blue`):
     - To account → `maskAccount(account_number)`
     - To bank → `bank_name`
     - Amount → `fmtHTG(order.htg_amount)`
     - Reference → `order.reference_number` (mono font)
   - Matches the styling pattern of the "Transfer Summary" block in `Convert.tsx` lines 1408–1470.

5. **Empty state**: if `linkedBank` is null (customer has no bank on file), render a compact prompt card in the same slot: "No bank account linked" + a "Link a bank account" CTA → `/convert`. Do not block the SPIH instructions from rendering.

6. **Scope**: Only show both blocks when `order.order_kind === "htgc_mint"`. The existing SPIH instructions panel and admin debug section remain unchanged.

## Out of scope

- No schema changes, no edge function changes.
- No changes to other order kinds.
- No bank-account picker on this page (the link sends users to the existing Convert page to manage banks).
