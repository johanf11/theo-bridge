import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ReceiptData = {
  kind: "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield" | "yield_earned";
  referenceNumber?: string;
  poReference?: string;
  initiatedBy?: string;
  createdAt: string;
  htgAmount?: number;
  usdcAmount?: number;
  usdcGross?: number;
  feeUsdc?: number;
  feeBps?: number;
  theoFeeUsdc?: number;
  theoFeeBps?: number;
  corridorFeeUsdc?: number;
  corridorFeeBps?: number;
  rate?: number;
  stellarTxHash?: string | null;
  status?: string;
  recipientName?: string;
  memo?: string | null;
  walletLabel?: string;
  netApy?: number;
  depositedAt?: string;
  accruedAmount?: number;
  customerName?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtN(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function normaliseKind(raw: string): ReceiptData["kind"] {
  if (raw === "usdc_conversion") return "conversion";
  if (raw === "htgc_usdc_swap")  return "swap";
  return raw as ReceiptData["kind"];
}

function kindLabel(kind: ReceiptData["kind"]) {
  const map: Record<string, string> = {
    conversion:   "HTG → USDC Conversion",
    htgc_mint:    "HTG Deposit — HTG-C Minted",
    swap:         "HTG-C → USDC Swap",
    withdraw:     "HTG-C Withdrawal",
    payout:       "USDC Payout",
    yield:        "Yield Deposit",
    yield_earned: "Yield Earned",
  };
  return map[kind] ?? "Transaction";
}

function statusLabel(s: string) {
  const map: Record<string, { text: string; color: string }> = {
    COMPLETED: { text: "● SETTLED",    color: "#1A7F37" },
    FAILED:    { text: "● FAILED",     color: "#B91C1C" },
    EXPIRED:   { text: "● EXPIRED",    color: "#6B7280" },
    QUOTED:    { text: "● PENDING",    color: "#7A5F00" },
    FUNDED:    { text: "● PROCESSING", color: "#0A5A8A" },
    RELEASING: { text: "● RELEASING",  color: "#0A5A8A" },
    PENDING:   { text: "● PENDING",    color: "#7A5F00" },
  };
  return map[s] ?? { text: `● ${s}`, color: "#6B7280" };
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function row(label: string, value: string, opts: {
  deduction?: boolean;
  bold?: boolean;
  total?: boolean;
  mono?: boolean;
} = {}) {
  if (opts.total) {
    return `
      <tr class="total-row">
        <td>${label.toUpperCase()}</td>
        <td class="val">${value}</td>
      </tr>`;
  }
  const valStyle = opts.deduction ? 'color:#B91C1C' : opts.bold ? 'font-weight:700;color:#1A1A3A' : 'color:#1A1A3A';
  const monoStyle = opts.mono ? 'font-family:monospace;font-size:11px;word-break:break-all' : '';
  return `
    <tr>
      <td class="lbl">${label.toUpperCase()}</td>
      <td class="val" style="${valStyle};${monoStyle}">${value}</td>
    </tr>`;
}

function sectionHead(label: string) {
  return `<tr class="section-head"><td colspan="2">${label.toUpperCase()}</td></tr>`;
}

function dividerRow() {
  return `<tr class="divider-row"><td colspan="2"></td></tr>`;
}

function buildHtml(data: ReceiptData): string {
  const kind = normaliseKind(data.kind as string);
  const dateStr = new Date(data.createdAt).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  const st = statusLabel(data.status ?? "COMPLETED");
  const ref = data.referenceNumber ?? "";

  // ── Build table rows by section ──────────────────────────────────────────
  let bodyRows = "";

  // ACCOUNT SECTION
  bodyRows += sectionHead("Account");
  if (data.customerName) bodyRows += row("Client", data.customerName, { bold: true });
  bodyRows += row("Transaction Date", dateStr);
  bodyRows += `<tr><td class="lbl">STATUS</td><td class="val" style="color:${st.color};font-weight:700">${st.text}</td></tr>`;
  if (data.poReference) bodyRows += row("Purchase Order", data.poReference, { bold: true });
  if (data.initiatedBy) bodyRows += row("Initiated By", data.initiatedBy);

  // BREAKDOWN SECTION
  if (kind === "conversion") {
    bodyRows += dividerRow();
    bodyRows += sectionHead("Transaction Breakdown");
    if (data.htgAmount)        bodyRows += row("HTG Submitted",          `${fmtN(data.htgAmount)} HTG`, { bold: true });
    if (data.rate)             bodyRows += row("Exchange Rate (BRH)",    `${fmtN(data.rate, 2)} HTG / USDC`);
    if (data.usdcGross != null) bodyRows += row("USDC Gross",            `${fmtN(data.usdcGross)} USDC`);

    const hasItemised = data.theoFeeUsdc != null && data.corridorFeeUsdc != null;
    if (hasItemised) {
      const tb = data.theoFeeBps     != null ? ` (${(data.theoFeeBps / 100).toFixed(2)}%)`     : "";
      const cb = data.corridorFeeBps != null ? ` (${(data.corridorFeeBps / 100).toFixed(2)}%)` : "";
      bodyRows += row(`Theo Service Fee${tb}`,        `− ${fmtN(data.theoFeeUsdc!)} USDC`,     { deduction: true });
      bodyRows += row(`Settlement Corridor${cb}`,     `− ${fmtN(data.corridorFeeUsdc!)} USDC`, { deduction: true });
    } else if (data.feeUsdc != null) {
      const b = data.feeBps != null ? ` (${(data.feeBps / 100).toFixed(2)}%)` : "";
      bodyRows += row(`Theo Fee${b}`,                 `− ${fmtN(data.feeUsdc)} USDC`,           { deduction: true });
    }

    if (data.usdcAmount != null) bodyRows += row("NET USDC RECEIVED", `${fmtN(data.usdcAmount)} USDC`, { total: true });
  }

  if (kind === "htgc_mint") {
    bodyRows += dividerRow();
    bodyRows += sectionHead("Transaction Breakdown");
    if (data.htgAmount) {
      bodyRows += row("HTG Deposited", `${fmtN(data.htgAmount)} HTG`, { bold: true });
      bodyRows += row("Peg Ratio", "1 : 1  (1 HTG-C = 1 HTG)");
      bodyRows += row("HTG-C Minted", `${fmtN(data.htgAmount, 0)} HTG-C`, { total: true });
    }
  }

  if (kind === "swap") {
    bodyRows += dividerRow();
    bodyRows += sectionHead("Transaction Breakdown");
    if (data.htgAmount) bodyRows += row("HTG-C Redeemed", `${fmtN(data.htgAmount, 0)} HTG-C`, { bold: true });
    if (data.rate)      bodyRows += row("Exchange Rate", `${fmtN(data.rate, 2)} HTG / USDC`);
    if (data.usdcAmount) bodyRows += row("USDC RECEIVED", `${fmtN(data.usdcAmount)} USDC`, { total: true });
  }

  if (kind === "payout") {
    bodyRows += dividerRow();
    bodyRows += sectionHead("Payout Details");
    if (data.recipientName) bodyRows += row("Recipient", data.recipientName, { bold: true });
    if (data.memo)          bodyRows += row("Memo / Reference", data.memo);
    if (data.usdcAmount)    bodyRows += row("USDC SENT", `${fmtN(data.usdcAmount)} USDC`, { total: true });
  }

  if (kind === "withdraw") {
    bodyRows += dividerRow();
    bodyRows += sectionHead("Withdrawal Details");
    bodyRows += row("Destination", "Bank account on file");
    if (data.usdcAmount) bodyRows += row("HTG-C WITHDRAWN", `${fmtN(data.usdcAmount, 0)} HTG-C`, { total: true });
  }

  if (kind === "yield" || kind === "yield_earned") {
    bodyRows += dividerRow();
    bodyRows += sectionHead(kind === "yield" ? "Yield Deposit" : "Yield Earned");
    if (kind === "yield") {
      if (data.usdcAmount)  bodyRows += row("Principal",    `${fmtN(data.usdcAmount)} USDC`, { bold: true });
      if (data.walletLabel) bodyRows += row("Wallet",       data.walletLabel);
      bodyRows += row("Net APY", `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`);
      if (data.depositedAt) bodyRows += row("Deposit Date", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
    } else {
      if (data.walletLabel) bodyRows += row("Wallet",       data.walletLabel);
      bodyRows += row("Net APY", `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`);
      if (data.depositedAt) bodyRows += row("Earning Since", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
      const earned = data.accruedAmount ?? data.usdcAmount ?? 0;
      bodyRows += row("YIELD EARNED", `+${fmtN(earned)} USDC`, { total: true });
    }
  }

  // SETTLEMENT SECTION
  bodyRows += dividerRow();
  bodyRows += sectionHead("Settlement Verification");
  bodyRows += row("Network", "Stellar Network (Testnet)");
  if (data.stellarTxHash) {
    bodyRows += `<tr><td class="lbl">SETTLEMENT STATUS</td><td class="val" style="color:#1A7F37;font-weight:700">● CONFIRMED ON-CHAIN</td></tr>`;
    bodyRows += row("Transaction Hash", data.stellarTxHash, { mono: true });
    bodyRows += `<tr><td colspan="2" style="padding:6px 12px 0">
      <a href="https://stellar.expert/explorer/testnet/tx/${data.stellarTxHash}"
         target="_blank" rel="noopener"
         style="font-size:11px;color:#33359A;font-weight:600;">
        View on Stellar Expert ↗
      </a></td></tr>`;
  } else {
    bodyRows += row("Settlement Status", "Pending / Unconfirmed");
  }

  // ── Compose full HTML ────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Theo Receipt ${ref}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #F0F0F8;
      display: flex;
      justify-content: center;
      padding: 32px 16px 48px;
    }
    .card {
      background: #fff;
      width: 100%;
      max-width: 620px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(51,53,154,0.12);
    }
    /* Header */
    .header {
      background: #33359A;
      padding: 24px 28px 20px;
    }
    .header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .badge {
      width: 40px; height: 40px;
      background: #FDCF00;
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 900; color: #33359A;
      flex-shrink: 0;
    }
    .brand-name { color: #fff; font-size: 20px; font-weight: 800; line-height: 1; }
    .brand-sub  { color: #6B6B8A; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; margin-top: 3px; }
    .receipt-meta { text-align: right; }
    .receipt-label { color: #FDCF00; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; }
    .receipt-ref   { color: #fff; font-size: 15px; font-weight: 800; margin-top: 2px; }
    .receipt-date  { color: #6B6B8A; font-size: 10px; margin-top: 2px; }
    /* Gold bar */
    .gold-bar { background: #FDCF00; height: 4px; }
    /* Title */
    .tx-title {
      padding: 20px 28px 0;
    }
    .tx-label { font-size: 10px; font-weight: 700; color: #6B6B8A; letter-spacing: 0.1em; text-transform: uppercase; }
    .tx-name  { font-size: 20px; font-weight: 800; color: #33359A; margin-top: 2px; letter-spacing: -0.02em; }
    .tx-accent { width: 32px; height: 3px; background: #FDCF00; border-radius: 2px; margin-top: 6px; }
    /* Table */
    .body { padding: 16px 0 0; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #E8E8F5; }
    td { padding: 9px 28px; font-size: 13px; vertical-align: top; }
    td.lbl { color: #6B6B8A; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; width: 45%; }
    td.val { color: #1A1A3A; text-align: right; font-size: 13px; }
    tr.section-head td {
      background: #F7F7FB;
      color: #6B6B8A;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      padding: 8px 28px;
      border-bottom: 2px solid #33359A;
    }
    tr.divider-row td { padding: 6px 0; background: transparent; border: none; }
    tr.total-row {
      background: #33359A;
      border: none;
    }
    tr.total-row td {
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 14px 28px;
    }
    tr.total-row td.val {
      color: #FDCF00;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    /* Footer note */
    .footer-note {
      padding: 14px 28px;
      font-size: 10px;
      color: #6B6B8A;
      border-top: 1px solid #E8E8F5;
      line-height: 1.6;
    }
    /* Footer bar */
    .footer-bar {
      background: #33359A;
      padding: 12px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer-bar .left { color: #fff; font-size: 11px; font-weight: 700; }
    .footer-bar .right { color: #6B6B8A; font-size: 10px; }
    /* Print button */
    .print-btn {
      display: block;
      width: calc(100% - 56px);
      max-width: 620px;
      margin: 16px auto 0;
      padding: 12px;
      background: #33359A;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
    }
    .print-btn:hover { background: #3E40B0; }
    @media print {
      body { background: white; padding: 0; }
      .card { box-shadow: none; border-radius: 0; max-width: 100%; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div style="width:100%;max-width:620px">
    <div class="card">
      <div class="header">
        <div class="header-top">
          <div class="brand">
            <div class="badge">T</div>
            <div>
              <div class="brand-name">Theo</div>
              <div class="brand-sub">For Business</div>
            </div>
          </div>
          <div class="receipt-meta">
            <div class="receipt-label">Official Receipt</div>
            ${ref ? `<div class="receipt-ref">${ref}</div>` : ""}
            <div class="receipt-date">${dateStr}</div>
          </div>
        </div>
      </div>
      <div class="gold-bar"></div>
      <div class="tx-title">
        <div class="tx-label">Transaction Type</div>
        <div class="tx-name">${kindLabel(kind)}</div>
        <div class="tx-accent"></div>
      </div>
      <div class="body">
        <table>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
      <div class="footer-note">
        This receipt is an automatically generated record of the above transaction processed by Theo Finance S.A.<br>
        For queries contact <strong>support@theo.ht</strong> · theo.ht · Port-au-Prince, Haiti
      </div>
      <div class="footer-bar">
        <span class="left">Theo for Business</span>
        <span class="right">Haiti HTG / USDC Corridor · Powered by Stellar</span>
      </div>
    </div>
    <button class="print-btn" onclick="window.print()">Save as PDF / Print</button>
  </div>
</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────
export function generateReceipt(data: ReceiptData): void {
  try {
    const html = buildHtml(data);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank", "noopener");
    if (!win) {
      // Popup blocked — fall back to inline data URI in same tab
      const reader = new FileReader();
      reader.onload = () => {
        const a = document.createElement("a");
        a.href = reader.result as string;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      reader.readAsDataURL(blob);
    }
    // Revoke after giving the new tab time to load
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    console.error("Receipt generation error:", e);
    toast.error("Could not generate receipt — " + (e as Error).message);
  }
}
