-- Add a soft "send back for changes" KYB state, distinct from a hard REJECTED.
-- ADD VALUE must be committed before the value can be used (e.g. by the
-- protect_customer_fields trigger in the following migration), so it lives
-- in its own migration file.
ALTER TYPE public.kyb_status ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';
