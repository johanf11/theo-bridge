export const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

export const fmtHTG = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " HTG";

export const fmtRate = (n: number) => `${n.toFixed(2)} HTG / USDC`;

export const fmtUSDC = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " USDC";

/** HTG-C with thousands commas, no decimals. e.g. 100,000 */
export const fmtHTGC = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));

/** HTG-C with thousands commas + 2 decimals. e.g. 100,000.00 */
export const fmtHTGC2 = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
