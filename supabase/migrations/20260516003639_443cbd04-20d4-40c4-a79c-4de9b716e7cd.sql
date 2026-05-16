-- ============================================================================
-- Phase 1: Internal double-entry shadow ledger
-- ============================================================================

CREATE TYPE public.ledger_account_type AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');

CREATE TABLE public.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  type public.ledger_account_type NOT NULL,
  currency text NOT NULL CHECK (currency IN ('HTG','USDC')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NULL,
  kind text NOT NULL,
  description text NULL,
  posted_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_tx_order ON public.ledger_transactions(order_id);
CREATE INDEX idx_ledger_tx_created ON public.ledger_transactions(created_at DESC);

CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.ledger_accounts(id),
  currency text NOT NULL,
  debit numeric(20,7) NOT NULL DEFAULT 0,
  credit numeric(20,7) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entry_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  ),
  CONSTRAINT ledger_entry_non_negative CHECK (debit >= 0 AND credit >= 0)
);
CREATE INDEX idx_ledger_entries_tx ON public.ledger_entries(transaction_id);
CREATE INDEX idx_ledger_entries_account ON public.ledger_entries(account_id, created_at);

-- Trigger: ensure entry.currency matches account.currency
CREATE OR REPLACE FUNCTION public.ledger_entry_currency_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE acct_currency text;
BEGIN
  SELECT currency INTO acct_currency FROM public.ledger_accounts WHERE id = NEW.account_id;
  IF acct_currency IS NULL THEN
    RAISE EXCEPTION 'ledger account % not found', NEW.account_id;
  END IF;
  IF acct_currency <> NEW.currency THEN
    RAISE EXCEPTION 'ledger entry currency % does not match account currency %', NEW.currency, acct_currency;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_ledger_entry_currency
BEFORE INSERT OR UPDATE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.ledger_entry_currency_check();

-- Deferred balance check: at commit, sum(debit) = sum(credit) per (transaction, currency)
CREATE OR REPLACE FUNCTION public.ledger_transaction_balance_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT transaction_id, currency, SUM(debit) AS d, SUM(credit) AS c
    FROM public.ledger_entries
    WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id)
    GROUP BY transaction_id, currency
  LOOP
    IF rec.d <> rec.c THEN
      RAISE EXCEPTION 'unbalanced ledger transaction % in % (debits=% credits=%)',
        rec.transaction_id, rec.currency, rec.d, rec.c;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_balance
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.ledger_transaction_balance_check();

-- RLS
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read ledger accounts" ON public.ledger_accounts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service full ledger accounts" ON public.ledger_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins read ledger txs" ON public.ledger_transactions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service full ledger txs" ON public.ledger_transactions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins read ledger entries" ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service full ledger entries" ON public.ledger_entries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Seed accounts
INSERT INTO public.ledger_accounts (code, name, type, currency) VALUES
  ('SPIH_BANK_HTG',         'SPIH Bank (HTG)',           'ASSET',     'HTG'),
  ('CUSTOMER_HTG_PENDING',  'Customer HTG Pending',      'LIABILITY', 'HTG'),
  ('CUSTOMER_HTG_SETTLED',  'Customer HTG Settled',      'LIABILITY', 'HTG'),
  ('FX_CLEARING_HTG',       'FX Clearing (HTG)',         'EQUITY',    'HTG'),
  ('FX_CLEARING_USDC',      'FX Clearing (USDC)',        'EQUITY',    'USDC'),
  ('DISTRIBUTOR_USDC',      'Distributor Hot Wallet USDC','ASSET',    'USDC'),
  ('CUSTOMER_USDC_PAYABLE', 'Customer USDC Payable',     'LIABILITY', 'USDC'),
  ('FEE_REVENUE_USDC',      'Fee Revenue (USDC)',        'REVENUE',   'USDC');

-- RPC: post a ledger transaction with entries atomically.
-- payload: { order_id, kind, description, posted_by, entries: [{ code, debit, credit, currency }] }
CREATE OR REPLACE FUNCTION public.post_ledger_entries(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx_id uuid;
  entry jsonb;
  acct_id uuid;
BEGIN
  INSERT INTO public.ledger_transactions (order_id, kind, description, posted_by)
  VALUES (
    NULLIF(payload->>'order_id','')::uuid,
    payload->>'kind',
    payload->>'description',
    NULLIF(payload->>'posted_by','')::uuid
  )
  RETURNING id INTO tx_id;

  FOR entry IN SELECT * FROM jsonb_array_elements(payload->'entries')
  LOOP
    SELECT id INTO acct_id FROM public.ledger_accounts WHERE code = entry->>'code';
    IF acct_id IS NULL THEN
      RAISE EXCEPTION 'unknown ledger account code: %', entry->>'code';
    END IF;
    INSERT INTO public.ledger_entries (transaction_id, account_id, currency, debit, credit)
    VALUES (
      tx_id,
      acct_id,
      entry->>'currency',
      COALESCE((entry->>'debit')::numeric, 0),
      COALESCE((entry->>'credit')::numeric, 0)
    );
  END LOOP;

  RETURN tx_id;
END
$$;

REVOKE ALL ON FUNCTION public.post_ledger_entries(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_ledger_entries(jsonb) TO service_role;