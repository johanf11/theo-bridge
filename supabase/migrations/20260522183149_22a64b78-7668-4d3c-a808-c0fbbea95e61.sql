DROP POLICY IF EXISTS invoices_owner ON public.invoices;

CREATE POLICY invoices_owner ON public.invoices
  FOR ALL
  TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid()))
  WITH CHECK (customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid()));