-- ─────────────────────────────────────────────────────────────────────────────
-- Double-entry ledger schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Recommended rollout order (see backfill-ledger/index.ts for details):
--   1. Apply migration (LEDGER_GATE_ENABLED unset = gate closed)
--   2. POST /backfill-ledger  →  verify backfill_report
--   3. Query trial balance    →  confirm near-zero residuals
--   4. Set LEDGER_GATE_ENABLED=1 in edge function secrets  →  live posting begins

-- ── Chart of accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  account_type   text NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','CLEARING')),
  currency       text NOT NULL CHECK (currency IN ('USDC','HTG')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  is_template    boolean NOT NULL DEFAULT false  -- true = instantiated per customer
);

INSERT INTO chart_of_accounts (id, name, account_type, currency, normal_balance, is_template) VALUES
  ('DISTRIBUTOR_USDC',      'Distributor Hot Wallet — USDC',  'ASSET',     'USDC', 'DEBIT',  false),
  ('TREASURY_USDC',         'Treasury Buffer — USDC',         'ASSET',     'USDC', 'DEBIT',  false),
  ('BLEND_DEPOSITS_USDC',   'Blend Protocol Deposits — USDC', 'ASSET',     'USDC', 'DEBIT',  false),
  ('CUSTOMER_USDC',         'Customer USDC Sub-account',      'ASSET',     'USDC', 'DEBIT',  true),
  ('HTGC_ISSUED',           'HTG-C Tokens Outstanding',       'LIABILITY', 'HTG',  'CREDIT', false),
  ('FX_CLEARING_HTG',       'FX Clearing — HTG',              'CLEARING',  'HTG',  'DEBIT',  false),
  ('FX_CLEARING_USDC',      'FX Clearing — USDC',             'CLEARING',  'USDC', 'DEBIT',  false),
  ('FEE_REVENUE_USDC',      'Conversion Fee Revenue — USDC',  'REVENUE',   'USDC', 'CREDIT', false),
  ('OPENING_BALANCE_EQUITY','Opening Balance Equity',         'EQUITY',    'USDC', 'CREDIT', false)
ON CONFLICT (id) DO NOTHING;

