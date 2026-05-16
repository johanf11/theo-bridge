INSERT INTO public.ledger_accounts (code, name, type, currency) VALUES
  ('EXTERNAL_FLOW_USDC', 'External counterparty flow (USDC)', 'EQUITY', 'USDC'),
  ('EXTERNAL_FLOW_HTG',  'External counterparty flow (HTG)',  'EQUITY', 'HTG')
ON CONFLICT (code) DO NOTHING;