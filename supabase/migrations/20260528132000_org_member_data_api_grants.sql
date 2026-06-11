-- Fix: make org-member RLS policies reachable through the Data API
-- Policies alone are not enough unless the authenticated role has table privileges.

GRANT SELECT ON public.customers TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.payouts TO authenticated;
GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.org_members TO authenticated;

GRANT ALL ON public.customers TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.payouts TO service_role;
GRANT ALL ON public.wallets TO service_role;
GRANT ALL ON public.org_members TO service_role;
