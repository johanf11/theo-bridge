## Add "Global Bank Payout" tab to Convert page

A new fourth tab in `src/pages/Convert.tsx` lets approved users send USDC from their Stellar wallet to a global bank account via a placeholder OwlPay orchestrator.

### Edits in `src/pages/Convert.tsx`

1. **Tab type** (line 11): `type Tab = "htg" | "swap" | "off" | "bank";`

2. **State** (near other tab state, ~line 50): add
   - `bankRecipientName`, `bankBankName`, `bankAccountNumber`, `bankRoutingCode` (strings)
   - `bankAmountRaw` (number), `bankAmountDisplay` (string)
   - `bankBusy` (boolean)

3. **Tab switcher** (line 625): add `<button style={tabStyle("bank")} onClick={() => setTab("bank")}>Global Bank Payout</button>`.

4. **New tab block** (insert after the off-tab block ends near line 1273):
   - **Banner**: cyan-tinted info banner with `Building2` icon and copy:
     "Settlements to bank accounts are processed via OwlPay regulated rails. Requires a valid business license and may take 1–3 business days."
   - **KYB gate**: if `profile?.kyb_status !== "APPROVED"`, render the same "KYB Required" empty state used by the Swap tab (link to `/compliance`).
   - **Form fields** using `labelStyle`/`inputStyle`:
     - Recipient Full Name (text)
     - Bank Name (text)
     - Account Number / IBAN / CLABE (text)
     - Routing / SWIFT Code (text)
     - Amount USDC (numeric, comma-formatted, with available-balance hint `walletBalances.usdc`)
   - **Fee summary card** (matches existing fee-breakdown styling):
     - Amount: `$X.XX USDC`
     - Estimated Orchestrator Fee: `$1.50 + 0.5% = $X.XX USDC` (flat $1.50 + 0.5% of amount)
     - Recipient receives (net): `amount - fee`
   - **Submit button**: blue primary button "Confirm Payout →". Disabled when:
     - any required field empty
     - `bankAmountRaw <= 0`
     - `bankAmountRaw > walletBalances.usdc` (insufficient balance — show inline red helper text)
     - `bankBusy` is true
   - On click → `handleBankPayoutSubmit()`:
     ```ts
     const handleBankPayoutSubmit = async () => {
       const payload = {
         recipient_name: bankRecipientName,
         bank_name: bankBankName,
         account_number: bankAccountNumber,
         routing_code: bankRoutingCode,
         amount_usdc: bankAmountRaw,
         orchestrator: "owlpay",
         source_wallet: selectedWallet,
       };
       console.log("[BankPayout] payload", payload);
       toast("Initiating orchestrator bridge...");
     };
     ```

5. **Design tokens**: primary button `hsl(var(--theo-blue))`, banner accent `hsl(var(--theo-cyan))`, balance/insufficient text colors using existing semantic tokens (`--theo-mid`, red `#C00` for errors). No gradients.

No backend, DB, or edge-function changes — this is a UI/integration-prep stub only.