## Restructure the On-Ramp & Swap flow

Today the Convert page has three tabs: **Deposit HTG** (mints HTG-C), **Convert** (HTG-C ↔ USDC), **Withdraw to Bank**. The "Convert" tab is misleading — it's really a swap, and depositing HTG always mints HTG-C with no path straight to USDC.

The new flow makes deposit the on-ramp (with an optional one-step convert to USDC) and renames the second tab to **Swap** for moving between HTG-C and USDC any time.

---

### Tab 1 — Deposit HTG (on-ramp)

Add a small **"You receive"** toggle at the top of the deposit form:

```text
You receive:  [ HTG-C (1:1) ]  [ USDC (auto-convert) ]
```

**HTG-C path** (default — current behavior):
- Send HTG via SPIH → 1:1 mint of HTG-C to selected wallet.
- No KYB required, no rate, no quote expiry.
- Quote box shows: send HTG, receive HTG-C, peg 1:1.

**USDC path** (new):
- Send HTG via SPIH → Theo converts at the locked rate → USDC delivered to selected wallet.
- KYB gate applies (same as current Convert tab).
- 15-minute rate lock, fee breakdown shown.
- Quote box shows: send HTG, receive USDC, rate, fees, settlement window.
- The "Get deposit reference →" button creates a `usdc_conversion` order (existing flow); HTG amount is converted to a target USDC amount using the live rate.

Both paths route to the same `/orders/:id` SPIH-reference page on submit. The downstream worker already branches on `order_kind`, so HTG-C deposits complete instantly on simulated payment and USDC deposits go through `release-usdc`.

### Tab 2 — Swap (rename from "Convert")

- Rename the tab label from **Convert** to **Swap**.
- Keep the existing direction toggle: **HTG-C → USDC** and **USDC → HTG-C**.
- Update copy to "Swap between HTG-C and USDC instantly."
- No backend change — the existing `handleSwapSubmit` stub remains the placeholder for the on-chain swap path.

### Tab 3 — Withdraw to Bank

Unchanged.

### Page header

Update tagline from "Fund your account or withdraw to a bank." to something that reflects all three actions, e.g. "Deposit HTG, swap between currencies, or withdraw to a bank."

---

### Technical details

**Files to edit**
- `src/pages/Convert.tsx`
  - Add `htgReceiveMode: "htgc" | "usdc"` state for tab 1.
  - Add the receive-mode toggle and conditional quote box (mint vs. conversion).
  - In `handleHtgSubmit`, branch:
    - `htgc` → existing call to `create-quote` with `order_kind: "htgc_mint"`.
    - `usdc` → call `create-quote` with `usdc_amount` derived from HTG ÷ live rate, gated on KYB approval, same as today's Convert tab.
  - Rename tab 2 button label `Convert` → `Swap`; update inline headings/copy in the `tab === "swap"` block.
  - Remove the `🏦` emoji from the deposit banner (per brand: Lucide icons only) — replace with a `Building2` icon already imported.

**No backend, schema, or edge-function changes required.**
- `create-quote` already accepts both `order_kind` values.
- `simulate-spih-payment` already branches on `order_kind` (mint completes directly; conversion goes through release-usdc).

**KYB behavior**
- HTG → HTG-C: no KYB.
- HTG → USDC: KYB required (same gate as the existing Convert flow today).
- HTG-C ↔ USDC swap: KYB required.

**Min/max for USDC deposit path**
- `create-quote` enforces 1,000–50,000 USDC. The UI should validate the equivalent HTG range against the live rate before submit and show a helpful message.

---

### Out of scope
- Actual on-chain HTG-C ↔ USDC swap implementation (still a stub).
- Any change to the order status page, withdraw flow, or bank-account management.
