import jsPDF from "jspdf";
import { toast } from "sonner";

// ── Brand colours  (from Theo Receipt.html spec) ──────────────────────────────
const NAVY  = [51,  53, 154] as const;   // #33359A
const GOLD  = [253, 207,   0] as const;  // #FDCF00
const INK   = [26,  26,  58] as const;   // #1A1A3A
const MID   = [107, 107, 138] as const;  // #6B6B8A
const BG    = [247, 247, 251] as const;  // #F7F7FB
const WHITE = [255, 255, 255] as const;
const HAIR  = [229, 229, 238] as const;  // #E5E5EE
const RED   = [194,  51,  58] as const;  // #C2333A
const GREEN = [31,  138,  91] as const;  // #1F8A5B
const DGOLD = [181, 138,   0] as const;  // #B58A00 (pending amber)

// ── Page constants  (A4 portrait, all in pt) ──────────────────────────────────
const PW = 595;   // page width
const PH = 842;   // page height
const L  = 36;    // left margin
const R  = 559;   // right margin  (PW - 36)
const W  = 523;   // content width (R - L)

const ROW_H    = 22;  // height per data row (pt)
const SEC_HGAP = 22;  // vertical gap between sections
const TOTAL_H  = 38;  // total-bar height
const HASH_H   = 27;  // hash-row height

// ── Types ─────────────────────────────────────────────────────────────────────
export type ReceiptData = {
  kind: "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield" | "yield_earned";
  referenceNumber?: string;
  createdAt: string;
  completedAt?: string | null;
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
  principalBalance?: number; // account balance that earned the yield
  customerName?: string;
  destinationAddress?: string | null;
  /** Human-readable wallet label (e.g. "Payroll") — shown alongside the truncated address. */
  destinationWalletLabel?: string | null;
  /** When kind is swap (or DB htgc_usdc_swap): which leg the customer initiated. */
  swapDirection?: "htgc_to_usdc" | "usdc_to_htgc";
  /** USDC → HTG-C: gross HTG-C notionally from USDC at rate (optional; inferred from usdcGross × rate if omitted). */
  htgGross?: number;
};

export type SwapReceiptDirection = "htgc_to_usdc" | "usdc_to_htgc";

/** Prefer explicit swapDirection from DB; otherwise infer from amount vs rate consistency. */
function resolveSwapReceiptDirection(data: ReceiptData): SwapReceiptDirection {
  const d = data.swapDirection;
  if (d === "htgc_to_usdc" || d === "usdc_to_htgc") return d;
  const htg = data.htgAmount;
  const usdc = data.usdcAmount;
  const rate = data.rate;
  if (htg == null || usdc == null || rate == null || htg <= 0 || usdc <= 0 || rate <= 0) {
    return "htgc_to_usdc";
  }
  const errHtgFirst = Math.abs(htg / rate - usdc);
  const errUsdcFirst = Math.abs(usdc * rate - htg);
  const eps = 1e-4;
  if (errUsdcFirst + eps < errHtgFirst) return "usdc_to_htgc";
  if (errHtgFirst + eps < errUsdcFirst) return "htgc_to_usdc";
  return "htgc_to_usdc";
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function fill  (doc: jsPDF, c: readonly [number, number, number]) { doc.setFillColor  (c[0], c[1], c[2]); }
function ink   (doc: jsPDF, c: readonly [number, number, number]) { doc.setTextColor  (c[0], c[1], c[2]); }
function stroke(doc: jsPDF, c: readonly [number, number, number]) { doc.setDrawColor  (c[0], c[1], c[2]); }

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtN(n: number, d = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}
function fmtHtg (n: number) { return "HTG "  + fmtN(n); }
/** Whole gourdes only — no fractional HTG on receipts. */
function fmtHtgInteger(n: number) {
  return "HTG " + Math.round(n).toLocaleString("en-US");
}
function fmtUsdc(n: number) { return "USDC " + fmtN(n); }
function fmtRate(r: number) { return "1 USD = " + r.toFixed(4) + " HTG"; }

function fmtDate(iso: string) {
  const dt = new Date(iso);
  const date = dt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const time =
    dt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }) + " UTC";
  return date + " · " + time;
}
function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

