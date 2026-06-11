import jsPDF from "jspdf";
import { toast } from "sonner";

// ── Colours — restrained financial palette ────────────────────────────────────
const NAVY   = [51,  53,  154] as const;   // brand accent only
const GOLD   = [253, 207,   0] as const;   // thin rule only
const INK    = [26,  26,   58] as const;   // body text
const MID    = [120, 120, 148] as const;   // labels / secondary
const LIGHT  = [220, 220, 232] as const;   // borders
const STRIPE = [249, 249, 252] as const;   // very subtle row band
const WHITE  = [255, 255, 255] as const;
const GREEN  = [34,  136,  72] as const;   // settled badge

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
  // ── Header — white background, thin navy top bar, clean text ────────────
  // 3 px navy top rule
  fill(doc, NAVY);
  doc.rect(0, 0, PW, 3, "F");

  // White header area
  fill(doc, WHITE);
  doc.rect(0, 3, PW, 22, "F");

  // Small gold "T" badge (compact)
  fill(doc, GOLD);
  doc.rect(L, 7, 8, 8, "F");
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("T", L + 4, 12.5, { align: "center" });

  // "Theo" wordmark
  ink(doc, NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Theo", L + 11, 12);
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("FOR BUSINESS", L + 11, 16.5);

  // Title — left-aligned after logo
  ink(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Billing Statement", L + 42, 12);
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(data.periodLabel, L + 42, 17);

  // Right — generated date, customer, page
  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const genStr = "Generated " + new Date(data.generatedAt).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  doc.text(genStr, R, 10, { align: "right" });
  if (data.customerName) {
    ink(doc, INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(data.customerName, R, 16, { align: "right" });
  }
  if (totalPages > 1) {
    ink(doc, MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(`Page ${page + 1} of ${totalPages}`, R, 22, { align: "right" });
  }

  // Thin gold rule under header
  fill(doc, GOLD);
  doc.rect(0, 25, PW, 1.5, "F");
  // Very light grey separator line below gold rule
  fill(doc, LIGHT);
  doc.rect(0, 26.5, PW, 0.5, "F");

  let y = 31;

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
      // All white, just light border separators
      fill(doc, WHITE);
      stroke(doc, LIGHT);
      doc.rect(tx, y, TW, 17, "FD");

      ink(doc, MID);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.text(t.label, tx + 4, y + 4.5);

      ink(doc, INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(t.value, tx + 4, y + 11.5);

      if (t.sub) {
        ink(doc, MID);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.text(t.sub, tx + 4, y + 15.5);
      }
    });

    // Thin separator below summary
    fill(doc, LIGHT);
    doc.rect(L, y + 17, W, 0.5, "F");
    y += 21;
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

  // Table header row — light grey background, dark labels
  fill(doc, STRIPE);
  stroke(doc, LIGHT);
  doc.rect(L, y, W, 7.5, "FD");
  let cx = L;
  COLS.forEach(col => {
    ink(doc, MID);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    const tx = col.align === "right" ? cx + col.w - 3 : cx + 3;
    doc.text(col.label.toUpperCase(), tx, y + 5, { align: col.align });
    cx += col.w;
  });
  y += 7.5;

  // Data rows for this page
  const ROW_H = 7.8;
  const startIdx = page * ROWS_PER_PAGE;
  const pageRows = data.rows.slice(startIdx, startIdx + ROWS_PER_PAGE);

  pageRows.forEach((row, i) => {
    fill(doc, i % 2 === 0 ? WHITE : STRIPE);
    stroke(doc, LIGHT);
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

  // Totals row (last page only) — light with top border emphasis
  if (page === totalPages - 1) {
    // Double top rule to signal totals
    fill(doc, LIGHT);
    doc.rect(L, y, W, 0.75, "F");
    fill(doc, NAVY);
    doc.rect(L, y + 1, W, 0.5, "F");

    fill(doc, [240, 241, 250]);
    stroke(doc, LIGHT);
    doc.rect(L, y + 1.5, W, ROW_H, "FD");

    const totVals: string[] = [
      `${data.rows.length} orders`, "Total",
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
      ink(doc, ci === 0 ? MID : NAVY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(ci === 0 ? 6 : 7.5);
      const tx = col.align === "right" ? cx + col.w - 3 : cx + 3;
      if (val) doc.text(val, tx, y + 1.5 + 5.5, { align: col.align });
      cx += col.w;
    });

    y += ROW_H + 6;
  }

  // ── Footer — minimal: thin rule + small grey text ─────────────────────────
  fill(doc, LIGHT);
  doc.rect(0, PH - 10, PW, 0.5, "F");

  ink(doc, MID);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("Theo for Business  ·  theofinance.com  ·  support@theofinance.com", L, PH - 4);
  doc.text(
    "Theo fee (2.00%) all-inclusive · Corridor (0.70%) passed through at cost · UTC",
    R, PH - 4, { align: "right" },
  );
}
