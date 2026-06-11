# AGENTS.md — Theo Bridge

Working conventions and decision rules for Codex sessions on this repo.

---

## MCP servers

Do **not** commit a `.cursor/mcp.json` to this repo — it would shadow each developer's global MCP config.

| Server | Status | Notes |
|---|---|---|
| Supabase | ✅ Add to `~/.cursor/mcp.json` | `npx @supabase/mcp-server-supabase@latest --project-ref nlbnmsiqfywskuxhqjon` — lets Cursor inspect schema, run SQL, check logs |
| Stellar / Horizon | ⛔ Do not add | No official Stellar Foundation MCP exists. Call Horizon via normal `fetch`. Constants are in the **Stellar constants** section below. |

---

## Commands

```bash
# Install dependencies
bun install

# Dev server (port 8080)
bun run dev

# Production build
bun run build

# TypeScript type check (no emit)
npx tsc --noEmit

# Lint
bun run lint

# Run tests
bun run test
```

---

## Documentation

| Doc | Purpose |
|---|---|
| `AGENTS.md` (this file) | Conventions, commands, decision rules — read first |
| `docs/architecture.md` | Full system architecture, data model, edge function contracts (as-built) |
| `docs/target-architecture.md` | **Intended** fund flow, ledger & HTG-C mint/burn model (target/mainnet) — marks 🎯 target vs 🔧 as-built. Read this before reasoning about conversions, buffers, or mint/burn. |
| `docs/design.md` | Design system — colors, typography, component patterns, anti-patterns |
| `docs/adr/0001-stellar-native-no-rehive.md` | Why Stellar-native instead of Rehive |
| `docs/stellar-queries.md` | Horizon curl commands, key addresses, debugging runbook |

---

## Key file locations

| What | Where |
|---|---|
| Routes | `src/App.tsx` |
| App shell + sidebar | `src/components/theo/Layout.tsx` |
| Auth shell (login/register) | `src/components/theo/AuthLayout.tsx` |
| Auth + roles hooks | `src/lib/auth.ts` (`useAuth`, `useRoles`) |
| Route guard | `src/components/theo/ProtectedRoute.tsx` |
| Pages | `src/pages/` |
| Theo-specific components | `src/components/theo/` |
| shadcn/ui primitives | `src/components/ui/` |
| Edge functions | `supabase/functions/<name>/index.ts` |
| Shared edge function helpers | `supabase/functions/_shared/` |
| DB migrations (applied in order) | `supabase/migrations/` |
| Supabase client (auto-generated, do not edit) | `src/integrations/supabase/client.ts` |
| Supabase types (auto-generated, do not edit) | `src/integrations/supabase/types.ts` |
| Brand tokens + fonts | `src/index.css` |
| Tailwind config | `tailwind.config.ts` |
| Balance helpers | `src/lib/balance.ts` |
| PDF receipt generator | `src/lib/receipt.ts` |
| Statement PDF generator | `src/lib/statement.ts` |
| Handoff / current state | `HANDOFF.md` |
| Stellar constants | `supabase/functions/_shared/stellar-assets.ts` |
| Signing helpers | `supabase/functions/_shared/stellar-signer.ts` |
| Transaction limits | `supabase/functions/_shared/tx-limits.ts` |

---

## Stellar constants

```ts
// Issuer (HTG-C and custom USDC on testnet)
HTGC_ISSUER = "GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT"

// Distributor / hot wallet
DISTRIBUTOR = "GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X"

// Network
HORIZON_URL = "https://horizon-testnet.stellar.org"
NETWORK_PASSPHRASE = Networks.TESTNET
```

The issuer public key is hardcoded in `supabase/functions/_shared/stellar-assets.ts`. The distributor secret lives only in Supabase edge function secrets (`STELLAR_DISTRIBUTOR_SECRET`). Never log or return signing secrets from any function.

---

## Environment variables

### Frontend (Vite, public)

```
VITE_SUPABASE_URL=https://nlbnmsiqfywskuxhqjon.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
VITE_SUPABASE_PROJECT_ID=nlbnmsiqfywskuxhqjon
```

### Edge function secrets (Supabase dashboard only, never in client)

```
SUPABASE_URL                  (auto-injected by Supabase runtime)
SUPABASE_ANON_KEY             (auto-injected)
SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
STELLAR_DISTRIBUTOR_SECRET    S… keypair for the hot wallet
STELLAR_USDC_ISSUER           G… address of the testnet USDC issuer
STELLAR_HTGC_ISSUER_SECRET    S… keypair for the HTG-C issuer
```

---

## Styling conventions

