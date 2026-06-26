## Cleanup
Delete all stuck `THEO-ODO-*` orders with status `QUOTED` (currently 28+ rows from the Odoo ping bug), plus any ledger entries/transactions tied to them. Preserve `COMPLETED` orders.

Migration:
```sql
DELETE FROM ledger_entries WHERE transaction_id IN (
  SELECT id FROM ledger_transactions WHERE order_id IN (
    SELECT id FROM orders WHERE reference_number LIKE 'THEO-ODO-%' AND status = 'QUOTED'
  )
);
DELETE FROM ledger_transactions WHERE order_id IN (
  SELECT id FROM orders WHERE reference_number LIKE 'THEO-ODO-%' AND status = 'QUOTED'
);
DELETE FROM orders WHERE reference_number LIKE 'THEO-ODO-%' AND status = 'QUOTED';
```

## Cursor pass-through prompt
I'll provide a prompt you can paste into Cursor (working in the Odoo `theo_payment` plugin repo) that explains the bug and prescribes the fix: stop calling `/theo-api-quote` on every wizard render/health-check, only call it when the user explicitly opens the Pay-with-Theo wizard, and never persist/ping a quote that hasn't been confirmed via `/theo-api-pay`. The prompt will cover:

- Root cause: plugin is calling `POST /theo-api-quote` during connection tests, wizard preloads, or polling — each call creates a `QUOTED` order on Theo's side.
- Required behavior:
  - `Test Connection` button → only call `GET /theo-api-ping` (never `/quote`).
  - Wallet picker refresh → only `GET /theo-api-wallets`.
  - `/theo-api-quote` is only called once, on explicit user click of "Get quote", and the returned `quote_id` is held in wizard memory (not persisted) until the user clicks "Confirm & Pay".
  - If the user cancels or the wizard closes before `/theo-api-pay`, do nothing — the quote will expire server-side in 15 min.
  - Add idempotency: store a `client_request_id` (UUID v4 generated per wizard open) and dedupe in the plugin so a double-click or retry doesn't fire two `/quote` calls.
  - Remove any cron/scheduled action that calls `/quote`.
  - Log every outbound call with method + endpoint + status so duplicates are visible.
- Acceptance: opening the wizard and closing it must produce zero `QUOTED` orders on the Theo side; only an explicit Confirm produces one `COMPLETED` order.

## Server-side hardening (optional, not in this plan)
Mention to user: longer-term we should make `/theo-api-quote` itself idempotent via an `Idempotency-Key` header so even a buggy client can't create duplicates. Flag only — not implementing now per "only what user asked".
