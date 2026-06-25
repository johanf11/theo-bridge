
# Owlting Omnibus Off-Ramp — Demo Plan

## Concept

In production, Theo will hand off USDC to Owlting along with each vendor's wire details, and Owlting converts USDC → fiat and wires the supplier. For the **demo**, we collapse that into a single **omnibus Owlting Stellar address** that receives USDC from every payout, regardless of the vendor name/wire info the customer enters. The customer-facing UX still looks like "I'm paying Vendor X" — under the hood every payment lands at the same Owlting collector wallet.

## Fund flow (demo)

```
Customer HTG-C ──Convert──▶ Customer USDC ──Payout──▶ Owlting Omnibus (USDC)
                                                          │
                                          (mainnet) Owlting → fiat → vendor wire
                                          (demo)    stops here, marked "Wired"
```

No ledger posting on the payout leg (already non-custodial — unchanged). The `payouts` row captures vendor name + wire details for the receipt; the on-chain destination is always the omnibus address.

## What to build

### 1. Owlting omnibus wallet (one-time setup)
- Create a Theo-managed Stellar testnet wallet labeled **"Owlting Off-Ramp (Omnibus)"** under a system/admin customer record so it's invisible to regular users.
- Auto-establish USDC trustline via existing `ensureWalletReady` helper.
- Store its public address in a new edge-function secret: `OWLTING_OMNIBUS_ADDRESS`.

### 2. New "Pay a vendor" payout flow
Currently `Payout.tsx` takes a Stellar G… address from the user. For the demo we add a parallel **"Pay a vendor via Owlting"** mode:

- Form fields: Vendor name, Vendor country, Bank name, Account number / IBAN, SWIFT/BIC, Reference, Amount (USDC), optional internal note.
- No Stellar address asked.
- On submit, the frontend calls `send-payment` with:
  - `recipientAddress` = `OWLTING_OMNIBUS_ADDRESS` (resolved server-side)
  - `recipientName` = "Owlting → {vendor name}"
  - `memoType` = `"text"`, `memo` = a short routing token (e.g. `OWL-{short_id}`) tying the on-chain tx back to the wire details row.

### 3. `vendor_wire_instructions` table
Stores the full wire details the customer entered, linked to the `payouts.id`. Columns: `payout_id`, `vendor_name`, `vendor_country`, `bank_name`, `account_number`, `swift_bic`, `reference`, `note`, `owlting_status` (`RECEIVED` / `WIRED` / `FAILED`), `wired_at`, `simulated_wire_ref`. RLS: customer can read their own; admins read all.

### 4. `send-payment` edge function — minimal extension
Add an optional `vendorWire` block to the request body. When present:
- Override destination with `OWLTING_OMNIBUS_ADDRESS` (ignore any client-supplied address — server-authoritative).
- After the Stellar payment succeeds, insert the `vendor_wire_instructions` row with `owlting_status = 'RECEIVED'`.
- Everything else (trustline checks, memo validation, failure handling) reuses the existing path.

### 5. Admin "Owlting queue" page (`/admin/owlting`)
Read-only list of `vendor_wire_instructions` joined to `payouts`: vendor, amount, status, Stellar hash, "Mark as wired" button that flips status to `WIRED` and stamps a fake `simulated_wire_ref` (e.g. `WIRE-2026-xxxx`). Optional — gives the demo a satisfying "completed" moment.

### 6. Customer receipt update
`OrderStatus.tsx` / payout receipt shows the vendor wire details (not the omnibus Stellar address) plus a small "Settling via Owlting" badge so the demo story reads correctly.

## Out of scope

- Real Owlting API integration.
- Per-vendor sub-accounts at Owlting (mainnet concern).
- Currency conversion math on the wire leg (mainnet concern).
- Changing the existing "Pay to Stellar address" payout — it stays for crypto-native recipients.

## Files touched

- New: `supabase/functions/_shared/owlting.ts` (resolves omnibus address from secret).
- New migration: `vendor_wire_instructions` table + RLS + grants.
- Edit: `supabase/functions/send-payment/index.ts` — accept `vendorWire`, override destination, insert wire row.
- Edit: `src/pages/Payout.tsx` — add "Pay a vendor (Owlting)" tab/mode.
- New: `src/pages/AdminOwlting.tsx` + route in `src/App.tsx` + nav entry in `Layout.tsx`.
- Edit: `src/pages/OrderStatus.tsx` (or wherever payout receipt renders) — show vendor wire summary + Owlting badge.
- One-time admin action via `admin-setup-wallet` (or a small new function) to mint the omnibus wallet and set `OWLTING_OMNIBUS_ADDRESS` secret.

## Open question (can answer at build time)

Whether to expose **"Pay a vendor (Owlting)"** as a new tab on the existing Payout page or as a separate top-nav item like **"Pay a Bill"** — the latter reads better for the demo narrative.
