-- Add currency + network columns to wallets
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USDC',
  ADD COLUMN IF NOT EXISTS network text NOT NULL DEFAULT 'Stellar';

-- Allow customers to insert their own wallets
CREATE POLICY "Customers insert own wallets"
ON public.wallets
FOR INSERT
TO authenticated
WITH CHECK (
  customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
);

-- Allow customers to update their own wallets (e.g. balance refresh, label edit)
CREATE POLICY "Customers update own wallets"
ON public.wallets
FOR UPDATE
TO authenticated
USING (
  customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
)
WITH CHECK (
  customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
);

-- Allow customers to delete their own wallets
CREATE POLICY "Customers delete own wallets"
ON public.wallets
FOR DELETE
TO authenticated
USING (
  customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
);