- **Inline styles are preferred for main page content.** Only use Tailwind classes for layout utilities and legacy components.
- All colors reference CSS variables: `hsl(var(--theo-blue))`, `hsl(var(--theo-gold))`, etc. Never hardcode hex inside components — if you must, define a local `const` at the top of the file.
- Core brand tokens (all defined in `src/index.css`):

```
--theo-blue       239 51% 40%   #33359A  sidebar, primary
--theo-gold       49 100% 50%   #FDCF00  CTAs, active icons
--theo-cyan       192 92% 47%   #08B5E5  accents, links
--theo-cream      48 20% 97%    #F9F8F5  page background
--theo-ink        240 27% 14%   #1A1A2E  body text
--theo-mid        240 13% 48%   #6B6B8A  secondary text
--theo-light      240 19% 93%   #EAEAF2  hairlines, borders
--theo-blue-soft  234 73% 96%   #EEF0FB  panels, soft backgrounds
```

- Fonts: `Plain` (custom OTF, all weights, loaded in `src/index.css`) for UI text; Inter as fallback.
- No emoji in the UI. Use Lucide icons exclusively.
- No gradients. Flat color only.

---

## How to add a new page

1. Create `src/pages/MyPage.tsx`. Export a default component that wraps content in `<AppLayout>` (from `@/components/theo/Layout`).
2. Add a route in `src/App.tsx`:
   ```tsx
   import MyPage from "./pages/MyPage";
   // ...
   <Route path="/my-page" element={<ProtectedRoute><MyPage /></ProtectedRoute>} />
   ```
3. Add a nav item in the `mainNav` array in `src/components/theo/Layout.tsx`:
   ```ts
   { to: "/my-page", label: "My Page", icon: SomeLucideIcon, keywords: ["search", "terms"] }
   ```
   The `keywords` array powers the global search bar — include terms users might type.
4. If the page is admin-only, use `<ProtectedRoute adminOnly>` in App.tsx and add the nav item inside the admin block in Layout.tsx.

---

## Memo type rules (payout path)

Stellar supports multiple memo types. The `send-payment` edge function and `Payout.tsx` enforce these rules — **do not bypass them in any rebuild of the payment path**:

- **`memoType` is required when `memo` is non-empty.** The server returns 400 if `memo` is set but `memoType` is absent (no silent "text" default — that would silently misroute exchange destination tags).
- **`MEMO_TEXT`** — max 28 **bytes** (UTF-8). Reject, never truncate. Use `TextEncoder().encode(val).length` not `val.length` (character count). Validate in both frontend and edge function.
- **`MEMO_ID`** — digits only, ≤ `uint64` max (`18446744073709551615`). Use `Memo.id(val)` from the Stellar SDK (internally uses BigInt/Long — no JS `Number` precision loss).
- **`memoType` must be stored on the `payouts` row** (`memo_type` column) so audits and retries can reconstruct the correct on-chain memo type.
- `saved_recipients` stores `memo` + `memo_type` so contacts with exchange destination tags auto-fill correctly on selection.
- **SQL NULL trap:** `neq("memo", "x")` in Supabase JS drops rows where `memo IS NULL`. Use `.or("memo.is.null,memo.neq.x")` instead.

---

## Amount and number rules

- **HTG has no cents.** Amounts in HTG are always integers (whole gourdes). Never show or accept fractional HTG.
- **All currency amounts stored in the database use 7 decimal places** (`numeric(18,7)` or `numeric(20,7)`). This applies to `usdc_amount`, `htg_amount`, `fee_usdc`, etc.
- **USDC amounts displayed to users** use 2 decimal places (`.toLocaleString("en-US", { minimumFractionDigits: 2 })`).
- **Fee rates** are stored in basis points (bps). 1 bps = 0.01%. `fee_bps = 130` means 1.30%. Display as `(bps / 100).toFixed(2) + "%"`.
- Default customer fee split: `fee_bps = 130` (Theo) + `corridor_bps = 70` = 200 bps total (2%).
- Transaction limits enforced in `_shared/tx-limits.ts`: min 1 USDC, max 1,000,000 USDC per single payment.

---

## Chart and visualization rules

- **No PieChart or donut charts.** Use stacked bar charts (recharts `<BarChart>` with multiple `<Bar>`) for any volume breakdown.
- The Dashboard uses a stacked bar with `conversions` and `payouts` series, bucketed by period (7D, 30D, 60D, YTD, 1Y).

---

## Language rules (customer-facing UI)

- **No crypto jargon.** Never say "blockchain", "on-chain", "ledger", "mint", "burn", "token" in any customer-facing label.
- Call the on/off-ramp flow "On / Off Ramp" or "Convert" — not "swap".
- HTG-C is an internal concept. In UI labels: "HTG Balance" not "HTG-C balance".
- USDC is fine to say — it's a recognized brand.
- Order statuses for customers: use plain English ("Processing", "Complete") not the DB enum values (RELEASING, COMPLETED).

