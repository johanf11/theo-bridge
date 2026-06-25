
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  last_four text NOT NULL,
  hashed_key text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['payments:write','wallets:read','balance:read','quotes:write']::text[],
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX api_keys_customer_id_idx ON public.api_keys(customer_id);
CREATE INDEX api_keys_hashed_key_idx ON public.api_keys(hashed_key);

GRANT SELECT, INSERT, UPDATE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their org api keys"
  ON public.api_keys FOR SELECT
  TO authenticated
  USING (public.is_org_owner(customer_id));

CREATE POLICY "Owners can create api keys"
  ON public.api_keys FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_owner(customer_id));

CREATE POLICY "Owners can revoke api keys"
  ON public.api_keys FOR UPDATE
  TO authenticated
  USING (public.is_org_owner(customer_id))
  WITH CHECK (public.is_org_owner(customer_id));

CREATE POLICY "Service role full access api keys"
  ON public.api_keys FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
