Update the exchange-rate formatter in `src/lib/receipt.ts` to show 4 decimal places instead of 2, then deploy.

Technical details:
- Change `function fmtRate(r: number) { return "1 USD = " + r.toFixed(2) + " HTG"; }` to use `.toFixed(4)`.
- Re-deploy the `execute-swap` edge function so the change is live.