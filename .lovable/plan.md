# Deploy Theo API functions + verify convert 404 fix

## Goal
Odoo is hitting `POST /theo-api-convert` and getting `404 Requested function was not found`. The function source exists in the repo (`supabase/functions/theo-api-convert/index.ts`) so the most likely cause is that it was never deployed (or was deployed under a different revision). Redeploy the affected functions and confirm with curl.

## Steps

1. Redeploy these edge functions to project `nlbnmsiqfywskuxhqjon`:
   - `theo-api-convert`
   - `theo-api-pay-bank`
   - `theo-api-quote`
   - `theo-api-pay`
   - `theo-api-wallets`

2. Verify with unauthenticated curl that each slug now resolves at the gateway (i.e., returns an auth error from our code, not Supabase's `NOT_FOUND`):
   - `POST /theo-api-convert` → expect `401 { "error": "Missing API key" }` (or equivalent), NOT `404 Requested function was not found`.
   - Same check for `/theo-api-pay-bank`.

3. Report back the HTTP status + JSON body returned by each curl so it's clear the slug exists.

## Out of scope
- No code changes to any function.
- No changes to `_shared/*` (per project constraint).
- No schema or secret changes.
