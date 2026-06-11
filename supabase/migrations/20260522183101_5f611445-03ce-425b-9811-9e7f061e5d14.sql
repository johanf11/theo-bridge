REVOKE INSERT (stellar_secret) ON public.wallets FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (stellar_secret) ON public.wallets FROM authenticated, anon, PUBLIC;