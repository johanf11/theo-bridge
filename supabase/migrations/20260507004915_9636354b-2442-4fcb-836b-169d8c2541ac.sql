
-- Revoke column-level UPDATE on sensitive customer fields from client roles.
-- Service role retains full access for backend-managed updates (KYB review, fee changes).
REVOKE UPDATE (fee_bps, corridor_bps, kyb_status, kyb_rejection_reason, kyb_submitted_at, stellar_wallet_address, user_id, email)
  ON public.customers FROM authenticated, anon;
