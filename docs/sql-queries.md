# Theo Bridge — Key SQL Queries

Operational queries for ledger reconciliation, monitoring, and debugging.
Run in Supabase dashboard → SQL editor, or via Lovable Cloud → SQL editor.

---

## Ledger reconciliation

### Trial balance — net per account (both currencies)

```sql
SELECT
  la.code,
  la.name,
  la.type,
  la.currency,
  SUM(le.debit)            AS total_debit,
  SUM(le.credit)           AS total_credit,
  CASE
    WHEN la.type IN ('LIABILITY','REVENUE','EQUITY')
      THEN SUM(le.credit) - SUM(le.debit)
    ELSE SUM(le.debit) - SUM(le.credit)
  END                      AS balance
FROM public.ledger_accounts la
LEFT JOIN public.ledger_entries le ON le.account_id = la.id
GROUP BY la.id, la.code, la.name, la.type, la.currency
ORDER BY la.currency, la.type, la.code;
```

### Check trial balance nets to zero per currency

```sql
SELECT
  le.currency,
  SUM(le.debit)  AS total_debit,
  SUM(le.credit) AS total_credit,
  SUM(le.debit) - SUM(le.credit) AS net  -- must be 0.0000000
FROM public.ledger_entries le
GROUP BY le.currency;
```

### SPIH pool balance (deposits vs outflows)

```sql
SELECT
  SUM(le.debit)                        AS total_deposits,
  SUM(le.credit)                       AS total_outflows,
  SUM(le.debit) - SUM(le.credit)       AS pool_balance
FROM public.ledger_entries le
JOIN public.ledger_accounts la ON la.id = le.account_id
WHERE la.code = 'SPIH_BANK_HTG';
```

### FX clearing outstanding obligation

```sql
SELECT
  SUM(le.credit) - SUM(le.debit) AS outstanding_htg
FROM public.ledger_entries le
JOIN public.ledger_accounts la ON la.id = le.account_id
WHERE la.code = 'FX_CLEARING_HTG';
```

### Fee revenue earned (USDC)

```sql
SELECT
  SUM(le.credit) - SUM(le.debit) AS fee_revenue_usdc
FROM public.ledger_entries le
JOIN public.ledger_accounts la ON la.id = le.account_id
WHERE la.code = 'FEE_REVENUE_USDC';
```

### Distributor USDC book balance (for drift check)

```sql
SELECT
  SUM(le.debit) - SUM(le.credit) AS book_balance_usdc
FROM public.ledger_entries le
JOIN public.ledger_accounts la ON la.id = le.account_id
WHERE la.code = 'DISTRIBUTOR_USDC';
```

---

## Integrity / gap detection

### Layer 3 — Withdrawals missing from ledger

Run after any batch of withdrawals to confirm no ledger gaps.
Should return 0 rows in normal operation.

```sql
SELECT
  o.reference_number,
  o.htg_amount,
  o.stellar_tx_hash,
  o.completed_at
FROM public.orders o
WHERE o.order_kind = 'htgc_withdrawal'
  AND o.status = 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1 FROM public.ledger_transactions lt
    WHERE lt.source_key = 'orders:' || o.id::text || ':htgc_burn_withdraw'
  )
ORDER BY o.completed_at DESC;
```

### Completed orders (all kinds) missing any ledger entry

```sql
SELECT
  o.reference_number,
  o.order_kind,
  o.htg_amount,
  o.usdc_amount,
  o.completed_at
FROM public.orders o
WHERE o.status = 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1 FROM public.ledger_transactions lt
    WHERE lt.order_id = o.id
  )
ORDER BY o.completed_at DESC;
```

### Unresolved posting failures

```sql
SELECT
  id,
  source,
  reason,
  order_id,
  stellar_tx_hash,
  created_at
FROM public.ledger_posting_failures
WHERE resolved_at IS NULL
ORDER BY created_at DESC;
```

### Unbalanced ledger transactions (should return 0 rows)

```sql
SELECT
  lt.id,
  lt.source_key,
  lt.kind,
  le.currency,
  SUM(le.debit)  AS total_debit,
  SUM(le.credit) AS total_credit,
  SUM(le.debit) - SUM(le.credit) AS imbalance
FROM public.ledger_transactions lt
JOIN public.ledger_entries le ON le.transaction_id = lt.id
GROUP BY lt.id, lt.source_key, lt.kind, le.currency
HAVING ABS(SUM(le.debit) - SUM(le.credit)) > 0.0000001
ORDER BY lt.created_at DESC;
```

### Accounts with unexpected negative balances

