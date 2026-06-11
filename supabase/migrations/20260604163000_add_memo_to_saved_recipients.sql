-- Store memo and memo_type on saved recipients so the fields auto-fill
-- when a contact is selected and are preserved when saving a new one.
alter table saved_recipients
  add column if not exists memo      text,
  add column if not exists memo_type text check (memo_type in ('text', 'id'));
