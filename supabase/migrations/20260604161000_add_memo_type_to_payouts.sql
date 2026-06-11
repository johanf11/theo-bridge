-- Add memo_type to payouts so audits and retries can reconstruct the correct
-- Stellar memo type (MEMO_TEXT vs MEMO_ID).
--
-- Existing rows were always written with Memo.text (the old send-payment code
-- called Memo.text unconditionally), so they are backfilled as 'text'.
alter table payouts
  add column if not exists memo_type text check (memo_type in ('text', 'id'));

update payouts
  set memo_type = 'text'
  where memo is not null and memo_type is null;
