// Hard transaction limits — enforced in every edge function that moves funds.
// Adjust values here; do NOT duplicate limits inside individual functions.

export const MIN_SINGLE_USDC = 1; // reject dust transactions
export const MAX_SINGLE_USDC = 50_000; // single-payment ceiling (~$50k)

export function assertWithinLimits(amount: number, label = "Amount"): void {
  if (amount < MIN_SINGLE_USDC) {
    throw new Error(`${label} ${amount} is below the minimum of ${MIN_SINGLE_USDC} USDC`);
  }
  if (amount > MAX_SINGLE_USDC) {
    throw new Error(`${label} ${amount} exceeds the single-transaction limit of ${MAX_SINGLE_USDC} USDC`);
  }
}
