-- Seed three ledger account codes that are referenced by edge functions
-- but were never added to ledger_accounts, causing silent safePostLedger failures.
--
-- EXTERNAL_COUNTERPARTY_FLOW_USDC  — used by send-payment
--   Dr CUSTOMER_USDC_PAYABLE / Cr EXTERNAL_COUNTERPARTY_FLOW_USDC
--   Represents USDC flows to external third-party wallets (not Theo-owned).
--   Clearing account: normal balance is CREDIT.
--
-- EXTERNAL_FLOW_USDC               — used by admin-refund-distributor
--   Dr EXTERNAL_FLOW_USDC / Cr DISTRIBUTOR_USDC
--   Represents USDC received from an external source into the distributor
--   (e.g. a manual top-up or refund from a counterparty). DEBIT normal balance.
--
-- EXTERNAL_FLOW_HTG                — used by topup-htgc
--   Dr EXTERNAL_FLOW_HTG / Cr HTGC_ISSUED
--   Represents HTG received externally to back newly minted HTG-C supply. DEBIT normal.
--
-- HTGC_WITHDRAWAL                  — kind used by withdraw-htgc (added today)
--   Journal: Dr HTGC_ISSUED / Cr SPIH_BANK_HTG  (both already seeded)

-- chart_of_accounts (if it exists in this environment)
-- chart_of_accounts (Supabase — no enum constraint on account_type)
INSERT INTO chart_of_accounts (id, name, account_type, currency, normal_balance, is_template)
VALUES
  ('EXTERNAL_COUNTERPARTY_FLOW_USDC', 'External Counterparty Flow (USDC)', 'LIABILITY', 'USDC', 'CREDIT', false),
  ('EXTERNAL_FLOW_USDC',              'External Inflow (USDC)',             'ASSET',     'USDC', 'DEBIT',  false),
  ('EXTERNAL_FLOW_HTG',               'External Inflow (HTG)',              'ASSET',     'HTG',  'DEBIT',  false)
ON CONFLICT (id) DO NOTHING;

-- ledger_accounts — Lovable Cloud uses an enum for type; CLEARING not valid there.
-- Use LIABILITY for credit-normal flow accounts, ASSET for debit-normal.
INSERT INTO ledger_accounts (code, name, type, currency)
VALUES
  ('EXTERNAL_COUNTERPARTY_FLOW_USDC', 'External Counterparty Flow (USDC)', 'LIABILITY', 'USDC'),
  ('EXTERNAL_FLOW_USDC',              'External Inflow (USDC)',             'ASSET',     'USDC'),
  ('EXTERNAL_FLOW_HTG',               'External Inflow (HTG)',              'ASSET',     'HTG')
ON CONFLICT (code) DO NOTHING;
