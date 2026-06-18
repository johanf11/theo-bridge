-- Lock down sensitive columns from direct client SELECT.
-- These remain readable by service_role (used by edge functions).

-- wallets.stellar_secret: only the reveal-wallet-secret edge function may read this.
REVOKE SELECT (stellar_secret) ON public.wallets FROM authenticated;
REVOKE SELECT (stellar_secret) ON public.wallets FROM anon;

-- invoices.share_token: org members must not learn share tokens. Owner fetches via RPC.
REVOKE SELECT (share_token) ON public.invoices FROM authenticated;
REVOKE SELECT (share_token) ON public.invoices FROM anon;

-- Owner-only accessor for invoice share tokens.
CREATE OR REPLACE FUNCTION public.get_invoice_share_token(p_invoice_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.share_token
  FROM public.invoices i
  JOIN public.customers c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
    AND c.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_invoice_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invoice_share_token(uuid) TO authenticated;
