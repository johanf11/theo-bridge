## Goal
Deploy the updated `release-usdc` edge function so it auto-mints USDC from the issuer to the distributor when the distributor balance is insufficient.

## What I'll do
1. **Deploy `release-usdc`** edge function (latest code from repo).
   - The function reads `STELLAR_HTGC_ISSUER_SECRET`, which is **already configured** in the project's Edge Function secrets — no new secret needed.
2. **Smoke-check** the deploy by listing recent function logs to confirm no boot errors.

## Not doing
- No DB migrations.
- No frontend code changes — all referenced frontend files (`OrderStatus.tsx`, `lib/receipt.ts`, `Compliance.tsx`, `Transactions.tsx`, `App.tsx`, `Layout.tsx`) are already in the repo from previous turns.
- Not redeploying `execute-withdraw` or `admin-rectify-htgc` — those were deployed earlier and are unchanged.

## Notes
- `STELLAR_HTGC_ISSUER_SECRET` already exists in the secret store (per `fetch_secrets`), so the "add secret first" step in your message is already satisfied. If you intended to rotate it to a different value, let me know and add/update it before I deploy.
