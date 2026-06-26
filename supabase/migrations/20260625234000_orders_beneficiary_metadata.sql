-- Store Odoo beneficiary / settlement details on orders for Owlting off-ramp reconciliation.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS beneficiary_metadata jsonb;
