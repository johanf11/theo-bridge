-- ── Permissions enum ─────────────────────────────────────────────────────────
create type org_permission as enum (
  'convert',
  'payout_send',
  'balance_view_keys',
  'accounts_manage',
  'view_balances'
);

create table if not exists org_roles (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique(customer_id, name)
);

create table if not exists role_permissions (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references org_roles(id) on delete cascade,
  permission  org_permission not null,
  enabled     boolean not null default false,
  unique(role_id, permission)
);

create table if not exists org_members (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  role_id     uuid not null references org_roles(id) on delete restrict,
  email       text not null,
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique(customer_id, email)
);

alter table org_roles        enable row level security;
alter table role_permissions enable row level security;
alter table org_members      enable row level security;

create or replace function is_org_member(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from customers  where id = p_customer_id and user_id = auth.uid()
    union all
    select 1 from org_members where customer_id = p_customer_id and user_id = auth.uid()
  );
$$;

create or replace function is_org_owner(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from customers where id = p_customer_id and user_id = auth.uid());
$$;

create policy "members view roles"     on org_roles for select using (is_org_member(customer_id));
create policy "owner manage roles"     on org_roles for all    using (is_org_owner(customer_id)) with check (is_org_owner(customer_id));
create policy "service full org_roles" on org_roles for all    to service_role using (true) with check (true);

create policy "members view perms"     on role_permissions for select using (exists (select 1 from org_roles r where r.id = role_id and is_org_member(r.customer_id)));
create policy "owner manage perms"     on role_permissions for all    using (exists (select 1 from org_roles r where r.id = role_id and is_org_owner(r.customer_id))) with check (exists (select 1 from org_roles r where r.id = role_id and is_org_owner(r.customer_id)));
create policy "service full perms"     on role_permissions for all    to service_role using (true) with check (true);

create policy "members view members"   on org_members for select using (is_org_member(customer_id));
create policy "owner manage members"   on org_members for all    using (is_org_owner(customer_id)) with check (is_org_owner(customer_id));
create policy "service full members"   on org_members for all    to service_role using (true) with check (true);

create or replace function seed_default_roles(
  p_customer_id  uuid,
  p_owner_email  text,
  p_owner_user_id uuid
) returns void language plpgsql set search_path = public as $$
declare
  owner_role_id   uuid;
  analyst_role_id uuid;
  viewer_role_id  uuid;
begin
  if exists (select 1 from org_roles where customer_id = p_customer_id) then return; end if;

  insert into org_roles (customer_id, name, is_system) values (p_customer_id, 'Owner',             true) returning id into owner_role_id;
  insert into org_roles (customer_id, name, is_system) values (p_customer_id, 'Treasury Analyst',  true) returning id into analyst_role_id;
  insert into org_roles (customer_id, name, is_system) values (p_customer_id, 'Viewer',            true) returning id into viewer_role_id;

  insert into role_permissions (role_id, permission, enabled) values
    (owner_role_id, 'convert',            true),
    (owner_role_id, 'payout_send',        true),
    (owner_role_id, 'balance_view_keys',  true),
    (owner_role_id, 'accounts_manage',    true),
    (owner_role_id, 'view_balances',      true);

  insert into role_permissions (role_id, permission, enabled) values
    (analyst_role_id, 'convert',           true),
    (analyst_role_id, 'payout_send',       true),
    (analyst_role_id, 'balance_view_keys', false),
    (analyst_role_id, 'accounts_manage',   false),
    (analyst_role_id, 'view_balances',     true);

  insert into role_permissions (role_id, permission, enabled) values
    (viewer_role_id, 'convert',            false),
    (viewer_role_id, 'payout_send',        false),
    (viewer_role_id, 'balance_view_keys',  false),
    (viewer_role_id, 'accounts_manage',    false),
    (viewer_role_id, 'view_balances',      true);

  if p_owner_user_id is not null and p_owner_email <> '' then
    insert into org_members (customer_id, user_id, role_id, email, accepted_at)
    values (p_customer_id, p_owner_user_id, owner_role_id, p_owner_email, now())
    on conflict (customer_id, email) do nothing;
  end if;
end;
$$;

do $$
declare
  rec         record;
  owner_email text;
begin
  for rec in select id, user_id from customers loop
    begin
      select email into owner_email from auth.users where id = rec.user_id;
      perform seed_default_roles(rec.id, coalesce(owner_email, ''), rec.user_id);
    exception when others then null;
    end;
  end loop;
end;
$$;

create or replace function on_customer_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_email text;
begin
  select email into owner_email from auth.users where id = new.user_id;
  perform seed_default_roles(new.id, coalesce(owner_email, ''), new.user_id);
  return new;
end;
$$;

create trigger customer_created_seed_roles
  after insert on customers
  for each row execute function on_customer_created();

create index org_members_user_id_idx      on org_members(user_id);
create index org_members_customer_id_idx  on org_members(customer_id);
create index role_permissions_role_id_idx on role_permissions(role_id);