## Goal

Extend the admin KYB review workflow beyond Approve/Reject with two new white‑glove actions, and let admins onboard businesses themselves when paperwork arrives via email.

## New actions on the KYB Review table

1. **Send back** — soft rejection that returns the application to the customer with reviewer comments and (optionally) a list of suggested edits/inclusions. The customer sees the comments on `/kyb`, can edit their fields / re‑upload, and resubmit.
2. **Edit** — opens the customer's KYB record in an admin editor so the reviewer can fix fields on the customer's behalf (white glove). Optionally upload a document for them. Save can either keep status as is or push straight to Approved.
3. **Add business** — top‑right "+ Add business" button that lets the admin create a brand‑new customer from scratch (company, contact, email, country, registration #, business type, optional document, optional fee/corridor bps). Sends a magic‑link invite so the customer can claim the account later.

The existing Approve and Reject (hard reject) actions stay as they are.

## Status model

Add one new value to the `kyb_status` enum:

- `CHANGES_REQUESTED` — set by "Send back". Customer can edit & resubmit (treated like `REJECTED` on the customer side: form unlocks, status card shows reviewer notes).

Add two columns to `customers`:

- `kyb_review_notes text` — free‑text reviewer comments shown to the customer on send‑back.
- `kyb_requested_changes text[]` — optional list of specific items the customer needs to fix/upload (rendered as a checklist on `/kyb`).

Existing `kyb_rejection_reason` is kept and reused for hard `REJECTED`.

`protect_customer_fields` trigger needs the same "customer may transition `CHANGES_REQUESTED → UNDER_REVIEW` on resubmit" allowance it already has for `PENDING`/`REJECTED → UNDER_REVIEW`.

## Server (edge function)

New `admin-kyb` edge function (verifies caller is admin via `user_roles`, uses service‑role client for writes). Single endpoint, switched by `action`:

- `approve` — `{ customer_id }`
- `reject` — `{ customer_id, reason }` (hard)
- `send_back` — `{ customer_id, notes, requested_changes? }` → sets `kyb_status='CHANGES_REQUESTED'`, stores notes/checklist
- `edit` — `{ customer_id, fields, set_status? }` → updates allowed KYB fields on behalf of customer
- `add_business` — `{ email, company_name, contact_name, country, registration_number, business_type, legal_name, phone?, fee_bps?, corridor_bps? }` → creates `auth.users` (invite by email via admin API), the `handle_new_user` trigger creates the `customers` row, function then patches the KYB fields and (optionally) approves immediately

Existing approve/reject in `AdminKyb.tsx` move from direct table updates to calling this function (keeps RLS clean and lets us write audit fields server‑side).

Optional doc upload for `edit` / `add_business`: client uploads to `kyb-documents/<user_id>/...` after the function returns the new `user_id`.

## Admin UI changes (`src/pages/AdminKyb.tsx`)

Row actions become: **Doc · Approve · Send back · Edit · Reject**.

- "Send back" expands an inline panel (mirror of the existing reject panel) with a notes textarea and an "add suggested change" chip input, plus a "Send back to customer" button.
- "Edit" opens a side drawer / dialog (`AdminKybEditor`) prefilled with the customer's KYB fields + a doc upload slot. Save calls `admin-kyb` `edit`. A separate "Save & approve" button is offered.
- Header gets a primary **+ Add business** button next to Refresh. Clicking it opens a dialog (reuse `AdminKybEditor` in "create" mode) that collects email + company + contact + country + KYB fields, then calls `admin-kyb` `add_business`.
- Add a 5th stat card or change the "Awaiting submission" copy so it also counts `CHANGES_REQUESTED` returned-to-customer items, OR add a small "Changes requested" pill state and a tab. Plan: add `CHANGES_REQUESTED` as its own status pill (amber/orange) and surface a count under the "Under review" tab as a sub‑badge.

## Customer UI changes (`src/pages/Kyb.tsx`)

- Treat `CHANGES_REQUESTED` like `REJECTED` for editability (form unlocks).
- StatusCard gets a new variant "Changes requested" showing `kyb_review_notes` and, if present, the `kyb_requested_changes` checklist.
- Add i18n keys for the new copy (EN + FR).

## Files touched

- `supabase/migrations/<timestamp>_kyb_changes_requested.sql` — enum value, columns, trigger update, grants.
- `supabase/functions/admin-kyb/index.ts` — new.
- `src/pages/AdminKyb.tsx` — new actions, Add‑business button, status styling.
- `src/components/theo/AdminKybEditor.tsx` — new (dialog used for Edit and Add business).
- `src/pages/Kyb.tsx` — handle `CHANGES_REQUESTED` state and render notes/checklist.
- `src/lib/i18n.ts` (or wherever the strings live) — new keys.

## Out of scope

- Audit log table for KYB actions (can be added later).
- File‑level review (per‑document accept/reject).
- Email notifications to the customer on send‑back (function will be structured so an email hook can be added later).

## Open questions

1. On **Add business**: should we send the customer a magic‑link invite immediately so they can sign in and claim the account, or just create a placeholder and let them sign up normally with that email later? (Default in plan: send invite.)
2. On **Edit**: do you want the admin to be able to also change `fee_bps` / `corridor_bps` from this drawer, or keep those in a separate "Customer settings" surface?
3. Should "Send back" auto‑email the customer the notes, or only show them in‑app for now?