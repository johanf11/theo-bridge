-- Rename HTG counterpart to match the canonical USDC naming.
-- Safe: EXTERNAL_FLOW_HTG has zero ledger_entries (verified) so no postings need rebooking.
UPDATE public.ledger_accounts
   SET code = 'EXTERNAL_COUNTERPARTY_FLOW_HTG',
       name = 'External Counterparty Flow (HTG)'
 WHERE code = 'EXTERNAL_FLOW_HTG';

-- Drop the orphaned LIABILITY duplicate that survived the 2026-05-18 reseed.
-- Verified to have zero entries; admin-refund-distributor has been updated to
-- reference EXTERNAL_COUNTERPARTY_FLOW_USDC instead.
DELETE FROM public.ledger_accounts
 WHERE code = 'EXTERNAL_FLOW_USDC'
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_entries le WHERE le.account_id = ledger_accounts.id
   );