```sql
SELECT
  la.code,
  la.name,
  la.type,
  la.currency,
  CASE
    WHEN la.type IN ('LIABILITY','REVENUE','EQUITY')
      THEN SUM(le.credit) - SUM(le.debit)
    ELSE SUM(le.debit) - SUM(le.credit)
  END AS balance
FROM public.ledger_accounts la
LEFT JOIN public.ledger_entries le ON le.account_id = la.id
GROUP BY la.id, la.code, la.name, la.type, la.currency
HAVING
  CASE
    WHEN la.type IN ('LIABILITY','REVENUE','EQUITY')
      THEN SUM(le.credit) - SUM(le.debit)
    ELSE SUM(le.debit) - SUM(le.credit)
  END < -0.0000001
ORDER BY la.currency, la.code;
```

---

## Backfill / repair

### Backfill missing htgc_burn_withdraw entry for a single withdrawal

Replace `'THEO-W-XXXXXXXX'` with the reference number.

```sql
DO $$
DECLARE
  v_order_id    uuid;
  v_htg_amount  numeric;
  v_source_key  text;
  v_fx_htg_id   uuid;
  v_spih_id     uuid;
  v_exists      boolean;
BEGIN
  SELECT id, htg_amount INTO v_order_id, v_htg_amount
  FROM public.orders
  WHERE reference_number = 'THEO-W-XXXXXXXX';

  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;

  v_source_key := 'orders:' || v_order_id::text || ':htgc_burn_withdraw';

  SELECT EXISTS(
    SELECT 1 FROM public.ledger_transactions WHERE source_key = v_source_key
  ) INTO v_exists;

  IF v_exists THEN RAISE NOTICE 'Already posted — nothing to do'; RETURN; END IF;

  SELECT id INTO v_fx_htg_id FROM public.ledger_accounts WHERE code = 'FX_CLEARING_HTG';
  SELECT id INTO v_spih_id   FROM public.ledger_accounts WHERE code = 'SPIH_BANK_HTG';

  PERFORM public.post_ledger_entries(jsonb_build_object(
    'kind',        'htgc_burn_withdraw',
    'description', 'HTG-C burn for withdrawal ' || (SELECT reference_number FROM public.orders WHERE id = v_order_id),
    'source_key',  v_source_key,
    'order_id',    v_order_id,
    'entries', jsonb_build_array(
      jsonb_build_object('account_id', v_fx_htg_id, 'currency', 'HTG', 'debit', v_htg_amount, 'credit', 0),
      jsonb_build_object('account_id', v_spih_id,   'currency', 'HTG', 'debit', 0, 'credit', v_htg_amount)
    )
  ));

  RAISE NOTICE 'Posted % HTG for %', v_htg_amount, v_order_id;
END;
$$;
```

---

## Operational

### Recent ledger transactions with entries (last 50)

```sql
SELECT
  lt.created_at,
  lt.kind,
  lt.description,
  lt.source_key,
  lt.stellar_tx_hash,
  la.code        AS account,
  le.currency,
  le.debit,
  le.credit
FROM public.ledger_transactions lt
JOIN public.ledger_entries le ON le.transaction_id = lt.id
JOIN public.ledger_accounts la ON la.id = le.account_id
ORDER BY lt.created_at DESC
LIMIT 50;
```

### Per-customer USDC balance

```sql
SELECT
  c.company_name,
  c.email,
  SUM(le.debit) - SUM(le.credit) AS usdc_balance
FROM public.ledger_accounts la
JOIN public.ledger_entries le ON le.account_id = la.id
JOIN public.customers c ON c.id = la.customer_id
WHERE la.code = 'CUSTOMER_USDC_PAYABLE'
  AND la.customer_id IS NOT NULL
GROUP BY c.id, c.company_name, c.email
ORDER BY usdc_balance DESC;
```

### Volume by transaction kind (last 30 days)

```sql
SELECT
  lt.kind,
  COUNT(*)                                AS tx_count,
  SUM(CASE WHEN le.currency='HTG'  THEN le.debit ELSE 0 END) AS htg_volume,
  SUM(CASE WHEN le.currency='USDC' THEN le.debit ELSE 0 END) AS usdc_volume
FROM public.ledger_transactions lt
JOIN public.ledger_entries le ON le.transaction_id = lt.id
WHERE lt.created_at >= now() - interval '30 days'
GROUP BY lt.kind
ORDER BY usdc_volume DESC;
```

### Orders with FAILED status (last 7 days)

```sql
SELECT
  reference_number,
  order_kind,
  htg_amount,
  usdc_amount,
  failure_reason,
  created_at
FROM public.orders
WHERE status = 'FAILED'
  AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC;
```

---

## Nightly health check (run all before mainnet go-live)

Run these four queries in sequence. All should return 0 rows / balanced totals:

1. **Layer 3** — withdrawals missing from ledger (see above)
2. **Unbalanced transactions** — (see above)
3. **Negative balances** — (see above)
4. **Unresolved posting failures** — (see above)
