// Shared double-entry posting helper.
// Posts a ledger_transaction + balanced entries via the post_ledger_entries RPC.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type LedgerEntry = {
  code: string;          // ledger account code (e.g. SPIH_BANK_HTG)
  currency: "HTG" | "USDC";
  debit?: number;
  credit?: number;
};

export type LedgerPost = {
  orderId?: string | null;
  kind: string;
  description?: string;
  postedBy?: string | null;
  entries: LedgerEntry[];
};

/**
 * Post a balanced ledger transaction. Throws if the underlying RPC
 * rejects (e.g. unbalanced, unknown account code, currency mismatch).
 *
 * Phase 1: observational. Callers should log but not block the user-
 * facing flow on ledger failures; wrap with try/catch as needed.
 */
export async function postLedger(
  admin: SupabaseClient,
  post: LedgerPost,
): Promise<string> {
  const payload = {
    order_id: post.orderId ?? null,
    kind: post.kind,
    description: post.description ?? null,
    posted_by: post.postedBy ?? null,
    entries: post.entries.map((e) => ({
      code: e.code,
      currency: e.currency,
      debit: e.debit ?? 0,
      credit: e.credit ?? 0,
    })),
  };
  const { data, error } = await admin.rpc("post_ledger_entries", { payload });
  if (error) throw new Error(`postLedger(${post.kind}): ${error.message}`);
  return data as string;
}
