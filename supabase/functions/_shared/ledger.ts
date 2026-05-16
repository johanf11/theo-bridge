// safePostLedger — thin wrapper around the post_ledger_entries Postgres function.
//
// Gate:  if LEDGER_GATE_ENABLED is not "1" this is a no-op (returns null).
//        Set LEDGER_GATE_ENABLED=1 in Supabase edge function secrets after
//        backfill is verified. See backfill-ledger/index.ts for rollout order.
//
// Safety: on any DB error the failure is written to ledger_posting_failures
//         (source_key + full payload) so it can be retried via replay-ledger-failure.
//         This function never throws — callers never need to catch it.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type LedgerEntry = {
  /** chart_of_accounts.id (e.g. "DISTRIBUTOR_USDC") */
  account_code: string;
  /** Required when account_code is "CUSTOMER_USDC" */
  customer_id?: string;
  amount: number;
  side: "DEBIT" | "CREDIT";
  currency: "USDC" | "HTG";
};

export type PostLedgerParams = {
  source_key:  string;
  description: string;
  posted_by:   string | null;
  entries:     LedgerEntry[];
};

/**
 * Post a balanced set of ledger entries.
 * Returns the transaction_id on success, null if the gate is closed or on error.
 */
export async function safePostLedger(
  admin: SupabaseClient,
  params: PostLedgerParams,
): Promise<string | null> {
  if (Deno.env.get("LEDGER_GATE_ENABLED") !== "1") return null;

  // Resolve each account_code (+ optional customer_id) to a ledger_accounts.id
  let resolvedEntries: Array<{
    account_id: string;
    amount: number;
    side: string;
    currency: string;
  }>;

  try {
    resolvedEntries = await Promise.all(
      params.entries.map(async (e) => {
        let accountId: string;

        if (e.account_code === "CUSTOMER_USDC") {
          if (!e.customer_id) throw new Error("CUSTOMER_USDC entry missing customer_id");
          // get_or_create is idempotent — safe to call on every swap
          const { data, error } = await admin.rpc(
            "get_or_create_customer_usdc_account",
            { p_customer_id: e.customer_id },
          );
          if (error) throw error;
          accountId = data as string;
        } else {
          // System account — look up by code (customer_id IS NULL)
          const { data, error } = await admin
            .from("ledger_accounts")
            .select("id")
            .eq("code", e.account_code)
            .is("customer_id", null)
            .single();
          if (error || !data) throw new Error(`Account not found: ${e.account_code}`);
          accountId = (data as { id: string }).id;
        }

        return {
          account_id: accountId,
          amount:     Math.round(e.amount * 1e7) / 1e7,
          side:       e.side,
          currency:   e.currency,
        };
      }),
    );
  } catch (resolveErr) {
    await _recordFailure(admin, params, (resolveErr as Error).message);
    return null;
  }

  const { data, error } = await admin.rpc("post_ledger_entries", {
    p_source_key:  params.source_key,
    p_description: params.description,
    p_posted_by:   params.posted_by,
    p_entries:     JSON.stringify(resolvedEntries),
  });

  if (error) {
    await _recordFailure(admin, params, error.message);
    return null;
  }

  return data as string;
}

async function _recordFailure(
  admin: SupabaseClient,
  params: PostLedgerParams,
  errorMessage: string,
): Promise<void> {
  try {
    await admin.from("ledger_posting_failures").insert({
      source_key: params.source_key,
      payload:    params,
      error:      errorMessage,
    });
  } catch (e) {
    // Best-effort — if even failure recording fails, log it
    console.error("ledger: failed to record posting failure", params.source_key, e);
  }
}
