INSERT INTO public.ledger_accounts (code, name, type, currency) VALUES
  ('EXTERNAL_FLOW_USDC', 'External counterparty flow (USDC)', 'LIABILITY', 'USDC'),
  ('EXTERNAL_FLOW_HTG',  'External counterparty flow (HTG)',  'LIABILITY', 'HTG')
ON CONFLICT (code) DO NOTHING;