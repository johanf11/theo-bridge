
-- Defense-in-depth: column-level UPDATE privileges on customers and wallets.
-- Triggers already lock sensitive fields, but column grants make the
-- restriction visible to scanners and prevent privilege escalation even
-- if a trigger is ever dropped.

-- customers: authenticated may only update safe presentation/profile fields.
REVOKE UPDATE ON public.customers FROM authenticated;
GRANT UPDATE (
  company_name,
  contact_name,
  phone,
  email,
  legal_name,
  registration_number,
  country,
  business_type,
  kyb_status,        -- trigger restricts to PENDING/REJECTED -> UNDER_REVIEW
  kyb_submitted_at,
  updated_at
) ON public.customers TO authenticated;
GRANT UPDATE ON public.customers TO service_role;

-- wallets: authenticated may only update presentation fields.
REVOKE UPDATE ON public.wallets FROM authenticated;
GRANT UPDATE (
  label,
  display_order,
  updated_at
) ON public.wallets TO authenticated;
GRANT UPDATE ON public.wallets TO service_role;
