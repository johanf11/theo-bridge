import jsPDF from "jspdf";
import { toast } from "sonner";

// ── Brand colours ─────────────────────────────────────────────────────────────
const NAVY  = [51,  53,  154] as const;   // #33359A
const GOLD  = [253, 207,   0] as const;   // #FDCF00
const INK   = [26,  26,   58] as const;   // ~#1A1A3A
const MID   = [107, 107, 138] as const;   // #6B6B8A
const CREAM = [247, 247, 251] as const;   // ~#F7F7FB
const WHITE = [255, 255, 255] as const;
const GREEN = [26,  127,  55] as const;   // #1A7F37

// ── Types ─────────────────────────────────────────────────────────────────────
export type ReceiptData = {
  kind: "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield" | "yield_earned";
  referenceNumber?: string;
  createdAt: string;
  htgAmount?: number;
  usdcAmount?: number;   // net USDC received (after fee)
  usdcGross?: number;    // pre-fee USDC notional
  feeUsdc?: number;      // total fee in USDC
  feeBps?: number;       // total fee in basis points
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
  // Normalise DB enum values (e.g. "usdc_conversion") to receipt kind
  const rawKind = data.kind as string;
  const kind: ReceiptData["kind"] =
    rawKind === "usdc_conversion" ? "conversion" :
    rawKind === "htgc_usdc_swap"  ? "swap"       :
    data.kind;

  const doc  = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW   = 210;
  const PH   = 297;
  const L    = 18;
  const R    = PW - 18;
  const W    = R - L;
  let y      = 0;

  // ── Navy header ─────────────────────────────────────────────────────────────
  fill(doc, NAVY);
  doc.rect(0, 0, PW, 40, "F");

  // Gold "T" badge
  fill(doc, GOLD);
  doc.rect(L, 10, 14, 14, "F");
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("T", L + 7, 20, { align: "center" });

  // "Theo for Business"
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Theo", L + 20, 19);
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("FOR BUSINESS", L + 20, 24);

  // "OFFICIAL RECEIPT" — top right
  ink(doc, GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("OFFICIAL RECEIPT", R, 15, { align: "right" });
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const dateStr = new Date(data.createdAt).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.text(dateStr, R, 21, { align: "right" });

  // Gold rule
  fill(doc, GOLD);
  doc.rect(0, 40, PW, 3, "F");

  y = 52;

  // ── Kind + reference ─────────────────────────────────────────────────────
  ink(doc, MID);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("TRANSACTION TYPE", L, y);
  if (data.referenceNumber) doc.text("REFERENCE", L + W / 2, y);

  y += 5;
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(kindLabel(kind), L, y);
  if (data.referenceNumber) {
    doc.setFontSize(13);
    doc.text(data.referenceNumber, L + W / 2, y);
  }

  y += 3;
  fill(doc, GOLD);
  doc.rect(L, y, 24, 2, "F");
  y += 8;

  // ── Hero amount box ──────────────────────────────────────────────────────
  fill(doc, NAVY);
  doc.rect(L, y, W, 20, "F");

  const primLabel = (() => {
    if (kind === "htgc_mint") return "HTG DEPOSITED";
    if (kind === "yield" || kind === "yield_earned") return "AMOUNT";
    return "USDC AMOUNT";
  })();
  const primValue = (() => {
    if (kind === "htgc_mint") return `${fmtN(data.htgAmount ?? 0)} HTG`;
    if (kind === "yield_earned") return `+${fmtN(data.accruedAmount ?? data.usdcAmount ?? 0)} USDC`;
    if (kind === "yield") return `${fmtN(data.usdcAmount ?? 0)} USDC`;
    return `${fmtN(data.usdcAmount ?? 0)} USDC`;
  })();

  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(primLabel, L + 6, y + 6);
  ink(doc, GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(primValue, L + 6, y + 15);

  const secLabel = (() => {
    if (kind === "conversion") return data.feeUsdc != null ? "THEO FEE" : "HTG SENT";
    if (kind === "htgc_mint") return "HTG-C MINTED";
    if (kind === "swap") return "HTG-C BURNED";
    if (kind === "yield") return "NET APY";
    return null;
  })();
  const secValue = (() => {
    if (kind === "conversion") return data.feeUsdc != null
      ? `${fmtN(data.feeUsdc)} USDC`
      : `${fmtN(data.htgAmount ?? 0)} HTG`;
    if (kind === "htgc_mint") return `${fmtN(data.htgAmount ?? 0, 0)} HTG-C`;
    if (kind === "swap") return `${fmtN(data.htgAmount ?? 0, 0)} HTG-C`;
    if (kind === "yield") return `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`;
    return null;
  })();
  if (secLabel && secValue) {
    ink(doc, WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(secLabel, R - 6, y + 6, { align: "right" });
    doc.setFontSize(17);
    doc.text(secValue, R - 6, y + 15, { align: "right" });
  }

  y += 26;

  // ── Detail rows ──────────────────────────────────────────────────────────
  const rows: Array<[string, string]> = [];

  rows.push(["Date", dateStr]);
  rows.push(["Status", data.status ?? "COMPLETED"]);

  if (kind === "conversion") {
    if (data.rate)            rows.push(["Exchange Rate", `${fmtN(data.rate, 2)} HTG / USDC`]);
    if (data.htgAmount)       rows.push(["HTG Sent",      `${fmtN(data.htgAmount)} HTG`]);
    if (data.usdcGross != null) rows.push(["USDC (gross)", `${fmtN(data.usdcGross)} USDC`]);
    if (data.feeUsdc != null) {
      const bpsLabel = data.feeBps != null ? ` (${(data.feeBps / 100).toFixed(2)}%)` : "";
      rows.push(["Theo Fee" + bpsLabel, `${fmtN(data.feeUsdc)} USDC`]);
    }
    if (data.usdcAmount)      rows.push(["USDC Received", `${fmtN(data.usdcAmount)} USDC`]);
  }
  if (kind === "htgc_mint") {
    if (data.htgAmount) {
      rows.push(["HTG Deposited", `${fmtN(data.htgAmount)} HTG`]);
      rows.push(["HTG-C Minted",  `${fmtN(data.htgAmount, 0)} HTG-C`]);
    }
    rows.push(["Peg Ratio", "1 : 1  (1 HTG-C = 1 HTG)"]);
  }
  if (kind === "swap") {
    if (data.htgAmount)  rows.push(["HTG-C Burned",  `${fmtN(data.htgAmount, 0)} HTG-C`]);
    if (data.usdcAmount) rows.push(["USDC Received", `${fmtN(data.usdcAmount)} USDC`]);
  }
  if (kind === "withdraw") {
    if (data.usdcAmount) rows.push(["HTG-C Withdrawn", `${fmtN(data.usdcAmount, 0)} HTG-C`]);
    rows.push(["Destination", "Bank account on file"]);
  }
  if (kind === "payout") {
    if (data.usdcAmount)    rows.push(["USDC Sent",  `${fmtN(data.usdcAmount)} USDC`]);
    if (data.recipientName) rows.push(["Recipient",  data.recipientName]);
    if (data.memo)          rows.push(["Memo",       data.memo]);
  }
  if (kind === "yield") {
    if (data.usdcAmount)  rows.push(["Principal",    `${fmtN(data.usdcAmount)} USDC`]);
    if (data.walletLabel) rows.push(["Wallet",        data.walletLabel]);
    rows.push(["Net APY", `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`]);
    if (data.depositedAt) rows.push(["Deposit Date", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })]);
  }
  if (kind === "yield_earned") {
    if (data.accruedAmount !== undefined) rows.push(["Yield Earned", `${fmtN(data.accruedAmount)} USDC`]);
    if (data.walletLabel) rows.push(["Wallet",        data.walletLabel]);
    rows.push(["Net APY", `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`]);
    if (data.depositedAt) rows.push(["Earning Since", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })]);
  }
  if (data.referenceNumber) rows.push(["Reference", data.referenceNumber]);
  if (data.customerName)    rows.push(["Account",   data.customerName]);

  // Draw rows
  const ROW_H  = 11;
  const COL_W  = (W - 4) / 2;
  const rowStart = y;

  rows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const rx  = L + col * (COL_W + 4);
    const ry  = rowStart + row * (ROW_H + 2);

    fill(doc, row % 2 === 0 ? CREAM : WHITE);
    doc.rect(rx, ry, COL_W, ROW_H, "F");
    stroke(doc, [235, 235, 245]);
    doc.rect(rx, ry, COL_W, ROW_H, "S");

    ink(doc, MID);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), rx + 3, ry + 4);

    ink(doc, INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const maxChars = Math.floor(COL_W / 2.1);
    const display  = value.length > maxChars ? value.slice(0, maxChars - 1) + "…" : value;
    doc.text(display, rx + 3, ry + 9);
  });

  const totalRows = Math.ceil(rows.length / 2);
  y = rowStart + totalRows * (ROW_H + 2) + 8;

  // ── Stellar TX hash ──────────────────────────────────────────────────────
  if (data.stellarTxHash) {
    fill(doc, [239, 246, 255]);
    stroke(doc, [191, 219, 254]);
    doc.rect(L, y, W, 15, "FD");

    ink(doc, MID);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("STELLAR TRANSACTION", L + 4, y + 5);

    ink(doc, NAVY);
    doc.setFont("courier", "normal");
    doc.setFontSize(7.5);
    const hash = data.stellarTxHash;
    doc.text(hash.slice(0, 32) + "…" + hash.slice(-8), L + 4, y + 11);

    y += 21;
  }

  // ── Settlement note ──────────────────────────────────────────────────────
  fill(doc, CREAM);
  stroke(doc, [235, 235, 245]);
  doc.rect(L, y, W, 11, "FD");
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("This receipt is automatically generated by Theo. Settlement on the Stellar network.", L + 4, y + 5);
  doc.text("Questions? support@theo.ht  ·  theo.ht", L + 4, y + 10);
  y += 17;

  // ── Stellar confirmed ────────────────────────────────────────────────────
  if (data.stellarTxHash) {
    fill(doc, GREEN);
    doc.circle(L + 2, y - 2, 1.5, "F");
    ink(doc, GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Confirmed on Stellar testnet", L + 6, y - 0.5);
    y += 6;
  }

  // ── Footer bar ───────────────────────────────────────────────────────────
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

  // ── Save ─────────────────────────────────────────────────────────────────
  const ref = data.referenceNumber ?? new Date(data.createdAt).toISOString().slice(0, 10);
  doc.save(`theo-receipt-${ref}.pdf`);
}