// ── Entry point ───────────────────────────────────────────────────────────────
export function generateReceipt(data: ReceiptData): void {
  try {
    _buildPdf(data);
  } catch (e) {
    console.error("Receipt generation error:", e);
    toast.error("Could not generate receipt — " + (e as Error).message);
  }
}

// ── PDF builder ───────────────────────────────────────────────────────────────
function _buildPdf(data: ReceiptData): void {
  // Normalise DB enum values to receipt kind string
  const rawKind = data.kind as string;
  const kind: ReceiptData["kind"] =
    rawKind === "usdc_conversion" ? "conversion" :
    rawKind === "htgc_usdc_swap"  ? "swap"       :
    data.kind;

  // jsPDF in pt units — 1 pt == 1 unit, maps directly to spec coordinates
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [PW, PH] });
  let y = 0;

  // ════════════════════════════════════════════════════════════════════════════
  // HEADER  (0 – 64 pt)
  // ════════════════════════════════════════════════════════════════════════════

  // Navy background
  fill(doc, NAVY);
  doc.rect(0, 0, PW, 64, "F");

  // Gold "T" badge  (36pt from left, 14pt from top, 32 × 32 pt)
  fill(doc, GOLD);
  doc.rect(L, 14, 32, 32, "F");
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text("T", L + 16, 14 + 23, { align: "center" }); // baseline ≈ 14+22 = 36

  // Brand name + "FOR BUSINESS" tagline
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text("Theo", L + 44, 30);      // x=80 pt, baseline at 30

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("FOR BUSINESS", L + 44, 42); // 4pt below "Theo" line

  // Header right — label / ref / date
  ink(doc, GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("OFFICIAL RECEIPT", R, 22, { align: "right" });

  if (data.referenceNumber) {
    ink(doc, WHITE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(data.referenceNumber, R, 33, { align: "right" });
  }

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(fmtDateShort(data.createdAt), R, 43, { align: "right" });

  // ── Gold rule  (64 – 67 pt) ──────────────────────────────────────────────
  fill(doc, GOLD);
  doc.rect(0, 64, PW, 3, "F");

  // ════════════════════════════════════════════════════════════════════════════
  // BODY  — starts at y = 99 pt  (64+3 header+rule + 32 top-padding)
  // ════════════════════════════════════════════════════════════════════════════
  y = 99;

  // ── Helper: section header (label + 0.6pt navy rule) ────────────────────
  function drawSection(title: string) {
    ink(doc, MID);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(title.toUpperCase(), L, y + 7);

    y += 13;   // label line + 6pt gap
    stroke(doc, NAVY);
    doc.setLineWidth(0.6);
    doc.line(L, y, R, y);

    y += 12;   // 12pt gap below rule
  }

  // ── Helper: single-column data row ──────────────────────────────────────
  type RowOpts = { bold?: boolean; indent?: boolean; status?: "completed" | "pending" | "failed" };

  function drawRow(label: string, value: string, opts: RowOpts = {}) {
    const xL = opts.indent ? L + 16 : L;

    // Bottom hairline
    stroke(doc, HAIR);
    doc.setLineWidth(0.4);
    doc.line(xL, y + ROW_H, R, y + ROW_H);

    // Row label  (grey, uppercase, 7.5pt)
    ink(doc, MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(label.toUpperCase(), xL, y + 14);

    // Row value  (right-aligned, 9pt)
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(9);

    if (opts.status) {
      const dotClr  = opts.status === "completed" ? GREEN : opts.status === "pending" ? DGOLD : RED;
      const textClr = opts.status === "completed" ? GREEN : opts.status === "pending" ? DGOLD : RED;

      // Measure text first, then place dot to its left
      const tw = doc.getTextWidth(value);
      fill  (doc, dotClr);
      stroke(doc, dotClr);
      doc.circle(R - tw - 9, y + 13, 3, "F");

      ink(doc, textClr);
      doc.text(value, R, y + 15, { align: "right" });

    } else if (opts.indent) {
      ink(doc, RED);
      doc.text(value, R, y + 15, { align: "right" });

    } else {
      ink(doc, INK);
      doc.text(value, R, y + 15, { align: "right" });
    }

    y += ROW_H;
  }

  // ── Helper: navy total bar ───────────────────────────────────────────────
  function drawTotal(label: string, value: string) {
    y += 10;    // margin-top above bar
    fill(doc, NAVY);
    doc.rect(L, y, W, TOTAL_H, "F");

    ink(doc, WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(label.toUpperCase(), L + 16, y + 24);

    ink(doc, GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(value, R - 16, y + 26, { align: "right" });

    y += TOTAL_H;
  }

  // ── Helper: monospace Stellar hash row ──────────────────────────────────
  function drawHash(hash: string) {
    y += 6;
    fill  (doc, BG);
    stroke(doc, HAIR);
    doc.setLineWidth(0.4);
    doc.rect(L, y, W, HASH_H, "FD");

    ink(doc, INK);
    doc.setFont("courier", "normal");
    doc.setFontSize(7.5);
    // Stellar tx hashes are 64 hex chars. At 7.5pt Courier (~4.5pt/char),
    // 64 × 4.5 = 288pt — well within the 505pt available. Show in full.
    doc.text(hash, L + 9, y + 17);

    y += HASH_H;
  }

  // ── Helper: status row (coloured dot + coloured text) ───────────────────
  function drawStatus(status?: string) {
    const s    = (status ?? "COMPLETED").toUpperCase();
    const tone = s === "COMPLETED" ? "completed" : s === "PENDING" ? "pending" : "failed";
    drawRow("Status", s, { status: tone });
  }

  // ── Helper: gap between sections ────────────────────────────────────────
  function secGap() { y += SEC_HGAP; }

  // ── Helper: TX hash label row + hash block ───────────────────────────────
  function drawTxHash(hash: string) {
    ink(doc, MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("TX HASH", L, y + 14);
    y += ROW_H;
    drawHash(hash);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BODY CONTENT — per receipt kind
  // ════════════════════════════════════════════════════════════════════════════

  if (kind === "conversion") {
    // ACCOUNT
    drawSection("Account");
    if (data.customerName)  drawRow("Client",           data.customerName);
    drawRow("Transaction Date",   fmtDate(data.completedAt ?? data.createdAt));
    drawStatus(data.status);
    if (data.referenceNumber) drawRow("Reference",      data.referenceNumber);

    // TRANSACTION BREAKDOWN (order: rate → HTG sent → USDC gross → fee → net)
    secGap();
    drawSection("Transaction Breakdown");
    if (data.rate) drawRow("Exchange Rate", fmtRate(data.rate));
    if (data.htgAmount) drawRow("HTG Sent", fmtHtgInteger(data.htgAmount), { bold: true });
    if (data.usdcGross != null) drawRow("USDC (gross)", fmtUsdc(data.usdcGross));
    if (data.feeUsdc != null) {
      const pct = data.feeBps != null ? ` (${(data.feeBps / 100).toFixed(2)}%)` : "";
      drawRow("Theo Fee", "$" + fmtN(data.feeUsdc) + pct);
    }
    drawTotal("USDC Received", fmtUsdc(data.usdcAmount ?? 0));

    // SETTLEMENT
    secGap();
    drawSection("Settlement");
    drawRow("Network", "Stellar Network");
    if (data.destinationAddress) {
      const addr = data.destinationAddress;
      const truncated = addr.slice(0, 6) + "…" + addr.slice(-6);
      const walletDisplay = data.destinationWalletLabel
        ? `${data.destinationWalletLabel} · ${truncated}`
        : truncated;
      drawRow("Destination Wallet", walletDisplay);
    }
    if (data.stellarTxHash) {
      drawRow("On-chain", "CONFIRMED", { status: "completed" });
      drawTxHash(data.stellarTxHash);
    }

  } else if (kind === "swap") {
    drawSection("Account");
    if (data.customerName)    drawRow("Client",           data.customerName);
    drawRow("Transaction Date",     fmtDate(data.completedAt ?? data.createdAt));
    drawStatus(data.status);
    if (data.referenceNumber) drawRow("Reference",        data.referenceNumber);

    secGap();
    drawSection("Transaction Breakdown");
    const swapDir = resolveSwapReceiptDirection(data);
    if (swapDir === "htgc_to_usdc") {
      if (data.htgAmount) drawRow("HTG Sent", fmtHtgInteger(data.htgAmount), { bold: true });
      if (data.rate) drawRow("Exchange Rate", fmtRate(data.rate));
      if (data.usdcGross != null) drawRow("USDC (gross)", fmtUsdc(data.usdcGross));
    } else {
      if (data.usdcAmount != null && data.usdcAmount > 0) {
        drawRow("USDC Sent", fmtUsdc(data.usdcAmount), { bold: true });
      }
      if (data.rate) drawRow("Exchange Rate", fmtRate(data.rate));
      const htgGrossVal =
        data.htgGross ??
        Math.round((data.usdcGross ?? data.usdcAmount ?? 0) * (data.rate ?? 0));
      drawRow("HTG-C (gross)", fmtHtgInteger(htgGrossVal));
    }
    if (data.feeUsdc != null) {
      const pct = data.feeBps != null ? ` (${(data.feeBps / 100).toFixed(2)}%)` : "";
      drawRow("Theo Fee", "$" + fmtN(data.feeUsdc) + pct);
    }
    if (swapDir === "htgc_to_usdc") {
      drawTotal("USDC Received", fmtUsdc(data.usdcAmount ?? 0));
    } else {
      drawTotal("HTG Received", fmtHtgInteger(data.htgAmount ?? 0));
    }

    secGap();
    drawSection("Settlement");
    drawRow("Network", "Stellar Network");
    if (data.stellarTxHash) {
      drawRow("On-chain", "CONFIRMED", { status: "completed" });
      drawTxHash(data.stellarTxHash);
    }

  } else if (kind === "payout") {
    drawSection("Account");
    if (data.customerName)    drawRow("Client",           data.customerName);
    if (data.recipientName)   drawRow("Beneficiary",      data.recipientName);
    drawRow("Transaction Date",     fmtDate(data.createdAt));
    drawStatus(data.status);
    if (data.referenceNumber) drawRow("Reference",        data.referenceNumber);

    secGap();
    drawSection("Transaction Breakdown");
    if (data.usdcAmount)    drawRow("USDC Submitted", fmtUsdc(data.usdcAmount), { bold: true });
    if (data.rate)          drawRow("Exchange Rate (BRH)", fmtRate(data.rate));
    if (data.memo)          drawRow("Memo", data.memo);
    drawTotal("Payout Sent", fmtUsdc(data.usdcAmount ?? 0));

    secGap();
    drawSection("Settlement");
    drawRow("Network", "Stellar Network");
    if (data.stellarTxHash) {
      drawRow("On-chain", "CONFIRMED", { status: "completed" });
      drawTxHash(data.stellarTxHash);
    }

  } else if (kind === "htgc_mint") {
    drawSection("Account");
    drawRow("Issuer",               data.customerName ?? "Theo Treasury");
    drawRow("Transaction Date",     fmtDate(data.createdAt));
    drawStatus(data.status);
    if (data.referenceNumber) drawRow("Reference", data.referenceNumber);

    secGap();
    drawSection("Transaction Breakdown");
    if (data.htgAmount) drawRow("HTG Reserve Received", fmtHtg(data.htgAmount), { bold: true });
    drawRow("Reserve Ratio", "1 : 1");
    drawTotal("HTGC Minted", "HTGC " + fmtN(data.htgAmount ?? 0));

    secGap();
    drawSection("Settlement");
    drawRow("Network", "Stellar Network");
    if (data.destinationAddress) {
      const addr = data.destinationAddress;
      const truncated = addr.slice(0, 6) + "…" + addr.slice(-6);
      const walletDisplay = data.destinationWalletLabel
        ? `${data.destinationWalletLabel} · ${truncated}`
        : truncated;
      drawRow("Destination Wallet", walletDisplay);
    }
    if (data.stellarTxHash) {
      drawRow("On-chain", "CONFIRMED", { status: "completed" });
      drawTxHash(data.stellarTxHash);
    }

  } else if (kind === "withdraw") {
    drawSection("Account");
    if (data.customerName)    drawRow("Client",     data.customerName);
    drawRow("Transaction Date",     fmtDate(data.createdAt));
    drawStatus(data.status);
    if (data.referenceNumber) drawRow("Reference",  data.referenceNumber);

    secGap();
    drawSection("Transaction Breakdown");
    drawRow("HTG Withdrawn", fmtHtgInteger(data.htgAmount ?? 0), { bold: true });
    drawTotal("HTG-C Burned", fmtHtgInteger(data.htgAmount ?? 0));

    secGap();
    drawSection("Settlement");
    drawRow("Method",  "Haitian bank transfer via SPIH");
    drawRow("Network", "Stellar Network (HTG-C burn)");
    if (data.stellarTxHash) {
      drawRow("On-chain", "CONFIRMED", { status: "completed" });
      drawTxHash(data.stellarTxHash);
    }

  } else if (kind === "yield" || kind === "yield_earned") {
    drawSection("Account");
    if (data.customerName)  drawRow("Client",         data.customerName);
    if (data.depositedAt)   drawRow("Accrual Period",
                                    fmtDateShort(data.depositedAt) + " – " + fmtDateShort(data.createdAt));
    drawRow("Posting Date",         fmtDate(data.createdAt));
    drawStatus(data.status);
    if (data.referenceNumber) drawRow("Reference",    data.referenceNumber);

    // Derive principal balance if not explicitly stored:
    // principal = yield_earned / (apy * period_days / 365)
    const yieldEarned = data.accruedAmount ?? data.usdcAmount ?? 0;
    let displayBalance = data.principalBalance ?? null;
    if (displayBalance == null && data.netApy && data.netApy > 0 && yieldEarned > 0 && data.depositedAt) {
      const days = (new Date(data.createdAt).getTime() - new Date(data.depositedAt).getTime()) / 86_400_000;
      if (days > 0) displayBalance = Math.round((yieldEarned / (data.netApy * days / 365)) * 100) / 100;
    }

    secGap();
    drawSection("Earnings Breakdown");
    if (displayBalance != null) drawRow("Balance",        fmtUsdc(displayBalance));
    if (data.netApy != null)    drawRow("APY",            (data.netApy * 100).toFixed(2) + "%");
    drawTotal("Yield Earned (USDC)", fmtUsdc(yieldEarned));

    secGap();
    drawSection("Settlement");
    drawRow("Network", "Stellar Network");
    drawRow("Distribution", "AUTO-COMPOUNDED", { status: "completed" });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LEGAL NOTE  (absolute, bottom: 28pt from page bottom)
  // ════════════════════════════════════════════════════════════════════════════
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(
    "This receipt confirms the transaction recorded above on the Stellar network. " +
    "It is provided for record-keeping and is not a tax invoice. Theo AI Finance S.A.",
    L, PH - 37,
    { maxWidth: W },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // FOOTER  (bottom 22 pt, navy)
  // ════════════════════════════════════════════════════════════════════════════
  fill(doc, NAVY);
  doc.rect(0, PH - 22, PW, 22, "F");

  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Theo for Business", L, PH - 8);

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("Haiti HTG / USDC Corridor · Powered by Stellar", R, PH - 8, { align: "right" });

  // ════════════════════════════════════════════════════════════════════════════
  // DOWNLOAD — synchronous, preserves user-gesture context
  // (jsPDF's doc.save() wraps click in setTimeout which breaks sandboxed iframes)
  // ════════════════════════════════════════════════════════════════════════════
  const ref      = data.referenceNumber ?? new Date(data.createdAt).toISOString().slice(0, 10);
  const filename = `theo-receipt-${ref}.pdf`;
  const blob     = doc.output("blob");
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement("a");
  a.href         = url;
  a.download     = filename;
  a.rel          = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
