/**
 * Ledger behavioral-contract tests (Vitest / jsdom)
 *
 * The production implementation lives in supabase/functions/_shared/ledger.ts
 * (a Deno edge function). That file uses `jsr:` specifiers and Deno.env, which
 * are incompatible with Node module resolution, so we cannot import it directly.
 *
 * Instead this suite:
 *   1. Defines a Node-compatible replica of the same safePostLedger logic,
 *      matching the Lovable-deployed schema (debit/credit columns, jsonb payload).
 *   2. Tests the five behavioral contracts from the Phase 2 spec using vi.fn() mocks.
 *
 * DB schema in production:
 *   ledger_entries   → (account_id, currency, debit, credit)   NOT (amount, side)
 *   post_ledger_entries(payload jsonb) where payload = { order_id, kind, description,
 *     posted_by, source_key, entries: [{ code?, account_id?, currency, debit, credit }] }
 *   ledger_posting_failures → (source, reason, payload, stellar_tx_hash, order_id, ...)
 */

import { describe, it, expect, vi } from "vitest";

// ── Types (mirror _shared/ledger.ts) ─────────────────────────────────────────

type LedgerEntry = {
  code?: string;
  accountId?: string;
  currency: "HTG" | "USDC";
  debit?: number;
  credit?: number;
};

type LedgerPost = {
  orderId?: string | null;
  kind: string;
  description?: string;
  postedBy?: string | null;
  sourceKey?: string | null;
  entries: LedgerEntry[];
};

type PostResult = { txId: string | null; failureId: string | null; error: string | null };

// ── MockAdmin shape ────────────────────────────────────────────────────────────

interface MockAdmin {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  _failureInsert: ReturnType<typeof vi.fn>;
  _failureSelect:  ReturnType<typeof vi.fn>;
}

/**
 * Build a mock Supabase admin client matching Lovable's schema.
 *
 * @param rpcResults - Sequential responses for admin.rpc() calls.
 * @param failureInsertResult - Row returned by ledger_posting_failures.insert().select().single()
 */
function buildAdmin(
  rpcResults: Array<{ data: unknown; error: { message: string } | null }>,
  failureInsertResult: { id: string } | null = { id: "fail-uuid-001" },
): MockAdmin {
  let rpcCallIndex = 0;
  const rpcFn = vi.fn().mockImplementation(() => {
    const result = rpcResults[Math.min(rpcCallIndex, rpcResults.length - 1)];
    rpcCallIndex++;
    return Promise.resolve(result);
  });

  const singleFn = vi.fn().mockResolvedValue({
    data: failureInsertResult,
    error: null,
  });
  const failureSelectFn = vi.fn().mockReturnValue({ single: singleFn });
  const failureInsertFn = vi.fn().mockReturnValue({ select: failureSelectFn });

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "ledger_posting_failures") {
      return { insert: failureInsertFn };
    }
    return {};
  });

  return {
    rpc: rpcFn,
    from: fromFn,
    _failureInsert: failureInsertFn,
    _failureSelect: failureSelectFn,
  };
}

// ── Node-compatible replica of safePostLedger ──────────────────────────────────
//
// Mirrors _shared/ledger.ts behaviour:
//   • postLedger — calls admin.rpc("post_ledger_entries", { payload }); throws on error.
//   • safePostLedger — wraps postLedger; on failure inserts into ledger_posting_failures.

async function postLedger(admin: MockAdmin, post: LedgerPost): Promise<string> {
  const payload = {
    order_id:    post.orderId ?? null,
    kind:        post.kind,
    description: post.description ?? null,
    posted_by:   post.postedBy ?? null,
    source_key:  post.sourceKey ?? null,
    entries: post.entries.map((e) => ({
      code:       e.code,
      account_id: e.accountId,
      currency:   e.currency,
      debit:      e.debit  ?? 0,
      credit:     e.credit ?? 0,
    })),
  };
  const { data, error } = await admin.rpc("post_ledger_entries", { payload }) as
    { data: unknown; error: { message: string } | null };
  if (error) throw new Error(`postLedger(${post.kind}): ${error.message}`);
  return data as string;
}

