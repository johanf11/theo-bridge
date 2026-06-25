# Plan: Pass-down doc for Theo ↔ Odoo plugin integration

Create a single markdown handoff at `docs/theo-odoo-integration.md` so whoever builds/demos the `theo_payment` Odoo 17 module can wire it up against the Theo API with zero ramp-up. No code changes — doc only.

## File: `docs/theo-odoo-integration.md`

Sections:

1. **Overview** — one-paragraph summary of the flow: importer pre-funds HTG → HTG-C → "Pay with Theo" on an Odoo vendor bill → Theo debits USDC (or auto-converts HTG-C at live BRH rate) → settles supplier on Stellar → returns tx hash for Odoo to mark the bill paid.

2. **Prerequisites** — Theo org with KYB `APPROVED`, owner-level user, at least one funded wallet, Odoo 17 self-hosted with developer mode.

3. **Generate an API key** — step-by-step: Settings → API & Integrations → Generate. Key shown once, format `theo_live_<32 hex>`. Owner-only. Scopes default to `payments:write, wallets:read, balance:read, quotes:write`.

4. **Endpoint base URL** — `https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1` (and how to point at a different env). Auth header: `Authorization: Bearer theo_live_…`. Wide-open CORS, no `apikey` header needed.

5. **API reference** — for each of `GET /theo-api-ping`, `GET /theo-api-wallets`, `POST /theo-api-quote`, `POST /theo-api-pay`: purpose, request shape, response shape, sample curl, sample JSON. Call out:
   - HTG-C synthetic wallet id format `htgc:<customer_id>`.
   - Quote TTL = 15 min, idempotent via `quote_id`.
   - `supplier.stellar_address` is currently the only supported settlement rail.
   - `external_invoice_ref` flows into the on-chain memo (28 byte cap).

6. **End-to-end flow** — ASCII sequence diagram: Odoo → `/ping` → `/wallets` → user picks source → `/quote` → confirm → `/pay` → store `stellar_tx_hash` on `account.move`.

7. **Error codes** — full table (401/403/404/409/410/502) with what each means and the Odoo-side handling we recommend (retry vs. surface to user vs. re-quote).

8. **Odoo module expectations** — what the `theo_payment` module should ship: settings model (api_key, base_url, default_wallet_id), wizard on `account.move` with wallet picker + quote preview + confirm, `ir.config_parameter` for the key, system parameter to toggle test/live. Out of scope for this repo but listed so the plugin author knows the contract.

9. **Test plan / demo script** — copy-pasteable curl sequence that exercises ping → wallets → quote → pay end to end, plus how to verify on the Theo side (Transactions page, reference prefix `THEO-ODO-`).

10. **Troubleshooting** — common issues: 401 (wrong/revoked key), 403 (KYB not approved or missing scope), 410 (quote expired, just re-quote), 502 (insufficient distributor USDC — admin top-up), CORS (should be none — wildcard).

11. **Security notes** — key shown once, hash-only at rest, owner-only mint/revoke, `last_used_at` audit, rotate via revoke + regenerate, never log the raw key in Odoo.

12. **Roadmap (not in v1)** — vendor sync from Odoo → Theo, bank-rail settlement, per-user keys, webhook callback to Odoo on settlement.

## Out of scope
- Any code change (Settings UI, edge functions, plugin source).
- The Odoo Python/XML module itself — that's a separate deliverable.