-- ── Instantiated accounts ─────────────────────────────────────────────────────
-- One row per system account (non-template); customer accounts added on demand.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL REFERENCES chart_of_accounts(id),
  customer_id uuid REFERENCES customers(id),
  currency    text NOT NULL,
  balance     numeric(18,7) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- NULL customer_id uses a sentinel UUID so the UNIQUE constraint works
  UNIQUE (code, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

-- Seed system accounts (one per non-template entry)
INSERT INTO ledger_accounts (code, currency) VALUES
  ('DISTRIBUTOR_USDC',      'USDC'),
  ('TREASURY_USDC',         'USDC'),
  ('BLEND_DEPOSITS_USDC',   'USDC'),
  ('HTGC_ISSUED',           'HTG'),
  ('FX_CLEARING_HTG',       'HTG'),
  ('FX_CLEARING_USDC',      'USDC'),
  ('FEE_REVENUE_USDC',      'USDC'),
  ('OPENING_BALANCE_EQUITY','USDC')
ON CONFLICT DO NOTHING;

-- ── Journal transactions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key  text UNIQUE NOT NULL,   -- idempotency key (e.g. "swap:<order_id>")
  description text NOT NULL,
  posted_by   uuid,                   -- auth.users.id; NULL for system / backfill
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Journal entries ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id     uuid NOT NULL REFERENCES ledger_accounts(id),
  amount         numeric(18,7) NOT NULL CHECK (amount > 0),
  side           text NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  currency       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx      ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries(account_id, created_at DESC);

-- ── Balanced-posting validation function ──────────────────────────────────────
-- Called by the trigger below; also used by post_ledger_entries before committing.
CREATE OR REPLACE FUNCTION _ledger_validate_balance(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  -- Per-currency: debits must equal credits
  FOR r IN
    SELECT currency,
           SUM(CASE WHEN side = 'DEBIT'  THEN amount ELSE 0 END) AS dr,
           SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE 0 END) AS cr
    FROM   ledger_entries
    WHERE  transaction_id = p_transaction_id
    GROUP  BY currency
  LOOP
    IF round(r.dr, 7) <> round(r.cr, 7) THEN
      RAISE EXCEPTION
        'Unbalanced posting for transaction %: currency % debits=% credits=%',
        p_transaction_id, r.currency, r.dr, r.cr;
    END IF;
  END LOOP;

  -- Each entry's currency must match its account's currency
  IF EXISTS (
    SELECT 1
    FROM   ledger_entries   le
    JOIN   ledger_accounts  la ON la.id = le.account_id
    WHERE  le.transaction_id = p_transaction_id
      AND  le.currency <> la.currency
  ) THEN
    RAISE EXCEPTION
      'Currency mismatch: one or more entries have a currency that does not match their account';
  END IF;
END;
$$;

-- Trigger: validate after each batch of entries is inserted for a transaction
CREATE OR REPLACE FUNCTION _ledger_validate_balance_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _ledger_validate_balance(NEW.transaction_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_balance ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION _ledger_validate_balance_trigger();

-- ── Posting failures queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_posting_failures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  payload    jsonb NOT NULL,
  error      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── get_or_create_customer_usdc_account ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_or_create_customer_usdc_account(p_customer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO ledger_accounts (code, customer_id, currency)
  VALUES ('CUSTOMER_USDC', p_customer_id, 'USDC')
  ON CONFLICT (code, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO NOTHING;

  SELECT id INTO v_id
  FROM   ledger_accounts
  WHERE  code = 'CUSTOMER_USDC' AND customer_id = p_customer_id;

  RETURN v_id;
END;
$$;

-- ── post_ledger_entries ────────────────────────────────────────────────────────
-- p_entries jsonb: array of {account_id uuid, amount numeric, side text, currency text}
-- Returns the transaction_id (existing or newly created).
CREATE OR REPLACE FUNCTION post_ledger_entries(
  p_source_key  text,
  p_description text,
  p_posted_by   uuid,
  p_entries     jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tx_id      uuid;
  v_existing   uuid;
  r            jsonb;
  v_acct_curr  text;
BEGIN
  -- Idempotency: if source_key already posted, return original tx id
  SELECT id INTO v_existing FROM ledger_transactions WHERE source_key = p_source_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Pre-flight: per-currency balance check
  IF EXISTS (
    SELECT currency
    FROM (
      SELECT e->>'currency'                                                     AS currency,
             SUM(CASE WHEN e->>'side' = 'DEBIT'  THEN (e->>'amount')::numeric ELSE 0 END) AS dr,
             SUM(CASE WHEN e->>'side' = 'CREDIT' THEN (e->>'amount')::numeric ELSE 0 END) AS cr
      FROM   jsonb_array_elements(p_entries) e
      GROUP  BY e->>'currency'
    ) t
    WHERE round(dr, 7) <> round(cr, 7)
  ) THEN
    RAISE EXCEPTION 'Unbalanced posting: debits ≠ credits (source_key=%)', p_source_key;
  END IF;

  -- Pre-flight: currency must match account's currency
  FOR r IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    SELECT currency INTO v_acct_curr
    FROM   ledger_accounts
    WHERE  id = (r->>'account_id')::uuid;

    IF v_acct_curr IS NULL THEN
      RAISE EXCEPTION 'Account % not found', r->>'account_id';
    END IF;

    IF (r->>'currency') <> v_acct_curr THEN
      RAISE EXCEPTION 'Currency mismatch: entry currency % ≠ account currency % (account_id=%)',
        r->>'currency', v_acct_curr, r->>'account_id';
    END IF;
  END LOOP;

  -- Insert transaction header
  INSERT INTO ledger_transactions (source_key, description, posted_by)
  VALUES (p_source_key, p_description, p_posted_by)
  RETURNING id INTO v_tx_id;

  -- Insert entries
  INSERT INTO ledger_entries (transaction_id, account_id, amount, side, currency)
  SELECT v_tx_id,
         (e->>'account_id')::uuid,
         (e->>'amount')::numeric,
         e->>'side',
         e->>'currency'
  FROM   jsonb_array_elements(p_entries) e;

  -- Update running balances
  -- normal_balance = DEBIT  → balance += amount when DEBIT,  -= amount when CREDIT
  -- normal_balance = CREDIT → balance += amount when CREDIT, -= amount when DEBIT
  UPDATE ledger_accounts la
  SET    balance = balance + (
    CASE WHEN coa.normal_balance = e.side THEN e.amount ELSE -e.amount END
  )
  FROM (
    SELECT (e->>'account_id')::uuid AS account_id,
           (e->>'amount')::numeric  AS amount,
           e->>'side'               AS side
    FROM   jsonb_array_elements(p_entries) e
  ) e
  JOIN chart_of_accounts coa ON coa.id = la.code
  WHERE  la.id = e.account_id;

  RETURN v_tx_id;
END;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE chart_of_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_posting_failures ENABLE ROW LEVEL SECURITY;

-- Admin read-only on ledger tables
CREATE POLICY "admin_read_chart"    ON chart_of_accounts      FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_read_accounts" ON ledger_accounts        FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_read_txns"     ON ledger_transactions    FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_read_entries"  ON ledger_entries         FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_read_failures" ON ledger_posting_failures FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "admin_delete_failures" ON ledger_posting_failures FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Service role full access (edge functions write via admin client)
CREATE POLICY "service_all_chart"    ON chart_of_accounts      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_accounts" ON ledger_accounts        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_txns"     ON ledger_transactions    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_entries"  ON ledger_entries         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_failures" ON ledger_posting_failures FOR ALL TO service_role USING (true) WITH CHECK (true);