async function safePostLedger(
  admin: MockAdmin,
  source: string,
  post: LedgerPost,
  context: { stellarTxHash?: string | null } = {},
): Promise<PostResult> {
  try {
    const txId = await postLedger(admin, post);
    return { txId, failureId: null, error: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const { data } = await admin
      .from("ledger_posting_failures")
      .insert({
        source,
        reason,
        payload:         post,
        stellar_tx_hash: context.stellarTxHash ?? null,
        order_id:        post.orderId ?? null,
      })
      .select("id")
      .single() as { data: { id: string } | null };
    return { txId: null, failureId: data?.id ?? null, error: reason };
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TX_ID      = "tx-uuid-abc123";
const CUST_ACCT  = "acct-cust-uuid-001";
const CUSTOMER_ID = "cust-uuid-xyz";

/** A balanced USDC swap entry set (debit = credit per currency). */
const balancedUsdcEntries: LedgerEntry[] = [
  { code: "DISTRIBUTOR_USDC", currency: "USDC", debit:  100 },
  { code: "FEE_REVENUE_USDC", currency: "USDC", credit: 100 },
];

function basePost(overrides?: Partial<LedgerPost>): LedgerPost {
  return {
    kind:        "test_swap",
    description: "Test swap",
    sourceKey:   "swap:order-001",
    entries:     balancedUsdcEntries,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Ledger behavioral contracts", () => {

  // ── 1. Balanced posting succeeds ──────────────────────────────────────────

  describe("1. balanced posting succeeds", () => {
    it("returns a non-null txId when debits equal credits", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);
      const result = await safePostLedger(admin, "test", basePost());
      expect(result.txId).toBe(TX_ID);
      expect(result.error).toBeNull();
    });

    it("calls post_ledger_entries with the correct source_key and kind", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);
      await safePostLedger(admin, "test", basePost({ sourceKey: "swap:order-999", kind: "htgc_to_usdc_swap" }));
      const [rpcName, rpcArgs] = admin.rpc.mock.calls[0];
      expect(rpcName).toBe("post_ledger_entries");
      expect(rpcArgs.payload.source_key).toBe("swap:order-999");
      expect(rpcArgs.payload.kind).toBe("htgc_to_usdc_swap");
    });

    it("does not write a failure row on success", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);
      await safePostLedger(admin, "test", basePost());
      expect(admin._failureInsert).not.toHaveBeenCalled();
    });

    it("passes entries as debit/credit pairs (not amount+side)", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);
      await safePostLedger(admin, "test", basePost());
      const payload = admin.rpc.mock.calls[0][1].payload;
      for (const entry of payload.entries) {
        expect(entry).toHaveProperty("debit");
        expect(entry).toHaveProperty("credit");
        expect(entry).not.toHaveProperty("amount");
        expect(entry).not.toHaveProperty("side");
      }
    });
  });

  // ── 2. Unbalanced posting rejected ────────────────────────────────────────

  describe("2. unbalanced posting is rejected", () => {
    it("returns null txId when post_ledger_entries raises an unbalanced error", async () => {
      const admin = buildAdmin([
        { data: null, error: { message: "unbalanced ledger transaction abc in USDC (debits=100 credits=50)" } },
      ]);
      const result = await safePostLedger(admin, "test", basePost());
      expect(result.txId).toBeNull();
      expect(result.error).toContain("unbalanced");
    });

    it("writes a failure row to ledger_posting_failures on unbalanced error", async () => {
      const admin = buildAdmin([
        { data: null, error: { message: "unbalanced ledger transaction" } },
      ]);
      await safePostLedger(admin, "execute-swap", basePost(), { stellarTxHash: "abc123" });
      expect(admin._failureInsert).toHaveBeenCalledOnce();
      const insertArg = admin._failureInsert.mock.calls[0][0];
      expect(insertArg.source).toBe("execute-swap");
      expect(insertArg.reason).toContain("unbalanced");
      expect(insertArg.stellar_tx_hash).toBe("abc123");
    });

    it("returns the failure row id from the insert", async () => {
      const admin = buildAdmin(
        [{ data: null, error: { message: "unbalanced" } }],
        { id: "fail-row-001" },
      );
      const result = await safePostLedger(admin, "test", basePost());
      expect(result.failureId).toBe("fail-row-001");
    });
  });

  // ── 3. Mixed-currency posting rejected ────────────────────────────────────

  describe("3. mixed-currency posting is rejected", () => {
    it("returns null txId when the DB raises a currency-mismatch error", async () => {
      const admin = buildAdmin([
        { data: null, error: { message: "ledger entry currency USDC does not match account currency HTG" } },
      ]);
      // Entry uses USDC on a HTG account — the trigger enforces this in production.
      const result = await safePostLedger(admin, "test", basePost({
        entries: [
          { code: "FX_CLEARING_HTG", currency: "USDC", debit:  500 },
          { code: "FX_CLEARING_HTG", currency: "USDC", credit: 500 },
        ],
      }));
      expect(result.txId).toBeNull();
      expect(result.error).toContain("currency");
    });

    it("records a failure row for the currency-mismatch error", async () => {
      const errorMsg = "ledger entry currency USDC does not match account currency HTG";
      const admin = buildAdmin([{ data: null, error: { message: errorMsg } }]);
      await safePostLedger(admin, "execute-swap", basePost({
        entries: [
          { code: "FX_CLEARING_HTG", currency: "USDC", debit:  500 },
          { code: "FX_CLEARING_HTG", currency: "USDC", credit: 500 },
        ],
      }));
      expect(admin._failureInsert).toHaveBeenCalledOnce();
      const insertArg = admin._failureInsert.mock.calls[0][0];
      expect(insertArg.reason).toBe(`postLedger(test_swap): ${errorMsg}`);
    });
  });

  // ── 4. get_or_create_customer_usdc_account is idempotent ──────────────────

  describe("4. CUSTOMER_USDC account creation is idempotent", () => {
    /**
     * In production, get_or_create_customer_usdc_account uses
     * INSERT ... ON CONFLICT DO NOTHING then SELECT — always returns the same uuid.
     * Here we test the calling pattern: two calls with the same customer_id both
     * get the same account id back, and postLedger receives accountId (not code).
     */
    it("both invocations receive the same account id", async () => {
      // First call: get_or_create → CUST_ACCT, then post_ledger_entries → TX_ID
      const admin1 = buildAdmin([
        { data: CUST_ACCT, error: null }, // get_or_create
        { data: TX_ID,     error: null }, // post_ledger_entries
      ]);
      // Second call with same customer — RPC still returns CUST_ACCT
      const admin2 = buildAdmin([
        { data: CUST_ACCT, error: null },
        { data: TX_ID,     error: null },
      ]);

      // Simulate the calling pattern in execute-swap
      async function runSwap(admin: MockAdmin, orderId: string) {
        // Resolve customer account id
        const { data: custId } = await admin.rpc("get_or_create_customer_usdc_account", {
          p_customer_id: CUSTOMER_ID,
        }) as { data: string; error: null };
        return safePostLedger(admin, "execute-swap", {
          orderId, kind: "htgc_to_usdc_swap", sourceKey: `swap:${orderId}`,
          entries: [
            { code: "DISTRIBUTOR_USDC", currency: "USDC", debit:  100 },
            { accountId: custId,         currency: "USDC", credit: 100 },
          ],
        });
      }

      const r1 = await runSwap(admin1, "order-001");
      const r2 = await runSwap(admin2, "order-002");

      expect(r1.txId).toBe(TX_ID);
      expect(r2.txId).toBe(TX_ID);

      // Both calls received the same customer account id
      const entries1 = admin1.rpc.mock.calls.at(-1)![1].payload.entries;
      const entries2 = admin2.rpc.mock.calls.at(-1)![1].payload.entries;
      expect(entries1.find((e: { account_id?: string }) => e.account_id)?.account_id).toBe(CUST_ACCT);
      expect(entries2.find((e: { account_id?: string }) => e.account_id)?.account_id).toBe(CUST_ACCT);
    });

    it("passes accountId (not code) for customer entries in post_ledger_entries payload", async () => {
      const admin = buildAdmin([
        { data: CUST_ACCT, error: null },
        { data: TX_ID,     error: null },
      ]);
      const { data: custId } = await admin.rpc("get_or_create_customer_usdc_account", {
        p_customer_id: CUSTOMER_ID,
      }) as { data: string; error: null };
      await safePostLedger(admin, "test", {
        kind: "test", sourceKey: "swap:x",
        entries: [
          { code: "DISTRIBUTOR_USDC", currency: "USDC", debit:  50 },
          { accountId: custId,         currency: "USDC", credit: 50 },
        ],
      });
      const entries = admin.rpc.mock.calls.at(-1)![1].payload.entries;
      const custEntry = entries.find((e: { account_id?: string }) => e.account_id);
      expect(custEntry?.account_id).toBe(CUST_ACCT);
      expect(custEntry?.code).toBeUndefined();
    });
  });

  // ── 5. source_key collision returns original tx id ────────────────────────

  describe("5. source_key idempotency — collision returns original tx id", () => {
    it("returns the same transaction id on a duplicate source_key", async () => {
      const ORIGINAL_TX = "tx-first-uuid";
      // post_ledger_entries returns the existing tx id on collision (no new insert).
      const admin = buildAdmin([
        { data: ORIGINAL_TX, error: null },
        { data: ORIGINAL_TX, error: null },
      ]);
      const post = basePost({ sourceKey: "backfill:order:duplicate-001" });
      const r1 = await safePostLedger(admin, "test", post);
      const r2 = await safePostLedger(admin, "test", post);
      expect(r1.txId).toBe(ORIGINAL_TX);
      expect(r2.txId).toBe(ORIGINAL_TX);
    });

    it("does not write a failure row on source_key collision", async () => {
      const admin = buildAdmin([
        { data: TX_ID, error: null },
        { data: TX_ID, error: null },
      ]);
      const post = basePost({ sourceKey: "backfill:order:idempotent-999" });
      await safePostLedger(admin, "test", post);
      await safePostLedger(admin, "test", post);
      expect(admin._failureInsert).not.toHaveBeenCalled();
    });

    it("sends the same source_key to post_ledger_entries on both calls", async () => {
      const admin = buildAdmin([
        { data: TX_ID, error: null },
        { data: TX_ID, error: null },
      ]);
      const post = basePost({ sourceKey: "backfill:payout:idempotent-001" });
      await safePostLedger(admin, "test", post);
      await safePostLedger(admin, "test", post);

      const postCalls = admin.rpc.mock.calls.filter((c) => c[0] === "post_ledger_entries");
      expect(postCalls).toHaveLength(2);
      expect(postCalls[0][1].payload.source_key).toBe("backfill:payout:idempotent-001");
      expect(postCalls[1][1].payload.source_key).toBe("backfill:payout:idempotent-001");
    });
  });
});
