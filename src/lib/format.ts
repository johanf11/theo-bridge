import { NUMBER_LOCALE } from "@/lib/locale";

// All number formatting is pinned to "en-US" (comma thousands, period decimal).
// The UI language (EN/FR) translates labels and dates — not financial numbers.

const fmt = (n: number, opts?: Intl.NumberFormatOptions) =>
  n.toLocaleString(NUMBER_LOCALE, opts);

export const fmtUSD = (n: number) =>
  new Intl.NumberFormat(NUMBER_LOCALE, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

export const fmtHTG = (n: number) => fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " HTG";

export const fmtRate = (n: number) => `${n.toFixed(2)} HTG / USDC`;

export const fmtUSDC = (n: number) => fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USDC";

/** HTG / HTG-C with thousands commas, no decimals. e.g. 19,008,019 */
export const fmtHTGC = (n: number) => fmt(Math.round(n), { maximumFractionDigits: 0 });

/** HTG-C with thousands commas + 2 decimals. e.g. 100,000.00 */
export const fmtHTGC2 = (n: number) => fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Legacy hook export — kept so callers that imported useFormatters() still compile.
// Use the named exports above directly in new code.
export function useFormatters() {
  return { fmtUSDC, fmtUSD, fmtHTG, fmtHTGC, fmtHTGC2, fmtRate };
}
