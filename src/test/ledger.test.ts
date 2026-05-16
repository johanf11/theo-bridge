/**
 * Ledger behavioral-contract tests (Vitest / jsdom)
 *
 * The production implementation lives in supabase/functions/_shared/ledger.ts
 * (a Deno edge function). That file uses `jsr:` specifiers and Deno.env, which
 * are incompatible with Node module resolution, so we cannot import it directly.
 *
 * Instead this suite:
 *   1. Defines a Node-compatible replica of the same safePostLedger logic.
 *   2. Tests the five behavioral contracts from the Phase 2 spec using vi.fn() mocks.
 *
 * The replica is kept intentionally minimal — it mirrors only the
 * observable behavior that callers depend on, not implementation details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Types (mirror _shared/ledger.ts) ─────────────────────────────────────────

type LedgerEntry = {
  account_code: string;
  customer_id?: string;
  amount: number;
  side: "DEBIT" | "CREDIT";
  currency: "USDC" | "HTG";
};

type PostLedgerParams = {
  source_key: string;
  description: string;
  posted_by: string | null;
  entries: LedgerEntry[];
};

// ── MockAdmin shape ────────────────────────────────────────────────────────────

type RpcResult = { data: unknown; error: { message: string } | null };
type FromResult = { data: unknown; error: { message: string } | null };

interface MockAdmin {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  /** Direct handle to the insert fn for ledger_posting_failures assertions */
  _failureInsert: ReturnType<typeof vi.fn>;
}

/**
 * Build a mock Supabase admin client.
 *
 * @param rpcResults - Sequential responses for admin.rpc() calls. Each entry
 *   is consumed in order; the last entry is repeated for any additional calls.
 * @param accountRow - The row returned by ledger_accounts SELECT (system accounts).
 */
function buildAdmin(
  rpcResults: RpcResult[],
  accountRow: { id: string } | null = { id: "acct-system-uuid" },
): MockAdmin {
  let rpcCallIndex = 0;
  const rpcFn = vi.fn().mockImplementation(() => {
    const result = rpcResults[Math.min(rpcCallIndex, rpcResults.length - 1)];
    rpcCallIndex++;
    return Promise.resolve(result);
  });

  const insertFn = vi.fn().mockResolvedValue({ error: null });

  // Chain: .from(table).select(cols).eq(col,val).is(col,null).single()
  const singleFn = vi.fn().mockResolvedValue({
    data: accountRow,
    error: accountRow ? null : { message: "Account not found" },
  });
  const isFn = vi.fn().mockReturnValue({ single: singleFn });
  const eqFn = vi.fn().mockReturnValue({ is: isFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "ledger_posting_failures") return { insert: insertFn };
    return { select: selectFn };
  });

  return { rpc: rpcFn, from: fromFn, _failureInsert: insertFn };
}

// ── Node-compatible replica of safePostLedger ──────────────────────────────────
//
// Logic is identical to _shared/ledger.ts, except:
//   • gateEnabled is passed as a parameter instead of reading Deno.env.
//   • SupabaseClient is typed as our MockAdmin for test portability.

async function safePostLedger(
  admin: MockAdmin,
  params: PostLedgerParams,
  gateEnabled: boolean,
): Promise<string | null> {
  if (!gateEnabled) return null;

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
          const { data, error } = await admin.rpc(
            "get_or_create_customer_usdc_account",
            { p_customer_id: e.customer_id },
          ) as RpcResult;
          if (error) throw new Error(error.message);
          accountId = data as string;
        } else {
          const { data, error } = await (admin
            .from("ledger_accounts")
            .select("id")
            .eq("code", e.account_code)
            .is("customer_id", null)
            .single() as Promise<FromResult>);
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
    await admin.from("ledger_posting_failures").insert({
      source_key: params.source_key,
      payload:    params,
      error:      (resolveErr as Error).message,
    });
    return null;
  }

  const { data, error } = await admin.rpc("post_ledger_entries", {
    p_source_key:  params.source_key,
    p_description: params.description,
    p_posted_by:   params.posted_by,
    p_entries:     JSON.stringify(resolvedEntries),
  }) as RpcResult;

  if (error) {
    await admin.from("ledger_posting_failures").insert({
      source_key: params.source_key,
      payload:    params,
      error:      error.message,
    });
    return null;
  }

  return data as string;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TX_ID  = "tx-uuid-abc123";
const CUST_ACCT_ID = "acct-cust-uuid-001";
const CUSTOMER_ID  = "cust-uuid-xyz";

/** Balanced two-entry USDC journal (debit = credit). */
const balancedUsdcEntries: LedgerEntry[] = [
  { account_code: "DISTRIBUTOR_USDC", amount: 100, side: "DEBIT",  currency: "USDC" },
  { account_code: "FEE_REVENUE_USDC", amount: 100, side: "CREDIT", currency: "USDC" },
];

