-- Revoke UPDATE on wallets.stellar_secret from client roles (SELECT already revoked)
REVOKE UPDATE (stellar_secret) ON public.wallets FROM anon, authenticated;

-- Pin search_path on internal helper function
CREATE OR REPLACE FUNCTION public._ledger_validate_balance(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
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

  IF EXISTS (
    SELECT 1
    FROM   public.ledger_entries   le
    JOIN   public.ledger_accounts  la ON la.id = le.account_id
    WHERE  le.transaction_id = p_transaction_id
      AND  le.currency <> la.currency
  ) THEN
    RAISE EXCEPTION 'Currency mismatch on transaction %', p_transaction_id;
  END IF;
END;
$function$;