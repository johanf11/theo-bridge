
-- Defense-in-depth: explicitly revoke column-level INSERT and UPDATE on stellar_secret
-- from client roles. Service role retains access (used by create-wallet edge function).
REVOKE INSERT (stellar_secret), UPDATE (stellar_secret), SELECT (stellar_secret)
  ON public.wallets FROM authenticated, anon, PUBLIC;
