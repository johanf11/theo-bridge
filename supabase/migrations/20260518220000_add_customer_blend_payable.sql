-- Add CUSTOMER_BLEND_PAYABLE to the chart of accounts.
--
-- Accounting rationale:
--   BLEND_DEPOSITS_USDC (ASSET) — Theo's receivable from Blend protocol.
--     Debited when customer funds are swept to Blend; credited on withdrawal.
--   CUSTOMER_BLEND_PAYABLE (LIABILITY) — what Theo owes customers whose USDC
--     is currently deployed in Blend. Mirrors CUSTOMER_USDC_PAYABLE but
--     ring-fenced so Blend-deployed funds are visible separately on the
--     balance sheet. Credited when funds enter Blend; debited on withdrawal.
--
-- Journal when customer sweeps USDC into Blend:
--   Dr BLEND_DEPOSITS_USDC      +X   (receivable from Blend increases)
--   Cr DISTRIBUTOR_USDC         +X   (leaves hot wallet)
--   Dr CUSTOMER_USDC_PAYABLE    +X   (general USDC liability discharged)
--   Cr CUSTOMER_BLEND_PAYABLE   +X   (Blend-specific liability opened)
--
-- Journal on yield accrual:
--   Dr BLEND_DEPOSITS_USDC      +Y   (receivable grows with yield)
--   Cr BLEND_YIELD_USDC         +Y   (revenue / pass-through)
--
-- Journal when customer withdraws from Blend:
--   Dr CUSTOMER_BLEND_PAYABLE   +X+Y (liability discharged)
--   Cr BLEND_DEPOSITS_USDC      +X+Y (receivable closed)
--   Dr DISTRIBUTOR_USDC         +X+Y (back in hot wallet)
--   Cr CUSTOMER_USDC_PAYABLE    +X+Y (general liability re-opened, or customer withdraws directly)

-- 1. Add to chart_of_accounts
INSERT INTO chart_of_accounts (id, name, account_type, currency, normal_balance, is_template)
VALUES (
  'CUSTOMER_BLEND_PAYABLE',
  'Customer Blend Deposits Payable',
  'LIABILITY',
  'USDC',
  'CREDIT',
  false   -- pooled, customer identified via ledger_entries.customer_id
)
ON CONFLICT (id) DO UPDATE
  SET name           = EXCLUDED.name,
      account_type   = EXCLUDED.account_type,
      normal_balance = EXCLUDED.normal_balance;

-- 2. Seed the system ledger account
INSERT INTO ledger_accounts (code, currency)
VALUES ('CUSTOMER_BLEND_PAYABLE', 'USDC')
ON CONFLICT DO NOTHING;
