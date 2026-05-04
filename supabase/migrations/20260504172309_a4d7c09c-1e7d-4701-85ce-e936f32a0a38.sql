
CREATE TABLE public.blend_positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL,
  wallet_id       uuid NOT NULL,
  pool_address    text NOT NULL,
  reserve_asset   text NOT NULL DEFAULT 'USDC',
  deposited_usdc  numeric(20,7) NOT NULL DEFAULT 0,
  last_tx_hash    text,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_id, pool_address)
);

CREATE INDEX idx_blend_positions_customer ON public.blend_positions(customer_id);

ALTER TABLE public.blend_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own blend positions"
  ON public.blend_positions FOR SELECT
  TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access on blend_positions"
  ON public.blend_positions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER blend_positions_touch
  BEFORE UPDATE ON public.blend_positions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
