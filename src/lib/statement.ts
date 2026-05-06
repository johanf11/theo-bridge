import jsPDF from "jspdf";
import { toast } from "sonner";

// ── Brand colours ─────────────────────────────────────────────────────────────
const NAVY  = [51,  53,  154] as const;
const GOLD  = [253, 207,   0] as const;
const INK   = [26,  26,   58] as const;
const MID   = [107, 107, 138] as const;
const CREAM = [247, 247, 251] as const;
const WHITE = [255, 255, 255] as const;
const GREEN = [26,  127,  55] as const;

const ROWS_PER_PAGE = 18;

// ── Types ─────────────────────────────────────────────────────────────────────
export type StatementRow = {
  completedAt: string;
  reference:   string;
  usdcGross:   number;
  usdcNet:     number;
  feeUsdc:     number;
  theoFeeUsdc: number;
  corridorFee: number;
  feeBps:      number;
};

export type StatementData = {
  periodLabel:  string;   // e.g. "Jan 1 – Apr 30, 2026"
  generatedAt:  string;   // ISO string
  customerName?: string;
  rows:         StatementRow[];
  totals: {
    gross:    number;
    net:      number;
    fee:      number;
    theoFee:  number;
    corridor: number;
    avgRate:  number;
  };
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
function fmtN(n: number, dec = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  }).format(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "2-digit", year: "numeric",
  });
}

// ── Public entry ──────────────────────────────────────────────────────────────
export function generateStatement(data: StatementData): void {
  try {
    _buildPdf(data);
  } catch (e) {
    console.error("Statement generation error:", e);
    toast.error("Could not generate statement — " + (e as Error).message);
  }
}

// ── Builder ───────────────────────────────────────────────────────────────────
function _buildPdf(data: StatementData): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297;
  const PH = 210;
  const L  = 14;
  const R  = PW - 14;
  const W  = R - L;

  const totalPages = Math.max(1, Math.ceil(data.rows.length / ROWS_PER_PAGE));

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();
    _drawPage(doc, data, page, totalPages, PW, PH, L, R, W);
  }

  const slug = data.periodLabel.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40);
  doc.save(`theo-statement-${slug}.pdf`);
}