---

## Auth and roles model

- `useAuth()` → `{ user, session, loading }`. Wraps `supabase.auth.onAuthStateChange`.
- `useRoles()` → `{ roles, isAdmin, isCustomer, loading }`. Queries `user_roles` table.
- `ProtectedRoute` gates all app pages. Add `adminOnly` prop for admin-only routes.
- New users automatically get a `customer` role and a `customers` row via the `on_auth_user_created` DB trigger.
- Org-level permissions (for multi-user orgs): `usePermissions()` hook in `src/hooks/usePermissions.ts`. Returns `can(permission)` and `isOwner`. Permissions: `convert | payout_send | balance_view_keys | accounts_manage | view_balances`.

---

## Edge function conventions

- Every edge function must verify caller identity with `supabase.auth.getUser()` on a user-scoped client before doing any work.
- For admin-only functions: additionally check `user_roles` table for `role = 'admin'`.
- Use `admin = createClient(url, service)` (service role key) only for trusted DB writes — never return the service key to the client.
- All signing of Stellar transactions must go through `_shared/stellar-signer.ts`. Do not call `Keypair.fromSecret(Deno.env.get("STELLAR_DISTRIBUTOR_SECRET"))` anywhere else.
- `ensureWalletReady()` from `_shared/ensure-wallet-ready.ts` is idempotent and must be called before any payment to guarantee USDC + HTG-C trustlines are open and authorized.

---

## Order kinds and OrderStatus rendering

`orders.order_kind` is one of: `usdc_conversion`, `htgc_mint`, `htgc_usdc_swap`, `htgc_withdrawal`. `OrderStatus.tsx` switches its labels, step list, and detail cards on this column:

| `order_kind` | OrderStatus rendering |
|---|---|
| `htgc_mint` | "Deposit order" — HTG-C delivered |
| `usdc_conversion` | "Conversion order" — USDC + rate cards |
| `htgc_usdc_swap` | Swap |
| `htgc_withdrawal` | "Redemption order" — HTG-C redeemed + HTG paid out, **no** USDC/rate cards |

- **Off-ramp redemptions** (`withdraw-htgc`) store `usdc_amount=0`, `rate=1`. Do **not** render them with the conversion template — that produces the "0.00 USDC delivered at 1.00 HTG/USDC" bug.
- Reference prefixes are **not** a reliable per-kind key — they differ by the function that created the order (`create-quote` → `THEO-CNV-`/`THEO-DEP-`/`THEO-BUY-`/…, `withdraw-htgc` → `THEO-W-`, `execute-swap` → `SWP-`). The **one** prefix used as a rendering signal is `THEO-W-`: `OrderStatus.tsx` treats an order as a redemption when `order_kind === "htgc_withdrawal"` **or** `reference_number` starts with `THEO-W-` (fallback for rows with an unset `order_kind`). Keep both checks in sync — they live in `getSteps()` and the `isWithdrawal` flag.
- Receipts: pass `kind: "withdraw"` to `generateReceipt` for redemptions — `"htgc_withdrawal"` is not a valid receipt kind.

---

## Supabase project

- Project ID: `nlbnmsiqfywskuxhqjon`
- Dashboard: `https://supabase.com/dashboard/project/nlbnmsiqfywskuxhqjon`
- Do not edit `src/integrations/supabase/client.ts` or `src/integrations/supabase/types.ts` — both are auto-generated from the Supabase CLI.

---

## Key decision rules

| Decision | Rule |
|---|---|
| Chart type for volume splits | Stacked bar chart — never pie/donut |
| HTG amounts | Integer only, no cents |
| DB amount precision | 7 decimal places (`numeric(18,7)`) |
| Customer-facing rate labels | Show as "Rate" or "Exchange Rate" — never "spot", "forward premium" |
| Signing keys | All paths go through `_shared/stellar-signer.ts` |
| `stellar_secret` column | Never SELECT it from the client; use the `reveal-wallet-secret` edge function |
| New RLS policies | Always add both authenticated and service_role policies |
| Horizon network | Testnet only until mainnet migration |
| Fee calculation | `fee_usdc = gross * (total_bps / 10_000)`; `net = gross - fee_usdc` |
| Trusted writes from edge functions | Use `SUPABASE_SERVICE_ROLE_KEY` admin client |
| Memo type when memo present | Always require explicit `memoType` — no silent "text" default |
| Memo byte validation | Use `TextEncoder().encode(val).length`, not `val.length` |
| Memo type persistence | Store `memo_type` on `payouts` row alongside `memo` |
| Supabase `.neq()` on nullable column | Use `.or("col.is.null,col.neq.x")` — `.neq("col","x")` silently drops NULL rows |
