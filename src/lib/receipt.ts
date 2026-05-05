import jsPDF from "jspdf";

// Theo brand colours
const NAVY = "#33359A";
const GOLD = "#FDCF00";
const INK = "#1A1A3A";
const MID = "#6B6B8A";
const LIGHT = "#EBEBF5";
const WHITE = "#FFFFFF";

// ---------- helpers ----------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function setFill(doc: jsPDF, hex: string) {
  doc.setFillColor(...hexToRgb(hex));
}
function setDraw(doc: jsPDF, hex: string) {
  doc.setDrawColor(...hexToRgb(hex));
}
function setTextColor(doc: jsPDF, hex: string) {
  doc.setTextColor(...hexToRgb(hex));
}

// ---------- types ------------------------------------------------------------
export type ReceiptData = {
  /** order, payout, yield-deposit, yield-earned, swap, withdraw */
  kind: "conversion" | "htgc_mint" | "swap" | "withdraw" | "payout" | "yield" | "yield_earned";
  referenceNumber?: string;
  createdAt: string;
  htgAmount?: number;
  usdcAmount?: number;
  rate?: number;
  stellarTxHash?: string | null;
  status?: string;
  recipientName?: string;
  memo?: string | null;
  walletLabel?: string;
  netApy?: number;
  depositedAt?: string;
  /** Accrued yield amount (for yield_earned kind) */
  accruedAmount?: number;
  /** Customer / company name from profile */
  customerName?: string;
};

// ---------- label helpers ----------------------------------------------------
function kindLabel(kind: ReceiptData["kind"]) {
  const map: Record<ReceiptData["kind"], string> = {
    conversion: "HTG → USDC Conversion",
    htgc_mint: "HTG Deposit — HTG-C Minted",
    swap: "HTG-C → USDC Swap",
    withdraw: "HTG-C Withdrawal",
    payout: "USDC Payout",
    yield: "Yield Deposit",
    yield_earned: "Yield Earned",
  };
  return map[kind];
}