function _drawPage(
  doc: jsPDF,
  data: StatementData,
  page: number,
  totalPages: number,
  PW: number, PH: number, L: number, R: number, W: number,
) {
  // ── Navy header bar ───────────────────────────────────────────────────────
  fill(doc, NAVY);
  doc.rect(0, 0, PW, 28, "F");

  // Gold "T" badge
  fill(doc, GOLD);
  doc.rect(L, 7, 10, 10, "F");
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("T", L + 5, 14, { align: "center" });

  // "Theo for Business"
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Theo", L + 14, 13);
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("FOR BUSINESS", L + 14, 18);

  // Title — centre
  ink(doc, GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("BILLING STATEMENT", PW / 2, 12, { align: "center" });
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(data.periodLabel, PW / 2, 18, { align: "center" });

  // Right — generated date + page
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const genStr = "Generated " + new Date(data.generatedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  doc.text(genStr, R, 13, { align: "right" });
  if (data.customerName) doc.text(data.customerName, R, 19, { align: "right" });
  if (totalPages > 1) doc.text(`Page ${page + 1} of ${totalPages}`, R, 25, { align: "right" });

  // Gold rule
  fill(doc, GOLD);
  doc.rect(0, 28, PW, 2, "F");

  let y = 35;

  // ── Summary strip (only on first page) ───────────────────────────────────
  if (page === 0) {
    const tiles: Array<{ label: string; value: string; sub?: string }> = [
      { label: "TOTAL VOLUME",     value: `$${fmtN(data.totals.gross)}`, sub: "USDC gross" },
      { label: "NET RECEIVED",     value: `$${fmtN(data.totals.net)}`,   sub: "USDC net" },
      { label: "TOTAL FEES PAID",  value: `$${fmtN(data.totals.fee)}`,   sub: "USDC" },
      { label: "THEO SERVICE FEE", value: `$${fmtN(data.totals.theoFee)}`, sub: "revenue" },
      { label: "CORRIDOR COST",    value: `$${fmtN(data.totals.corridor)}`, sub: "passed through" },
      { label: "AVG FEE RATE",     value: `${data.totals.avgRate.toFixed(2)}%`, sub: "all-in" },
    ];

    const TW = W / tiles.length;
    tiles.forEach((t, i) => {
      const tx = L + i * TW;
      // alternating fill
      fill(doc, i % 2 === 0 ? WHITE : CREAM);
      stroke(doc, [220, 220, 235]);
      doc.rect(tx, y, TW, 18, "FD");

      ink(doc, MID);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.text(t.label, tx + 4, y + 5);

      ink(doc, NAVY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(t.value, tx + 4, y + 13);

      if (t.sub) {
        ink(doc, MID);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.text(t.sub, tx + 4, y + 17);
      }
    });

    y += 22;
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  // Column definitions [label, width, align]
  const COLS: Array<{ label: string; w: number; align: "left" | "right" }> = [
    { label: "Date",          w: 28,  align: "left" },
    { label: "Reference",     w: 36,  align: "left" },
    { label: "Gross (USDC)",  w: 34,  align: "right" },
    { label: "Net Received",  w: 34,  align: "right" },
    { label: "Fee Rate",      w: 22,  align: "right" },
    { label: "Theo Fee",      w: 30,  align: "right" },
    { label: "Corridor Fee",  w: 30,  align: "right" },
    { label: "Total Fee",     w: 30,  align: "right" },
    { label: "Status",        w: 22,  align: "left" },
  ];

  // Header row
  fill(doc, NAVY);
  doc.rect(L, y, W, 8, "F");
  let cx = L;
  COLS.forEach(col => {
    ink(doc, GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    const tx = col.align === "right" ? cx + col.w - 3 : cx + 3;
    doc.text(col.label, tx, y + 5.5, { align: col.align });
    cx += col.w;
  });
  y += 8;

  // Data rows for this page
  const ROW_H = 7.8;
  const startIdx = page * ROWS_PER_PAGE;
  const pageRows = data.rows.slice(startIdx, startIdx + ROWS_PER_PAGE);

  pageRows.forEach((row, i) => {
    fill(doc, i % 2 === 0 ? WHITE : CREAM);
    stroke(doc, [230, 230, 240]);
    doc.rect(L, y, W, ROW_H, "FD");

    const vals: string[] = [
      fmtDate(row.completedAt),
      row.reference,
      `$${fmtN(row.usdcGross)}`,
      `$${fmtN(row.usdcNet)}`,
      `${(row.feeBps / 100).toFixed(2)}%`,
      `$${fmtN(row.theoFeeUsdc)}`,
      `$${fmtN(row.corridorFee)}`,
      `$${fmtN(row.feeUsdc)}`,
      "Settled",
    ];

    cx = L;
    vals.forEach((val, ci) => {
      const col = COLS[ci];
      ink(doc, ci === 1 ? NAVY : ci === 8 ? (GREEN as unknown as [number, number, number]) : INK);
      doc.setFont(ci === 1 ? "helvetica" : "helvetica", ci === 1 ? "bold" : "normal");
      doc.setFontSize(ci === 1 ? 7 : 7.5);
      const tx = col.align === "right" ? cx + col.w - 3 : cx + 3;
      doc.text(val, tx, y + 5.2, { align: col.align });
      cx += col.w;
    });

    y += ROW_H;
  });

  // Totals row (last page only, after last data row)
  if (page === totalPages - 1) {
    fill(doc, NAVY);
    doc.rect(L, y, W, ROW_H, "F");

    const totVals: string[] = [
      "", "TOTAL",
      `$${fmtN(data.totals.gross)}`,
      `$${fmtN(data.totals.net)}`,
      `${data.totals.avgRate.toFixed(2)}%`,
      `$${fmtN(data.totals.theoFee)}`,
      `$${fmtN(data.totals.corridor)}`,
      `$${fmtN(data.totals.fee)}`,
      "",
    ];

    cx = L;
    totVals.forEach((val, ci) => {
      const col = COLS[ci];
      ink(doc, ci === 1 ? GOLD : WHITE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      const tx = col.align === "right" ? cx + col.w - 3 : cx + 3;
      if (val) doc.text(val, tx, y + 5.2, { align: col.align });
      cx += col.w;
    });

    y += ROW_H + 4;
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  fill(doc, GOLD);
  doc.rect(0, PH - 14, PW, 2, "F");
  fill(doc, NAVY);
  doc.rect(0, PH - 12, PW, 12, "F");

  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("Theo for Business", L, PH - 4);

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(
    "Theo fee (2.00%) all-inclusive · Corridor cost (0.70%) passed through at cost · Statements in UTC · support@theofinance.com",
    R, PH - 4, { align: "right" },
  );
}
