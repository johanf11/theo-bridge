CREATE TABLE public.reserve_attestations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_label TEXT NOT NULL,
  attested_at TIMESTAMPTZ NOT NULL,
  htg_balance NUMERIC NOT NULL,
  auditor_name TEXT,
  attestation_pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reserve_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view attestations"
ON public.reserve_attestations FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins manage attestations"
ON public.reserve_attestations FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access reserve_attestations"
ON public.reserve_attestations FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER touch_reserve_attestations_updated_at
BEFORE UPDATE ON public.reserve_attestations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.reserve_attestations (period_label, attested_at, htg_balance, auditor_name, attestation_pdf_url)
VALUES ('Q2 2026', '2026-04-15T00:00:00Z', 12500000, 'Deloitte Haiti S.A.', 'https://theo.ht/attestations/q2-2026.pdf');