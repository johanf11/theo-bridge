# Deploy rectify + withdraw edge functions

The frontend and edge function code are already in place from prior work:

- `supabase/functions/admin-rectify-htgc/index.ts` — burns phantom HTGC, opens real trustline, mints real HTGC from `STELLAR_HTGC_ISSUER_SECRET` (= `GDSRY…` = `HTGC_ISSUER`).
- `supabase/functions/execute-withdraw/index.ts` — burns user HTGC back to the canonical issuer and records a `htgc_withdraw` order.
- `src/pages/Balance.tsx` already renders the small **fix** button next to each wallet's HTG-C column (admin-only) and calls `supabase.functions.invoke("admin-rectify-htgc", { body: { walletId } })`.

Nothing else needs to change in code — they just haven't been deployed yet to the Cloud backend.

## Step

Use `supabase--deploy_edge_functions` to deploy both functions:

```text
["admin-rectify-htgc", "execute-withdraw"]
```

Both are already listed in the project's edge function directory; no `config.toml` changes are needed (`admin-rectify-htgc` validates the JWT in code via `getUser()` + `user_roles` admin check, and `execute-withdraw` does the same customer check pattern as `move-funds`).

## After deploy

Confirm to the user:
1. Go to **/balance**
2. Click the small **fix** button next to the HTG-C column on the Operations row
3. The function will burn the 25,000 phantom HTGC → open the real trustline → mint 25,000 real HTGC from `GDSRY…`
4. Page reloads and shows 25,000 HTG-C

If anything fails, pull logs with `supabase--edge_function_logs` for `admin-rectify-htgc` to see the exact Horizon error.

## Out of scope

- No DB migrations needed (the `htgc_withdraw` enum value already exists since `execute-withdraw` was created earlier).
- No frontend changes — the fix button already exists and is gated on `isAdmin`.