function fmtN(n: number, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

// ---------- main generator ---------------------------------------------------
export function generateReceipt(data: ReceiptData): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = 210; // page width mm
  const L = 18;   // left margin
  const R = pw - 18; // right edge
  const W = R - L;  // content width

  // ── Header bar ──────────────────────────────────────────────────────────
  setFill(doc, NAVY);
  doc.rect(0, 0, pw, 42, "F");

  // "T" logo box
  setFill(doc, GOLD);
  doc.roundedRect(L, 10, 16, 16, 3, 3, "F");
  setTextColor(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("T", L + 8, 21, { align: "center" });

  // "Theo for Business"
  setTextColor(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Theo", L + 22, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTextColor(doc, `rgba(255,255,255,0.55)` as unknown as string);
  // jsPDF doesn't support rgba strings — use a light white approximation
  doc.setTextColor(200, 200, 220);
  doc.text("FOR BUSINESS", L + 22, 25);

  // "OFFICIAL RECEIPT" top right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(253, 207, 0); // GOLD
  doc.text("OFFICIAL RECEIPT", R, 16, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 220);
  const dateStr = new Date(data.createdAt).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  doc.text(dateStr, R, 22, { align: "right" });

  // Gold accent rule
  setFill(doc, GOLD);
  doc.rect(0, 42, pw, 3, "F");

  // ── Reference band ──────────────────────────────────────────────────────
  let y = 54;

  // Transaction type label
  setTextColor(doc, MID);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("TRANSACTION TYPE", L, y);

  if (data.referenceNumber) {
    doc.text("REFERENCE NUMBER", L + W / 2, y);
  }

  y += 5;
  setTextColor(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(kindLabel(data.kind), L, y);

  if (data.referenceNumber) {
    setTextColor(doc, NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(data.referenceNumber, L + W / 2, y);
  }

  y += 4;
  // Gold underline
  setFill(doc, GOLD);
  doc.rect(L, y, 28, 2, "F");

  y += 10;

  // ── Amount hero box ──────────────────────────────────────────────────────
  const heroH = 22;
  setFill(doc, NAVY);
  doc.roundedRect(L, y, W, heroH, 4, 4, "F");

  setTextColor(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  // Left label
  const leftLabel = (() => {
    if (data.kind === "htgc_mint") return "HTG DEPOSITED";
    if (data.kind === "yield") return "USDC DEPOSITED";
    if (data.kind === "yield_earned") return "YIELD EARNED";
    return "USDC AMOUNT";
  })();
  doc.text(leftLabel, L + 8, y + 7);

  const leftValue = (() => {
    if (data.kind === "htgc_mint")
      return `${fmtN(data.htgAmount ?? 0)} HTG`;
    if (data.kind === "yield" || data.kind === "yield_earned")
      return `${fmtN(data.accruedAmount ?? data.usdcAmount ?? 0)} USDC`;
    return `${fmtN(data.usdcAmount ?? 0)} USDC`;
  })();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(253, 207, 0); // GOLD
  doc.text(leftValue, L + 8, y + 16);

  if (data.kind === "conversion" || data.kind === "htgc_mint") {
    // Right side: HTG-C minted or HTG equivalent
    const rightLabel = data.kind === "htgc_mint" ? "HTG-C MINTED" : "HTG SENT";
    const rightValue =
      data.kind === "htgc_mint"
        ? `${fmtN(data.htgAmount ?? 0, 0)} HTG-C`
        : `${fmtN(data.htg_amount_for_display ?? data.htgAmount ?? 0)} HTG`;
    setTextColor(doc, WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(rightLabel, R - 8, y + 7, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text(rightValue, R - 8, y + 16, { align: "right" });
  } else if (data.kind === "swap") {
    setTextColor(doc, WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("HTG-C BURNED", R - 8, y + 7, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text(`${fmtN(data.htgAmount ?? 0, 0)} HTG-C`, R - 8, y + 16, { align: "right" });
  } else if (data.kind === "yield") {
    setTextColor(doc, WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("NET APY", R - 8, y + 7, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text(`${((data.netApy ?? 0.07) * 100).toFixed(2)}%`, R - 8, y + 16, { align: "right" });
  }

  y += heroH + 10;

  // ── Detail rows ──────────────────────────────────────────────────────────
  const rows: Array<[string, string]> = [];

  rows.push(["Date & Time", dateStr]);
  rows.push(["Status", data.status ?? "COMPLETED"]);

  if (data.kind === "conversion" && data.rate) {
    rows.push(["Exchange Rate", `${fmtN(data.rate, 2)} HTG / USDC`]);
    rows.push(["HTG Amount", `${fmtN(data.htgAmount ?? 0)} HTG`]);
    rows.push(["USDC Received", `${fmtN(data.usdcAmount ?? 0)} USDC`]);
  }
  if (data.kind === "htgc_mint") {
    rows.push(["HTG Deposited", `${fmtN(data.htgAmount ?? 0)} HTG`]);
    rows.push(["HTG-C Minted", `${fmtN(data.htgAmount ?? 0, 0)} HTG-C`]);
    rows.push(["Peg Ratio", "1 : 1 (HTG-C = HTG)"]);
  }
  if (data.kind === "swap") {
    rows.push(["HTG-C Burned", `${fmtN(data.htgAmount ?? 0, 0)} HTG-C`]);
    rows.push(["USDC Received", `${fmtN(data.usdcAmount ?? 0)} USDC`]);
  }
  if (data.kind === "withdraw") {
    rows.push(["HTG-C Withdrawn", `${fmtN(data.usdcAmount ?? 0, 0)} HTG-C`]);
    rows.push(["Destination", "Bank account on file"]);
  }
  if (data.kind === "payout") {
    rows.push(["USDC Sent", `${fmtN(data.usdcAmount ?? 0)} USDC`]);
    if (data.recipientName) rows.push(["Recipient", data.recipientName]);
    if (data.memo) rows.push(["Memo", data.memo]);
  }
  if (data.kind === "yield") {
    rows.push(["Principal Deposited", `${fmtN(data.usdcAmount ?? 0)} USDC`]);
    rows.push(["Source Wallet", data.walletLabel ?? "—"]);
    rows.push(["Net APY", `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`]);
    if (data.depositedAt) {
      rows.push(["Deposit Date", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })]);
    }
  }
  if (data.kind === "yield_earned") {
    rows.push(["Yield Earned", `${fmtN(data.accruedAmount ?? 0)} USDC`]);
    rows.push(["Source Wallet", data.walletLabel ?? "—"]);
    rows.push(["Net APY", `${((data.netApy ?? 0.07) * 100).toFixed(2)}%`]);
    if (data.depositedAt) {
      rows.push(["Earning Since", new Date(data.depositedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })]);
    }
  }

  if (data.customerName) rows.push(["Account", data.customerName]);

  // Draw rows in two-column card layout
  const rowH = 10;
  let rowY = y;

  rows.forEach(([label, value], i) => {
    const isEven = i % 2 === 0;
    const colX = isEven ? L : L + W / 2 + 3;
    const colW = W / 2 - 3;

    // card background every pair
    if (isEven) {
      setFill(doc, i % 4 === 0 ? "#F7F7FB" : WHITE);
      // draw subtle border
      setDraw(doc, LIGHT);
      doc.roundedRect(L, rowY, W, rowH, 2, 2, "S");
    }

    setTextColor(doc, MID);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(label.toUpperCase(), colX + 3, rowY + 3.5);

    setTextColor(doc, INK);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    // truncate long values
    const maxW = colW - 6;
    const truncated = doc.splitTextToSize(value, maxW)[0] as string;
    doc.text(truncated, colX + 3, rowY + 8);

    if (!isEven) rowY += rowH + 2;
  });

  // If odd number of rows the last row is alone — advance
  if (rows.length % 2 !== 0) rowY += rowH + 2;

  y = rowY + 6;

  // ── Stellar TX hash ──────────────────────────────────────────────────────
  if (data.stellarTxHash) {
    setFill(doc, "#EFF6FF");
    setDraw(doc, "#BFDBFE");
    doc.roundedRect(L, y, W, 16, 3, 3, "FD");

    setTextColor(doc, MID);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("STELLAR TRANSACTION HASH", L + 4, y + 5);

    setTextColor(doc, NAVY);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.text(data.stellarTxHash, L + 4, y + 11);

    y += 22;
  }

  // ── Watermark / settlement note ──────────────────────────────────────────
  setFill(doc, "#F0F4FF");
  setDraw(doc, LIGHT);
  doc.roundedRect(L, y, W, 12, 3, 3, "FD");

  setTextColor(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    "This receipt is automatically generated by Theo. Settlement occurs on the Stellar testnet.",
    L + 4,
    y + 5,
  );
  doc.text(
    "For support contact support@theofinance.com  ·  theofinance.com",
    L + 4,
    y + 10,
  );

  y += 18;

  // ── Footer bar ───────────────────────────────────────────────────────────
  const pageH = 297;
  setFill(doc, NAVY);
  doc.rect(0, pageH - 18, pw, 18, "F");
  setFill(doc, GOLD);
  doc.rect(0, pageH - 21, pw, 3, "F");

  setTextColor(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Theo for Business", L, pageH - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 210);
  doc.text("Haiti HTG / USDC Corridor  ·  Powered by Stellar Network", R, pageH - 10, { align: "right" });

  // ── Save ─────────────────────────────────────────────────────────────────
  const ref = data.referenceNumber ?? new Date(data.createdAt).toISOString().slice(0, 10);
  doc.save(`theo-receipt-${ref}.pdf`);
}

// Tiny type extension to handle internal field mapping
declare module "./receipt" {
  interface ReceiptData {
    htg_amount_for_display?: number;
  }
}