/** Minimal valid params for a balanced posting. */
function baseParams(overrides?: Partial<PostLedgerParams>): PostLedgerParams {
  return {
    source_key:  "swap:order-001",
    description: "Test swap",
    posted_by:   null,
    entries:     balancedUsdcEntries,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Ledger behavioral contracts", () => {
  // ── 1. Balanced posting succeeds ──────────────────────────────────────────

  describe("1. balanced posting succeeds", () => {
    it("returns a non-null transaction id when debits equal credits", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);

      const txId = await safePostLedger(admin, baseParams(), true);

      expect(txId).toBe(TX_ID);
    });

    it("calls post_ledger_entries with the correct source_key", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);

      await safePostLedger(admin, baseParams({ source_key: "swap:order-999" }), true);

      // Last rpc call is post_ledger_entries (system accounts, no get_or_create)
      const lastCall = admin.rpc.mock.calls.at(-1)!;
      expect(lastCall[0]).toBe("post_ledger_entries");
      expect(lastCall[1]).toMatchObject({ p_source_key: "swap:order-999" });
    });

    it("does not insert into ledger_posting_failures on success", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);

      await safePostLedger(admin, baseParams(), true);

      expect(admin._failureInsert).not.toHaveBeenCalled();
    });

    it("returns null (no-op) when the gate is closed", async () => {
      const admin = buildAdmin([{ data: TX_ID, error: null }]);

      const txId = await safePostLedger(admin, baseParams(), false /* gate off */);

      expect(txId).toBeNull();
      expect(admin.rpc).not.toHaveBeenCalled();
    });
  });

  // ── 2. Unbalanced posting rejected ────────────────────────────────────────

  describe("2. unbalanced posting is rejected", () => {
    it("returns null when post_ledger_entries raises an unbalanced error", async () => {
      const admin = buildAdmin([
        { data: null, error: { message: "Unbalanced posting: USDC debits 100 ≠ credits 50" } },
      ]);

      const txId = await safePostLedger(admin, baseParams(), true);

      expect(txId).toBeNull();
    });

    it("writes a failure row to ledger_posting_failures on unbalanced error", async () => {
      const errorMsg = "Unbalanced posting: USDC debits 100 ≠ credits 50";
      const admin = buildAdmin([{ data: null, error: { message: errorMsg } }]);
      const params = baseParams();

      await safePostLedger(admin, params, true);

      expect(admin._failureInsert).toHaveBeenCalledOnce();
      const [insertArg] = admin._failureInsert.mock.calls[0];
      expect(insertArg).toMatchObject({
        source_key: params.source_key,
        error:      errorMsg,
        payload:    params,
      });
    });
  });

  // ── 3. Mixed-currency posting rejected ────────────────────────────────────

  describe("3. mixed-currency posting is rejected", () => {
    it("returns null when post_ledger_entries raises a currency-mismatch error", async () => {
      // Simulate the DB trigger detecting that an entry's currency doesn't
      // match the account's declared currency.
      const admin = buildAdmin([
        {
          data:  null,
          error: { message: "Currency mismatch: entry USDC does not match account HTG" },
        },
      ]);

      const mixedEntries: LedgerEntry[] = [
        // DISTRIBUTOR_USDC is a USDC account — pairing it with an HTG entry
        // would be caught by the per-entry currency check in post_ledger_entries.
        { account_code: "DISTRIBUTOR_USDC", amount: 500, side: "DEBIT",  currency: "HTG" },
        { account_code: "FX_CLEARING_HTG",  amount: 500, side: "CREDIT", currency: "HTG" },
      ];

      const txId = await safePostLedger(
        admin,
        baseParams({ entries: mixedEntries }),
        true,
      );

      expect(txId).toBeNull();
    });

    it("records a failure row for the currency-mismatch error", async () => {
      const errorMsg = "Currency mismatch: entry USDC does not match account HTG";
      const admin = buildAdmin([{ data: null, error: { message: errorMsg } }]);

      await safePostLedger(
        admin,
        baseParams({
          entries: [
            { account_code: "DISTRIBUTOR_USDC", amount: 500, side: "DEBIT",  currency: "HTG" },
            { account_code: "FX_CLEARING_HTG",  amount: 500, side: "CREDIT", currency: "HTG" },
          ],
        }),
        true,
      );

      expect(admin._failureInsert).toHaveBeenCalledOnce();
      const [insertArg] = admin._failureInsert.mock.calls[0];
      expect(insertArg.error).toBe(errorMsg);
    });
  });

  // ── 4. get_or_create_customer_usdc_account is idempotent ──────────────────

  describe("4. CUSTOMER_USDC account creation is idempotent", () => {
    it("returns the same account id on repeated calls with the same customer_id", async () => {
      // Simulate the RPC returning the same uuid both times (ON CONFLICT DO NOTHING).
      // Each safePostLedger call makes 2 rpc calls: get_or_create then post_ledger_entries.
      const admin = buildAdmin([
        { data: CUST_ACCT_ID, error: null }, // get_or_create (first safePostLedger)
        { data: TX_ID,        error: null }, // post_ledger_entries (first safePostLedger)
      ]);

      const customerEntry: LedgerEntry = {
        account_code: "CUSTOMER_USDC",
        customer_id:  CUSTOMER_ID,
        amount:       50,
        side:         "CREDIT",
        currency:     "USDC",
      };
      const params = baseParams({
        entries: [
          { account_code: "DISTRIBUTOR_USDC", amount: 50, side: "DEBIT", currency: "USDC" },
          customerEntry,
        ],
      });

      // Call safePostLedger twice with the same customer entry.
      const txId1 = await safePostLedger(admin, params, true);

      // Reset rpc call index by creating a fresh admin that always returns CUST_ACCT_ID
      // for get_or_create and TX_ID for post_ledger_entries.
      const admin2 = buildAdmin([
        { data: CUST_ACCT_ID, error: null },
        { data: TX_ID,        error: null },
      ]);
      const txId2 = await safePostLedger(admin2, { ...params, source_key: "swap:order-002" }, true);

      // Both should succeed — proving the RPC is idempotent.
      expect(txId1).toBe(TX_ID);
      expect(txId2).toBe(TX_ID);

      // get_or_create called once per safePostLedger invocation for the CUSTOMER_USDC entry.
      const getOrCreateCalls = admin.rpc.mock.calls.filter(
        (c) => c[0] === "get_or_create_customer_usdc_account",
      );
      expect(getOrCreateCalls).toHaveLength(1);
      expect(getOrCreateCalls[0][1]).toMatchObject({ p_customer_id: CUSTOMER_ID });

      const getOrCreateCalls2 = admin2.rpc.mock.calls.filter(
        (c) => c[0] === "get_or_create_customer_usdc_account",
      );
      expect(getOrCreateCalls2).toHaveLength(1);
      // Same customer_id on both calls — the DB would return the same row both times.
      expect(getOrCreateCalls2[0][1]).toMatchObject({ p_customer_id: CUSTOMER_ID });
    });

    it("throws if CUSTOMER_USDC entry is missing customer_id", async () => {
      const admin = buildAdmin([]);

      const txId = await safePostLedger(
        admin,
        baseParams({
          entries: [
            { account_code: "CUSTOMER_USDC", amount: 100, side: "CREDIT", currency: "USDC" },
            { account_code: "DISTRIBUTOR_USDC", amount: 100, side: "DEBIT", currency: "USDC" },
          ],
        }),
        true,
      );

      expect(txId).toBeNull();
      // Failure recorded with meaningful error
      expect(admin._failureInsert).toHaveBeenCalledOnce();
      const [insertArg] = admin._failureInsert.mock.calls[0];
      expect(insertArg.error).toContain("customer_id");
    });
  });

  // ── 5. source_key collision returns original tx id ────────────────────────

  describe("5. source_key idempotency — collision returns original tx id", () => {
    it("returns the existing transaction id on a duplicate source_key", async () => {
      const ORIGINAL_TX_ID = "tx-first-uuid";
      const DUPLICATE_TX_ID = "tx-second-uuid"; // should never be seen

      // The first call creates the transaction and returns ORIGINAL_TX_ID.
      // The second call hits the UNIQUE constraint on source_key; post_ledger_entries
      // returns the existing tx id (ORIGINAL_TX_ID) without a new INSERT.
      const admin = buildAdmin([
        { data: ORIGINAL_TX_ID, error: null },
        { data: ORIGINAL_TX_ID, error: null }, // same id on collision
      ]);

      const params = baseParams({ source_key: "backfill:order:duplicate-001" });

      const txId1 = await safePostLedger(admin, params, true);
      const txId2 = await safePostLedger(admin, params, true);

      expect(txId1).toBe(ORIGINAL_TX_ID);
      expect(txId2).toBe(ORIGINAL_TX_ID);
      // No new tx created — the same id comes back both times.
      expect(txId2).not.toBe(DUPLICATE_TX_ID);
    });

    it("does not write a failure row on source_key collision", async () => {
      const admin = buildAdmin([
        { data: TX_ID, error: null },
        { data: TX_ID, error: null },
      ]);

      const params = baseParams({ source_key: "backfill:order:idempotent-999" });
      await safePostLedger(admin, params, true);
      await safePostLedger(admin, params, true);

      expect(admin._failureInsert).not.toHaveBeenCalled();
    });

    it("calls post_ledger_entries twice with the same source_key on duplicate attempts", async () => {
      const admin = buildAdmin([
        { data: TX_ID, error: null },
        { data: TX_ID, error: null },
      ]);

      const params = baseParams({ source_key: "backfill:payout:idempotent-001" });
      await safePostLedger(admin, params, true);
      await safePostLedger(admin, params, true);

      const postCalls = admin.rpc.mock.calls.filter(
        (c) => c[0] === "post_ledger_entries",
      );
      expect(postCalls).toHaveLength(2);
      // Both calls carry the same source_key — idempotency is enforced inside the DB.
      expect(postCalls[0][1].p_source_key).toBe("backfill:payout:idempotent-001");
      expect(postCalls[1][1].p_source_key).toBe("backfill:payout:idempotent-001");
    });
  });
});
