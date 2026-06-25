
-- 1) app_settings
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write app_settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) vendor_wire_instructions
CREATE TYPE public.owlting_wire_status AS ENUM ('RECEIVED','WIRED','FAILED');

CREATE TABLE public.vendor_wire_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.payouts(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  vendor_country text,
  bank_name text,
  account_number text,
  swift_bic text,
  reference text,
  note text,
  amount_usdc numeric(20,7) NOT NULL,
  owlting_status public.owlting_wire_status NOT NULL DEFAULT 'RECEIVED',
  wired_at timestamptz,
  simulated_wire_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendor_wire_instructions_customer_idx ON public.vendor_wire_instructions(customer_id, created_at DESC);
CREATE INDEX vendor_wire_instructions_status_idx ON public.vendor_wire_instructions(owlting_status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_wire_instructions TO authenticated;
GRANT ALL ON public.vendor_wire_instructions TO service_role;
ALTER TABLE public.vendor_wire_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read own vendor wires" ON public.vendor_wire_instructions
  FOR SELECT TO authenticated USING (public.is_org_member(customer_id));
CREATE POLICY "Admins read all vendor wires" ON public.vendor_wire_instructions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update vendor wires" ON public.vendor_wire_instructions
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER vendor_wire_instructions_touch
  BEFORE UPDATE ON public.vendor_wire_instructions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
