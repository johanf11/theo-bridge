-- ─────────────────────────────────────────────────────────────────────────────
-- Fix _ledger_validate_balance: references side/amount columns that do NOT
-- exist in ledger_entries (which uses debit/credit from the 20260516003639
-- schema). This bug silently aborted every ledger INSERT at commit time,
-- causing safePostLedger to dump all postings into ledger_posting_failures.
--
-- Also replays any rows sitting in ledger_posting_failures so the backlog
-- is cleared automatically.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Fix the balance-check function to use debit/credit columns
CREATE OR REPLACE FUNCTION public._ledger_validate_balance(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  -- Per-currency: sum(debit) must equal sum(credit)
  FOR r IN
    SELECT currency,
           SUM(debit)  AS dr,
           SUM(credit) AS cr
    FROM   public.ledger_entries
    WHERE  transaction_id = p_transaction_id
    GROUP  BY currency
  LOOP
    IF round(r.dr, 7) <> round(r.cr, 7) THEN
      RAISE EXCEPTION
        'Unbalanced posting for transaction %: currency % debits=% credits=%',
        p_transaction_id, r.currency, r.dr, r.cr;
    END IF;
  END LOOP;

  -- Currency must match the account's declared currency
  IF EXISTS (
    SELECT 1
    FROM   public.ledger_entries   le
    JOIN   public.ledger_accounts  la ON la.id = le.account_id
    WHERE  le.transaction_id = p_transaction_id
      AND  le.currency <> la.currency
  ) THEN
    RAISE EXCEPTION
      'Currency mismatch: one or more entries have a currency that does not match their account';
  END IF;
END;
$$;

-- 2. Replay every failure row that has enough data to re-post
--    (safe to re-run; post_ledger_entries is idempotent on source_key)
DO $$
DECLARE
  f       record;
  tx_id   uuid;
  src_key text;
BEGIN
  FOR f IN
    SELECT id, payload, source
    FROM   public.ledger_posting_failures
    ORDER  BY created_at
  LOOP
    src_key := f.payload->>'sourceKey';   -- TypeScript camelCase key
    IF src_key IS NULL THEN
      src_key := f.payload->>'source_key'; -- fallback snake_case
    END IF;

    BEGIN
      SELECT public.post_ledger_entries(
        jsonb_build_object(
          'source_key',     COALESCE(src_key, f.source),
          'kind',           f.payload->>'kind',
          'description',    f.payload->>'description',
          'order_id',       f.payload->>'orderId',
          'posted_by',      f.payload->>'postedBy',
          'stellar_tx_hash',f.payload->>'stellarTxHash',
          'entries',        f.payload->'entries'
        )
      ) INTO tx_id;

      DELETE FROM public.ledger_posting_failures WHERE id = f.id;
      RAISE NOTICE 'Replayed failure % → tx %', f.id, tx_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not replay failure %: %', f.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Failure replay complete.';
END $$;
