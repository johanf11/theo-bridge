// Shared helper for resolving Stellar payment memos for Theo Bridge payouts.
// Hierarchy: prePicked (Odoo's resolved stellar_memo on pay) → vendor memo →
// fallback to the Theo reference_number. USDC wallet payouts MUST always
// carry a memo; exchanges silently lose deposits otherwise.

export const STELLAR_TEXT_MEMO_MAX_BYTES = 28;
const UINT64_MAX = 18446744073709551615n;

export type MemoSource = "vendor" | "theo_ref";
export type StellarMemoType = "text" | "id";

export type ResolvedStellarMemo = {
  memo: string;
  source: MemoSource;
  memoType: StellarMemoType;
};

export class InvalidMemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemoError";
  }
}

/** Numeric & fits uint64 → MEMO_ID, else MEMO_TEXT. */
export function pickMemoType(memo: string): StellarMemoType {
  if (/^\d+$/.test(memo)) {
    try {
      if (BigInt(memo) <= UINT64_MAX) return "id";
    } catch {
      // fall through
    }
  }
  return "text";
}

/** Validate a memo for the chosen type (or auto-pick). Throws InvalidMemoError. */
export function validateMemo(memo: string, memoType?: StellarMemoType): StellarMemoType {
  const type = memoType ?? pickMemoType(memo);
  if (type === "text") {
    const bytes = new TextEncoder().encode(memo).length;
    if (bytes === 0) throw new InvalidMemoError("memo cannot be empty");
    if (bytes > STELLAR_TEXT_MEMO_MAX_BYTES) {
      throw new InvalidMemoError(
        `memo exceeds ${STELLAR_TEXT_MEMO_MAX_BYTES} bytes for Stellar MEMO_TEXT (got ${bytes})`,
      );
    }
  } else {
    if (!/^\d+$/.test(memo)) throw new InvalidMemoError("MEMO_ID requires digits only");
    try {
      if (BigInt(memo) > UINT64_MAX) throw new InvalidMemoError("MEMO_ID exceeds uint64 max");
    } catch {
      throw new InvalidMemoError("MEMO_ID exceeds uint64 max");
    }
  }
  return type;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Resolve the on-chain Stellar memo for a payout.
 * - If `prePicked` is non-empty (Odoo's pre-resolved `stellar_memo`), use it as vendor memo when it
 *   differs from reference; else treat as theo_ref.
 * - Else if a vendor memo is configured, use it (source=vendor).
 * - Else fall back to the Theo reference_number (source=theo_ref).
 */
export function resolveStellarMemo(opts: {
  referenceNumber: string;
  vendorMemo?: string | null;
  prePicked?: string | null;
  prePickedSource?: string | null;
}): ResolvedStellarMemo {
  const ref = clean(opts.referenceNumber);
  const pre = clean(opts.prePicked);
  const vendor = clean(opts.vendorMemo);

  if (pre) {
    const sourceHint = clean(opts.prePickedSource).toLowerCase();
    let source: MemoSource;
    if (sourceHint === "vendor" || sourceHint === "theo_ref") {
      source = sourceHint;
    } else {
      source = pre === ref ? "theo_ref" : "vendor";
    }
    const memoType = validateMemo(pre);
    return { memo: pre, source, memoType };
  }

  if (vendor) {
    const memoType = validateMemo(vendor);
    return { memo: vendor, source: "vendor", memoType };
  }

  if (!ref) throw new InvalidMemoError("no Stellar memo available (missing reference_number)");
  const memoType = validateMemo(ref);
  return { memo: ref, source: "theo_ref", memoType };
}
