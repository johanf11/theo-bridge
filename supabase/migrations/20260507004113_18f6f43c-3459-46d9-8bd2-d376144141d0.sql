
-- Add a generated boolean indicating presence of a stored signing key (no secret exposure)
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS has_signing_key boolean
  GENERATED ALWAYS AS (stellar_secret IS NOT NULL) STORED;

-- Revoke direct column access to stellar_secret from client roles.
-- Service role retains access (used by edge functions).
REVOKE SELECT (stellar_secret) ON public.wallets FROM authenticated, anon;
REVOKE UPDATE (stellar_secret), INSERT (stellar_secret) ON public.wallets FROM authenticated, anon;
