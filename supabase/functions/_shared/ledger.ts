// Shared double-entry posting helper.
// Posts a ledger_transaction + balanced entries via the post_ledger_entries RPC.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type LedgerEntry = {
  code?: string;          // ledger account code (e.g. SPIH_BANK_HTG)
  accountId?: string;     // direct account id (used for dynamic customer subaccounts)
  currency: "HTG" | "USDC";
  debit?: number;
  credit?: number;
};

export type LedgerPost = {
  orderId?: string | null;
  kind: string;
  description?: string;
  postedBy?: string | null;
  sourceKey?: string | null;   // idempotency key (backfills, replays)
  entries: LedgerEntry[];
};

/**
 * Post a balanced ledger transaction. Throws on RPC errors.
 * Idempotent when sourceKey is provided.
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
    source_key: post.sourceKey ?? null,
    entries: post.entries.map((e) => ({
      code: e.code,
      account_id: e.accountId,
      currency: e.currency,
      debit: e.debit ?? 0,
      credit: e.credit ?? 0,
    })),
  };
  const { data, error } = await admin.rpc("post_ledger_entries", { payload });
  if (error) throw new Error(`postLedger(${post.kind}): ${error.message}`);
  return data as string;
}

/**
 * Resolve (or create) a per-customer USDC subaccount id.
 */
export async function getOrCreateCustomerUsdcAccount(
  admin: SupabaseClient,
  customerId: string,
): Promise<string> {
  const { data, error } = await admin.rpc("get_or_create_customer_usdc_account", {
    p_customer_id: customerId,
  });
  if (error) throw new Error(`getOrCreateCustomerUsdcAccount: ${error.message}`);
  return data as string;
}

/**
 * Post a ledger transaction; on failure record into ledger_posting_failures
 * so ops can replay. Returns { txId, failureId }.
 *
 * Use this when the on-chain action has ALREADY succeeded and we cannot
 * unwind: we must never lose the bookkeeping intent.
 */
export async function safePostLedger(
  admin: SupabaseClient,
  source: string,
  post: LedgerPost,
  context: { stellarTxHash?: string | null } = {},
): Promise<{ txId: string | null; failureId: string | null; error: string | null }> {
  try {
    const txId = await postLedger(admin, post);
    return { txId, failureId: null, error: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const { data, error: insertErr } = await admin
      .from("ledger_posting_failures")
      .insert({
        source,
        reason,
        payload: post as unknown as Record<string, unknown>,
        stellar_tx_hash: context.stellarTxHash ?? null,
        order_id: post.orderId ?? null,
      })
      .select("id")
      .single();
    if (insertErr) {
      console.error(`[ledger] CRITICAL: failed to record posting failure: ${insertErr.message}`);
    }
    console.error(`[ledger] safePostLedger(${post.kind}) failed: ${reason}`);
    return { txId: null, failureId: data?.id ?? null, error: reason };
  }
}
