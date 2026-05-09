import jsPDF from "jspdf";
import { toast } from "sonner";

// ── Brand colours ─────────────────────────────────────────────────────────────
const NAVY   = [51,  53,  154] as const;   // #33359A
const GOLD   = [253, 207,   0] as const;   // #FDCF00
const INK    = [26,  26,   58] as const;   // #1A1A3A
const MID    = [107, 107, 138] as const;   // #6B6B8A
const LIGHT  = [232, 232, 245] as const;   // divider lines
const CREAM  = [247, 247, 251] as const;   // subtle row bg
const WHITE  = [255, 255, 255] as const;
const GREEN  = [26,  127,  55] as const;   // #1A7F37
const RED    = [185,  28,  28] as const;   // fee deduction colour

// ── Types ─────────────────────────────────────────────────────────────────────
export type ReceiptData = {
  kind: "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield" | "yield_earned";
  referenceNumber?: string;
  poReference?: string;      // purchase order / external reference
  initiatedBy?: string;      // name of the user who initiated
  createdAt: string;
  htgAmount?: number;
  usdcAmount?: number;       // net USDC received (after fee)
  usdcGross?: number;        // pre-fee USDC notional
  feeUsdc?: number;          // total fee in USDC
  feeBps?: number;           // total fee in basis points
  theoFeeUsdc?: number;      // Theo service fee portion
  theoFeeBps?: number;       // Theo service fee bps
  corridorFeeUsdc?: number;  // corridor/settlement fee portion
  corridorFeeBps?: number;   // corridor fee bps
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
function fill(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function ink(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}
function stroke(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function fmtN(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
function kindLabel(kind: ReceiptData["kind"]) {
  const map: Record<ReceiptData["kind"], string> = {
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

// ── Row drawing ───────────────────────────────────────────────────────────────
type RowOpts = {
  highlight?: boolean;   // navy bg, gold value — used for NET TOTAL
  deduction?: boolean;   // red value — used for fees
  labelBold?: boolean;
  valueBold?: boolean;
  divider?: boolean;     // draw bottom rule
  indent?: number;       // left indent for sub-items
  valueSize?: number;
};

function drawRow(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  L: number,
  R: number,
  opts: RowOpts = {},
): number {
  const ROW_H  = 10;
  const indent = opts.indent ?? 0;

  if (opts.highlight) {
    fill(doc, NAVY);
    doc.rect(L, y, R - L, ROW_H + 2, "F");
  }

  // Label
  ink(doc, opts.highlight ? WHITE : MID);
  doc.setFont("helvetica", opts.labelBold || opts.highlight ? "bold" : "normal");
  doc.setFontSize(opts.highlight ? 8.5 : 7.5);
  doc.text(label.toUpperCase(), L + 4 + indent, y + (opts.highlight ? 7.5 : 6.5));

  // Value
  const valColor = opts.highlight ? GOLD : opts.deduction ? RED : INK;
  ink(doc, valColor);
  doc.setFont("helvetica", opts.valueBold || opts.highlight ? "bold" : "normal");
  doc.setFontSize(opts.highlight ? (opts.valueSize ?? 13) : (opts.valueSize ?? 9));
  doc.text(value, R - 4, y + (opts.highlight ? 7.5 : 6.5), { align: "right" });

  if (opts.divider) {
    stroke(doc, LIGHT);
    doc.setLineWidth(0.25);
    doc.line(L, y + ROW_H + 1.5, R, y + ROW_H + 1.5);
  }

  return opts.highlight ? ROW_H + 4 : ROW_H + 1;
}

// Thin section-header label above a block
function sectionHeader(doc: jsPDF, label: string, y: number, L: number) {
  ink(doc, MID);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(label.toUpperCase(), L, y);
  return 5;
}

// Full-width horizontal rule
function rule(doc: jsPDF, y: number, L: number, R: number, color = LIGHT, thickness = 0.4) {
  stroke(doc, color);
  doc.setLineWidth(thickness);
  doc.line(L, y, R, y);
  return 4;
}

// Status pill — inline coloured text with dot
function statusBadge(status: string): string {
  const labels: Record<string, string> = {
    COMPLETED: "● SETTLED",
    FAILED:    "● FAILED",
    EXPIRED:   "● EXPIRED",
    QUOTED:    "● PENDING",
    FUNDED:    "● PROCESSING",
    RELEASING: "● RELEASING",
    PENDING:   "● PENDING",
  };
  return labels[status] ?? `● ${status}`;
}

// ── Main generator ────────────────────────────────────────────────────────────
export function generateReceipt(data: ReceiptData): void {
  try {
    _buildPdf(data);
  } catch (e) {
    console.error("Receipt generation error:", e);
    toast.error("Could not generate receipt — " + (e as Error).message);
  }
}

function _buildPdf(data: ReceiptData): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW  = 210;
  const PH  = 297;
  const L   = 18;
  const R   = PW - 18;
  let y     = 0;

  const dateStr = new Date(data.createdAt).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZoneName: "short",
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HEADER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  fill(doc, NAVY);
  doc.rect(0, 0, PW, 46, "F");

  // Gold T badge
  fill(doc, GOLD);
  doc.roundedRect(L, 10, 16, 16, 2, 2, "F");
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("T", L + 8, 22, { align: "center" });

  // Brand name
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Theo", L + 22, 20);
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("FOR BUSINESS", L + 22, 25.5);

  // Right: OFFICIAL RECEIPT + ref
  ink(doc, GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("OFFICIAL RECEIPT", R, 16, { align: "right" });

  if (data.referenceNumber) {
    ink(doc, WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(data.referenceNumber, R, 25, { align: "right" });
  }

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(dateStr, R, 31, { align: "right" });

  // Gold rule
  fill(doc, GOLD);
  doc.rect(0, 46, PW, 3, "F");

  y = 58;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION TYPE TITLE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(kindLabel(data.kind), L, y);

  y += 3;
  fill(doc, GOLD);
  doc.rect(L, y, 28, 2.5, "F");
  y += 9;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ACCOUNT DETAILS SECTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  y += sectionHeader(doc, "Account", y, L);
  y += rule(doc, y, L, R, NAVY, 0.6);

  const statusStr = statusBadge(data.status ?? "COMPLETED");
  const statusColor = (data.status ?? "COMPLETED") === "COMPLETED" ? GREEN
    : (data.status === "FAILED" || data.status === "EXPIRED") ? RED
    : GOLD;

  if (data.customerName) {
    y += drawRow(doc, "Client", data.customerName, y, L, R, { valueBold: true, divider: true });
  }
  y += drawRow(doc, "Transaction Date", dateStr, y, L, R, { divider: true });

  // Status row — custom colour
  fill(doc, CREAM);
  doc.rect(L, y, R - L, 11, "F");
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("STATUS", L + 4, y + 6.5);
  ink(doc, statusColor);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(statusStr, R - 4, y + 6.5, { align: "right" });
  stroke(doc, LIGHT);
  doc.setLineWidth(0.25);
  doc.line(L, y + 11 + 1.5, R, y + 11 + 1.5);
  y += 12;

  if (data.poReference) {
    y += drawRow(doc, "Purchase Order / Reference", data.poReference, y, L, R, { valueBold: true, divider: true });
  }
  if (data.initiatedBy) {
    y += drawRow(doc, "Initiated By", data.initiatedBy, y, L, R, { divider: false });
  }

  y += 10;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION BREAKDOWN — CONVERSION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (data.kind === "conversion") {
    y += sectionHeader(doc, "Transaction Breakdown", y, L);
    y += rule(doc, y, L, R, NAVY, 0.6);

    if (data.htgAmount) {
      y += drawRow(doc, "HTG Submitted", `${fmtN(data.htgAmount)} HTG`, y, L, R, { divider: true, valueBold: true });
    }
    if (data.rate) {
      y += drawRow(doc, "Exchange Rate (BRH)", `${fmtN(data.rate, 2)} HTG / USDC`, y, L, R, { divider: true });
    }
    if (data.usdcGross != null) {
      y += drawRow(doc, "USDC Gross", `${fmtN(data.usdcGross)} USDC`, y, L, R, { divider: true });
    }

    // Fee rows — itemised if we have the breakdown, total if not
    const hasItemisedFees = data.theoFeeUsdc != null && data.corridorFeeUsdc != null;

    if (hasItemisedFees) {
      const theoBps   = data.theoFeeBps   != null ? ` (${(data.theoFeeBps / 100).toFixed(2)}%)` : "";
      const corridorBps = data.corridorFeeBps != null ? ` (${(data.corridorFeeBps / 100).toFixed(2)}%)` : "";
      y += drawRow(doc, `Theo Service Fee${theoBps}`,   `−${fmtN(data.theoFeeUsdc!)} USDC`,     y, L, R, { deduction: true, divider: true, indent: 6 });
      y += drawRow(doc, `Settlement Corridor${corridorBps}`, `−${fmtN(data.corridorFeeUsdc!)} USDC`, y, L, R, { deduction: true, divider: true, indent: 6 });
    } else if (data.feeUsdc != null) {
      const bpsLabel = data.feeBps != null ? ` (${(data.feeBps / 100).toFixed(2)}%)` : "";
      y += drawRow(doc, `Theo Fee${bpsLabel}`, `−${fmtN(data.feeUsdc)} USDC`, y, L, R, { deduction: true, divider: true, indent: 6 });
    }

    // Thick rule before total
    y += 1;
    y += rule(doc, y, L, R, NAVY, 0.8);
    y += 1;

    // NET RECEIVED — highlighted hero row
    if (data.usdcAmount != null) {
      y += drawRow(doc, "Net USDC Received", `${fmtN(data.usdcAmount)} USDC`, y, L, R, { highlight: true, valueSize: 14 });
    }

    y += 10;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION BREAKDOWN — HTG-C MINT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (data.kind === "htgc_mint") {
    y += sectionHeader(doc, "Transaction Breakdown", y, L);
    y += rule(doc, y, L, R, NAVY, 0.6);

    if (data.htgAmount) {
      y += drawRow(doc, "HTG Deposited",  `${fmtN(data.htgAmount)} HTG`,   y, L, R, { divider: true, valueBold: true });
      y += drawRow(doc, "Peg Ratio",      "1 : 1  (1 HTG-C = 1 HTG)",      y, L, R, { divider: true });
    }
    y += 1;
    y += rule(doc, y, L, R, NAVY, 0.8);
    y += 1;
    if (data.htgAmount) {
      y += drawRow(doc, "HTG-C Minted", `${fmtN(data.htgAmount, 0)} HTG-C`, y, L, R, { highlight: true });
    }
    y += 10;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION BREAKDOWN — SWAP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (data.kind === "swap") {
    y += sectionHeader(doc, "Transaction Breakdown", y, L);
    y += rule(doc, y, L, R, NAVY, 0.6);

    if (data.htgAmount) {
      y += drawRow(doc, "HTG-C Redeemed", `${fmtN(data.htgAmount, 0)} HTG-C`, y, L, R, { divider: true, valueBold: true });
    }
    if (data.rate) {
      y += drawRow(doc, "Exchange Rate", `${fmtN(data.rate, 2)} HTG / USDC`, y, L, R, { divider: true });
    }
    y += 1;
    y += rule(doc, y, L, R, NAVY, 0.8);
    y += 1;
    if (data.usdcAmount) {
      y += drawRow(doc, "USDC Received", `${fmtN(data.usdcAmount)} USDC`, y, L, R, { highlight: true });
    }
    y += 10;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION BREAKDOWN — PAYOUT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (data.kind === "payout") {
    y += sectionHeader(doc, "Payout Details", y, L);
    y += rule(doc, y, L, R, NAVY, 0.6);

    if (data.recipientName) {
      y += drawRow(doc, "Recipient",   data.recipientName,                y, L, R, { divider: true, valueBold: true });
    }
    if (data.memo) {
      y += drawRow(doc, "Memo / Reference", data.memo,                    y, L, R, { divider: true });
    }
    y += 1;
    y += rule(doc, y, L, R, NAVY, 0.8);
    y += 1;
    if (data.usdcAmount) {
      y += drawRow(doc, "USDC Sent",   `${fmtN(data.usdcAmount)} USDC`,  y, L, R, { highlight: true });
    }
    y += 10;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION BREAKDOWN — WITHDRAW
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (data.kind === "withdraw") {
    y += sectionHeader(doc, "Withdrawal Details", y, L);
    y += rule(doc, y, L, R, NAVY, 0.6);

    y += drawRow(doc, "Destination", "Bank account on file", y, L, R, { divider: true });
    y += 1;
    y += rule(doc, y, L, R, NAVY, 0.8);
    y += 1;
    if (data.usdcAmount) {
      y += drawRow(doc, "HTG-C Withdrawn", `${fmtN(data.usdcAmount, 0)} HTG-C`, y, L, R, { highlight: true });
    }
    y += 10;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRANSACTION BREAKDOWN — YIELD
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (data.kind === "yield" || data.kind === "yield_earned") {
    y += sectionHeader(doc, data.kind === "yield" ? "Yield Deposit" : "Yield Earned", y, L);
    y += rule(doc, y, L, R, NAVY, 0.6);

    if (data.kind === "yield") {
      if (data.usdcAmount) y += drawRow(doc, "Principal",    `${fmtN(data.usdcAmount)} USDC`,           y, L, R, { divider: true, valueBold: true });
      if (data.walletLabel) y += drawRow(doc, "Wallet",       data.walletLabel,                          y, L, R, { divider: true });
      y += drawRow(doc, "Net APY",        `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`,               y, L, R, { divider: true });
      if (data.depositedAt) y += drawRow(doc, "Deposit Date", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), y, L, R, { divider: false });
    } else {
      if (data.walletLabel)  y += drawRow(doc, "Wallet",      data.walletLabel,                          y, L, R, { divider: true });
      y += drawRow(doc, "Net APY",        `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`,               y, L, R, { divider: true });
      if (data.depositedAt)  y += drawRow(doc, "Earning Since", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), y, L, R, { divider: true });
      y += 1;
      y += rule(doc, y, L, R, NAVY, 0.8);
      y += 1;
      const earnedAmt = data.accruedAmount ?? data.usdcAmount ?? 0;
      y += drawRow(doc, "Yield Earned",  `+${fmtN(earnedAmt)} USDC`,                                   y, L, R, { highlight: true });
    }
    y += 10;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SETTLEMENT VERIFICATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  y += sectionHeader(doc, "Settlement Verification", y, L);
  y += rule(doc, y, L, R, NAVY, 0.6);

  y += drawRow(doc, "Network", "Stellar Network (Testnet)", y, L, R, { divider: true });

  if (data.stellarTxHash) {
    // Confirmed status
    fill(doc, [240, 253, 244]);
    doc.rect(L, y, R - L, 11, "F");
    stroke(doc, [187, 247, 208]);
    doc.rect(L, y, R - L, 11, "S");
    ink(doc, MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("SETTLEMENT STATUS", L + 4, y + 6.5);
    ink(doc, GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("● CONFIRMED ON-CHAIN", R - 4, y + 6.5, { align: "right" });
    stroke(doc, LIGHT);
    doc.setLineWidth(0.25);
    doc.line(L, y + 12.5, R, y + 12.5);
    y += 13;

    // TX hash — full width, monospace
    fill(doc, CREAM);
    doc.rect(L, y, R - L, 13, "F");
    ink(doc, MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("TRANSACTION HASH", L + 4, y + 5);
    ink(doc, NAVY);
    doc.setFont("courier", "normal");
    doc.setFontSize(7.5);
    const hash = data.stellarTxHash;
    doc.text(hash.slice(0, 32) + "…" + hash.slice(-8), L + 4, y + 10.5);
    stroke(doc, LIGHT);
    doc.setLineWidth(0.25);
    doc.line(L, y + 14.5, R, y + 14.5);
    y += 16;
  } else {
    y += drawRow(doc, "Settlement Status", "Pending / Unconfirmed", y, L, R, { divider: false });
  }

  y += 10;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FOOTER NOTE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  fill(doc, CREAM);
  stroke(doc, LIGHT);
  doc.setLineWidth(0.3);
  doc.rect(L, y, R - L, 14, "FD");
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(
    "This receipt is an automatically generated record of the above transaction processed by Theo.",
    L + 4, y + 5,
  );
  doc.text(
    "For disputes or queries, contact support@theo.ht  ·  theo.ht  ·  Theo Finance S.A., Port-au-Prince, Haiti",
    L + 4, y + 10,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FOOTER BAR
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  fill(doc, GOLD);
  doc.rect(0, PH - 20, PW, 3, "F");
  fill(doc, NAVY);
  doc.rect(0, PH - 17, PW, 17, "F");

  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Theo for Business", L, PH - 6);

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Haiti HTG / USDC Corridor  ·  Powered by Stellar", R, PH - 6, { align: "right" });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SAVE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const ref = data.referenceNumber ?? new Date(data.createdAt).toISOString().slice(0, 10);
  doc.save(`theo-receipt-${ref}.pdf`);
}
