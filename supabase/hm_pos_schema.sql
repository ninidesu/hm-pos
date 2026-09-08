-- HM POS · walk-in-only Supabase schema
--
-- Run once in the SQL Editor of a fresh Supabase project.
-- The system supports multiple portal accounts with two roles:
--   1. admin  = the combined Admin / Manager account
--   2. cashier
--
-- The first Auth user created after this script becomes admin and the next
-- becomes cashier. Additional portal accounts are created by an administrator.
--
-- Core tables:
--   public.users
--   public.menu_items
--   public.stock
--   public.orders
--   public.transactions
--
-- Supporting tables are limited to menu categories/add-ons, receipt line
-- snapshots, configuration/preferences, and audit history. There are no
-- customers, online orders, deliveries, pickups, cancellations, or refunds.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers and the two staff accounts
-- ---------------------------------------------------------------------------

create or replace function public.normalize_role(p_role text)
returns text
language sql
immutable
as $$
  select case
    when replace(replace(lower(trim(coalesce(p_role, ''))), ' ', '_'), '-', '_') in ('admin', 'manager') then 'admin'
    when replace(replace(lower(trim(coalesce(p_role, ''))), ' ', '_'), '-', '_') = 'cashier' then 'cashier'
    else ''
  end;
$$;

create or replace function public.hm_pos_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  username text unique,
  role text not null check (role in ('admin', 'cashier')),
  is_active boolean not null default true,
  removed_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Usernames are unique; each portal role may have multiple active accounts.

create or replace function public.hm_pos_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role = 'admin'
      and is_active
      and removed_at is null
  );
$$;

create or replace function public.hm_pos_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'cashier')
      and is_active
      and removed_at is null
  );
$$;

-- Compatibility name used by existing HM POS client helpers.
create or replace function public.is_staff_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.hm_pos_is_staff(); $$;

create or replace function public.hm_pos_assert_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.hm_pos_is_admin() then raise exception 'Admin / Manager access required'; end if;
end;
$$;

create or replace function public.hm_pos_assert_staff()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.hm_pos_is_staff() then raise exception 'HM POS access required'; end if;
end;
$$;

create or replace function public.hm_pos_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_requested_role text := public.normalize_role(new.raw_user_meta_data ->> 'hm_pos_role');
  v_internal_account boolean := coalesce(new.raw_app_meta_data ->> 'hm_pos_internal_account', 'false') = 'true';
begin
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  if v_internal_account and v_requested_role in ('admin', 'cashier') then
    v_role := v_requested_role;
  elsif not exists (select 1 from public.users where role = 'admin' and removed_at is null) then
    v_role := 'admin';
  elsif not exists (select 1 from public.users where role = 'cashier' and removed_at is null) then
    v_role := 'cashier';
  else
    raise exception 'HM POS requires administrator-created portal accounts';
  end if;

  insert into public.users (id, email, full_name, username, role)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@local.invalid'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), initcap(v_role)),
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    v_role
  );
  return new;
end;
$$;

drop trigger if exists hm_pos_on_auth_user_created on auth.users;
create trigger hm_pos_on_auth_user_created
  after insert on auth.users
  for each row execute function public.hm_pos_handle_new_auth_user();

-- Resolve active internal portal usernames for Supabase password authentication.
-- Password verification and role enforcement remain in Supabase Auth/application code.
create or replace function public.resolve_portal_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from public.users u
  where lower(btrim(u.username)) = lower(btrim(p_username))
    and u.is_active = true
    and u.removed_at is null
    and public.normalize_role(u.role) in ('admin', 'manager', 'cashier')
  limit 1;
$$;

revoke all on function public.resolve_portal_login_email(text) from public;
grant execute on function public.resolve_portal_login_email(text) to anon, authenticated;

-- If the first one or two Auth users were created before this schema was run,
-- make the oldest account admin and the next account cashier.
with ranked_auth_users as (
  select id, coalesce(email, id::text || '@local.invalid') as email,
         coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), 'HM POS User') as full_name,
         nullif(trim(raw_user_meta_data ->> 'username'), '') as username,
         row_number() over (order by created_at, id) as position
  from auth.users
), first_two as (
  select * from ranked_auth_users where position <= 2
)
insert into public.users (id, email, full_name, username, role)
select id, email, full_name, username,
       case when position = 1 then 'admin' else 'cashier' end
from first_two
on conflict (id) do nothing;

create or replace function public.hm_pos_guard_user_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.role := public.normalize_role(new.role);
  if new.role not in ('admin', 'cashier') then raise exception 'Role must be admin or cashier'; end if;

  if not public.hm_pos_is_admin() then
    new.email := old.email;
    new.role := old.role;
    new.is_active := old.is_active;
    new.removed_at := old.removed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists hm_pos_users_guard on public.users;
create trigger hm_pos_users_guard before update on public.users
  for each row execute function public.hm_pos_guard_user_update();

drop trigger if exists hm_pos_users_updated_at on public.users;
create trigger hm_pos_users_updated_at before update on public.users
  for each row execute function public.hm_pos_set_updated_at();

-- ---------------------------------------------------------------------------
-- Small supporting configuration and audit tables
-- ---------------------------------------------------------------------------

create table if not exists public.portal_configuration (
  scope text not null default 'system' check (scope = 'system'),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  is_public boolean not null default false,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);

insert into public.portal_configuration (scope, key, value, is_public)
values
  ('system', 'pricing', '{"vatRate":0,"pricesIncludeVat":false,"currency":"PHP","version":2}'::jsonb, false),
  ('system', 'payments', '{"enabledMethods":["cash","gcash","bank_transfer"]}'::jsonb, false)
on conflict (scope, key) do nothing;

drop trigger if exists hm_pos_configuration_updated_at on public.portal_configuration;
create trigger hm_pos_configuration_updated_at before update on public.portal_configuration
  for each row execute function public.hm_pos_set_updated_at();

create table if not exists public.portal_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.users(id) on delete set null,
  actor_name_snapshot text,
  actor_role_snapshot text,
  surface text not null default 'system',
  module text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text,
  summary text not null,
  result text not null default 'success',
  severity text not null default 'info',
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid
);

create index if not exists portal_audit_events_occurred_idx
  on public.portal_audit_events (occurred_at desc);

create table if not exists public.staff_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  table_density text not null default 'comfortable',
  rows_per_page integer not null default 25 check (rows_per_page between 10 and 100),
  remember_filters boolean not null default true,
  reduced_motion text not null default 'system',
  high_contrast boolean not null default false,
  font_size text not null default 'standard',
  notify_new_orders boolean not null default true,
  notify_low_stock boolean not null default true,
  notify_menu_changes boolean not null default false,
  system_change_popups boolean not null default true,
  system_error_popups boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists hm_pos_preferences_updated_at on public.staff_preferences;
create trigger hm_pos_preferences_updated_at before update on public.staff_preferences
  for each row execute function public.hm_pos_set_updated_at();

-- ---------------------------------------------------------------------------
-- Menu catalog and sellable-item stock
-- ---------------------------------------------------------------------------

create table if not exists public.main_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subcategories (
  id uuid primary key default gen_random_uuid(),
  main_category_id uuid not null references public.main_categories(id) on delete cascade,
  name text not null,
  display_name text,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (main_category_id, name)
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  main_category_id uuid references public.main_categories(id) on delete set null,
  subcategory_id uuid references public.subcategories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  price numeric(12,2) not null check (price >= 0),
  item_type text not null default 'food',
  temperature_type text not null default 'none'
    check (temperature_type in ('none', 'hot_only', 'iced_only', 'flexible')),
  allow_ice boolean not null default false,
  allow_sugar boolean not null default false,
  allow_addons boolean not null default false,
  image_url text,
  manual_available boolean not null default true,
  is_available boolean not null default true,
  unavailable_reason text,
  is_featured boolean not null default false,
  is_bestseller boolean not null default false,
  prep_time_minutes integer check (prep_time_minutes is null or prep_time_minutes >= 0),
  available_from date,
  available_until date,
  sort_order integer not null default 0,
  variant_options jsonb not null default '{}'::jsonb,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until >= available_from)
);

create index if not exists menu_items_active_sort_idx
  on public.menu_items (is_archived, is_available, sort_order);

create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price numeric(12,2) not null default 0 check (price >= 0),
  applies_to text not null default 'both',
  target_temperature text not null default 'both',
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null unique references public.menu_items(id) on delete cascade,
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  min_stock_level numeric(12,3) not null default 0 check (min_stock_level >= 0),
  high_stock_level numeric(12,3) not null default 0 check (high_stock_level >= 0),
  unit text not null default 'piece',
  sku text unique,
  cost_per_unit numeric(12,2) check (cost_per_unit is null or cost_per_unit >= 0),
  supplier text,
  expiration_date date,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array['main_categories','subcategories','menu_items','addons','stock'] loop
    execute format('drop trigger if exists hm_pos_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger hm_pos_%I_updated_at before update on public.%I for each row execute function public.hm_pos_set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Walk-in orders, reusable receipt snapshots, and payments
-- ---------------------------------------------------------------------------

create sequence if not exists public.hm_pos_order_sequence start 1;
create sequence if not exists public.hm_pos_receipt_sequence start 1;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  receipt_number text not null unique,
  status text not null default 'Completed' check (status in ('Completed', 'Voided')),
  cashier_id uuid not null references public.users(id),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_type text check (discount_type is null or lower(discount_type) in ('pwd', 'senior')),
  discount_customer_name text,
  discount_id_number text,
  discount_subtotal numeric(12,2) not null default 0 check (discount_subtotal >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  vat_exempt_amount numeric(12,2) not null default 0 check (vat_exempt_amount >= 0),
  final_total numeric(12,2) not null default 0 check (final_total >= 0),
  vat_rate numeric(6,5) not null default 0 check (vat_rate >= 0),
  prices_include_vat boolean not null default false,
  payment_status text not null default 'paid' check (payment_status in ('paid', 'voided')),
  payment_confirmed boolean not null default true,
  is_voided boolean not null default false,
  voided_reason text,
  voided_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (not is_voided and status = 'Completed' and voided_at is null)
    or (is_voided and status = 'Voided' and voided_at is not null and nullif(trim(voided_reason), '') is not null)
  )
);

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_cashier_created_idx on public.orders (cashier_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  display_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  addons_total numeric(12,2) not null default 0 check (addons_total >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  addons jsonb not null default '[]'::jsonb,
  customizations jsonb not null default '{}'::jsonb,
  is_discounted boolean not null default false,
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  vat_exempt_amount numeric(12,2) not null default 0 check (vat_exempt_amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  cashier_id uuid not null references public.users(id),
  method text not null check (method in ('cash', 'gcash', 'bank_transfer')),
  status text not null default 'paid' check (status in ('paid', 'voided')),
  amount_due numeric(12,2) not null check (amount_due >= 0),
  amount_received numeric(12,2) not null check (amount_received >= 0),
  change_amount numeric(12,2) not null default 0 check (change_amount >= 0),
  reference_number text,
  bank_name text,
  paid_at timestamptz not null default now(),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_created_idx on public.transactions (created_at desc);

create table if not exists public.transaction_audit_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  action text not null check (action in ('order_created', 'order_voided')),
  reason text,
  previous_value jsonb,
  new_value jsonb,
  performed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

drop trigger if exists hm_pos_orders_updated_at on public.orders;
create trigger hm_pos_orders_updated_at before update on public.orders
  for each row execute function public.hm_pos_set_updated_at();

drop trigger if exists hm_pos_transactions_updated_at on public.transactions;
create trigger hm_pos_transactions_updated_at before update on public.transactions
  for each row execute function public.hm_pos_set_updated_at();

create or replace function public.hm_pos_assign_receipt_numbers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(new.order_number), '') is null then
    new.order_number := 'WI-' || to_char(now() at time zone 'Asia/Manila', 'MMDD') || '-' || lpad(nextval('public.hm_pos_order_sequence')::text, 4, '0');
  end if;
  if nullif(trim(new.receipt_number), '') is null then
    new.receipt_number := 'R-' || to_char(now() at time zone 'Asia/Manila', 'MMDD') || '-' || lpad(nextval('public.hm_pos_receipt_sequence')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists hm_pos_assign_receipt_numbers on public.orders;
create trigger hm_pos_assign_receipt_numbers before insert on public.orders
  for each row execute function public.hm_pos_assign_receipt_numbers();

-- ---------------------------------------------------------------------------
-- Admin menu and stock RPCs
-- ---------------------------------------------------------------------------

create or replace function public.staff_upsert_main_category(p_id uuid, p_name text, p_display_name text, p_sort_order integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.hm_pos_assert_admin();
  if nullif(trim(p_name), '') is null then raise exception 'Category name is required'; end if;
  if p_id is null then
    insert into public.main_categories (name, display_name, sort_order)
    values (trim(p_name), nullif(trim(p_display_name), ''), coalesce(p_sort_order, 0)) returning id into v_id;
  else
    update public.main_categories set name = trim(p_name), display_name = nullif(trim(p_display_name), ''), sort_order = coalesce(p_sort_order, 0)
    where id = p_id and not is_archived returning id into v_id;
    if v_id is null then raise exception 'Category not found'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'A category with this name already exists';
end;
$$;

create or replace function public.staff_archive_main_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.hm_pos_assert_admin();
  update public.main_categories set is_archived = true where id = p_id;
  if not found then raise exception 'Category not found'; end if;
end;
$$;

create or replace function public.staff_upsert_subcategory(p_id uuid, p_main_category_id uuid, p_name text, p_display_name text, p_sort_order integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.hm_pos_assert_admin();
  if p_main_category_id is null then raise exception 'Parent category is required'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Subcategory name is required'; end if;
  if p_id is null then
    insert into public.subcategories (main_category_id, name, display_name, sort_order)
    values (p_main_category_id, trim(p_name), nullif(trim(p_display_name), ''), coalesce(p_sort_order, 0)) returning id into v_id;
  else
    update public.subcategories set main_category_id = p_main_category_id, name = trim(p_name), display_name = nullif(trim(p_display_name), ''), sort_order = coalesce(p_sort_order, 0)
    where id = p_id and not is_archived returning id into v_id;
    if v_id is null then raise exception 'Subcategory not found'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'A subcategory with this name already exists';
end;
$$;

create or replace function public.staff_archive_subcategory(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.hm_pos_assert_admin();
  update public.subcategories set is_archived = true where id = p_id;
  if not found then raise exception 'Subcategory not found'; end if;
end;
$$;

create or replace function public.staff_upsert_menu_item(
  p_id uuid, p_main_category_id uuid, p_subcategory_id uuid, p_name text, p_slug text,
  p_description text, p_price numeric, p_item_type text, p_temperature_type text,
  p_allow_ice boolean, p_allow_sugar boolean, p_allow_addons boolean, p_image_url text,
  p_manual_available boolean, p_is_featured boolean, p_is_bestseller boolean,
  p_prep_time_minutes integer, p_available_from date, p_available_until date,
  p_sort_order integer, p_variant_options jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_slug text;
begin
  perform public.hm_pos_assert_admin();
  if nullif(trim(p_name), '') is null then raise exception 'Menu item name is required'; end if;
  if coalesce(p_price, 0) < 0 then raise exception 'Price cannot be negative'; end if;
  if coalesce(p_temperature_type, 'none') not in ('none', 'hot_only', 'iced_only', 'flexible') then raise exception 'Invalid temperature type'; end if;
  v_slug := trim(both '-' from lower(regexp_replace(trim(coalesce(nullif(p_slug, ''), p_name)), '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug = '' then v_slug := 'menu-item-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8); end if;

  if p_id is null then
    insert into public.menu_items (
      main_category_id, subcategory_id, name, slug, description, price, item_type,
      temperature_type, allow_ice, allow_sugar, allow_addons, image_url,
      manual_available, is_available, is_featured, is_bestseller,
      prep_time_minutes, available_from, available_until, sort_order, variant_options
    ) values (
      p_main_category_id, p_subcategory_id, trim(p_name), v_slug, nullif(trim(p_description), ''), coalesce(p_price, 0), coalesce(nullif(trim(p_item_type), ''), 'food'),
      coalesce(p_temperature_type, 'none'), coalesce(p_allow_ice, false), coalesce(p_allow_sugar, false), coalesce(p_allow_addons, false), nullif(trim(p_image_url), ''),
      coalesce(p_manual_available, true), coalesce(p_manual_available, true), coalesce(p_is_featured, false), coalesce(p_is_bestseller, false),
      p_prep_time_minutes, p_available_from, p_available_until, coalesce(p_sort_order, 0), coalesce(p_variant_options, '{}'::jsonb)
    ) returning id into v_id;
  else
    update public.menu_items set
      main_category_id = p_main_category_id, subcategory_id = p_subcategory_id,
      name = trim(p_name), slug = v_slug, description = nullif(trim(p_description), ''),
      price = coalesce(p_price, 0), item_type = coalesce(nullif(trim(p_item_type), ''), 'food'),
      temperature_type = coalesce(p_temperature_type, 'none'), allow_ice = coalesce(p_allow_ice, false),
      allow_sugar = coalesce(p_allow_sugar, false), allow_addons = coalesce(p_allow_addons, false),
      image_url = nullif(trim(p_image_url), ''), manual_available = coalesce(p_manual_available, true),
      is_available = coalesce(p_manual_available, true), is_featured = coalesce(p_is_featured, false),
      is_bestseller = coalesce(p_is_bestseller, false), prep_time_minutes = p_prep_time_minutes,
      available_from = p_available_from, available_until = p_available_until,
      sort_order = coalesce(p_sort_order, 0), variant_options = coalesce(p_variant_options, '{}'::jsonb)
    where id = p_id and not is_archived returning id into v_id;
    if v_id is null then raise exception 'Menu item not found'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'A menu item with this slug already exists';
end;
$$;

create or replace function public.staff_set_menu_item_availability(p_id uuid, p_manual_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.hm_pos_assert_admin();
  update public.menu_items set
    manual_available = coalesce(p_manual_available, false),
    is_available = coalesce(p_manual_available, false),
    unavailable_reason = case when coalesce(p_manual_available, false) then null else 'manual' end
  where id = p_id and not is_archived;
  if not found then raise exception 'Menu item not found'; end if;
end;
$$;

create or replace function public.staff_archive_menu_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.hm_pos_assert_admin();
  update public.menu_items set is_archived = true, is_available = false, manual_available = false where id = p_id;
  if not found then raise exception 'Menu item not found'; end if;
end;
$$;

create or replace function public.staff_duplicate_menu_item(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_source public.menu_items%rowtype; v_id uuid; v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
  perform public.hm_pos_assert_admin();
  select * into v_source from public.menu_items where id = p_id and not is_archived;
  if not found then raise exception 'Menu item not found'; end if;
  insert into public.menu_items (
    main_category_id, subcategory_id, name, slug, description, price, item_type,
    temperature_type, allow_ice, allow_sugar, allow_addons, image_url,
    manual_available, is_available, is_featured, is_bestseller,
    prep_time_minutes, available_from, available_until, sort_order, variant_options
  ) values (
    v_source.main_category_id, v_source.subcategory_id, v_source.name || ' Copy', v_source.slug || '-copy-' || v_suffix,
    v_source.description, v_source.price, v_source.item_type, v_source.temperature_type,
    v_source.allow_ice, v_source.allow_sugar, v_source.allow_addons, v_source.image_url,
    false, false, false, false, v_source.prep_time_minutes, v_source.available_from,
    v_source.available_until, v_source.sort_order, v_source.variant_options
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.staff_upsert_stock(
  p_id uuid, p_menu_item_id uuid, p_quantity numeric, p_min_stock_level numeric,
  p_high_stock_level numeric, p_unit text, p_supplier text, p_notes text,
  p_sku text, p_cost_per_unit numeric, p_expiration_date date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.hm_pos_assert_admin();
  if p_menu_item_id is null or not exists (select 1 from public.menu_items where id = p_menu_item_id and not is_archived) then raise exception 'Menu item is required'; end if;
  if coalesce(p_quantity, 0) < 0 or coalesce(p_min_stock_level, 0) < 0 or coalesce(p_high_stock_level, 0) < 0 then raise exception 'Stock values cannot be negative'; end if;
  insert into public.stock (id, menu_item_id, quantity, min_stock_level, high_stock_level, unit, supplier, notes, sku, cost_per_unit, expiration_date)
  values (coalesce(p_id, gen_random_uuid()), p_menu_item_id, coalesce(p_quantity, 0), coalesce(p_min_stock_level, 0), coalesce(p_high_stock_level, 0), coalesce(nullif(trim(p_unit), ''), 'piece'), nullif(trim(p_supplier), ''), nullif(trim(p_notes), ''), nullif(trim(p_sku), ''), p_cost_per_unit, p_expiration_date)
  on conflict (menu_item_id) do update set
    quantity = excluded.quantity, min_stock_level = excluded.min_stock_level,
    high_stock_level = excluded.high_stock_level, unit = excluded.unit,
    supplier = excluded.supplier, notes = excluded.notes, sku = excluded.sku,
    cost_per_unit = excluded.cost_per_unit, expiration_date = excluded.expiration_date,
    is_archived = false
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.staff_adjust_stock(p_stock_id uuid, p_delta numeric, p_reason text)
returns public.stock language plpgsql security definer set search_path = public as $$
declare v_row public.stock%rowtype;
begin
  perform public.hm_pos_assert_admin();
  select * into v_row from public.stock where id = p_stock_id and not is_archived for update;
  if not found then raise exception 'Stock record not found'; end if;
  if v_row.quantity + coalesce(p_delta, 0) < 0 then raise exception 'Stock cannot go below zero'; end if;
  update public.stock set quantity = quantity + coalesce(p_delta, 0), notes = coalesce(nullif(trim(p_reason), ''), notes)
  where id = p_stock_id returning * into v_row;
  update public.menu_items set
    is_available = case when v_row.quantity <= 0 then false else manual_available end,
    unavailable_reason = case when v_row.quantity <= 0 then 'out_of_stock' when manual_available then null else unavailable_reason end
  where id = v_row.menu_item_id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic walk-in checkout and voiding
-- ---------------------------------------------------------------------------

create or replace function public.create_cashier_order(request_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb := coalesce(request_payload -> 'order', '{}'::jsonb);
  v_payment jsonb := coalesce(request_payload -> 'payment', '{}'::jsonb);
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_stock public.stock%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_quantity integer;
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_discount_amount numeric(12,2) := greatest(0, coalesce((v_order ->> 'discount_amount')::numeric, 0));
  v_discount_subtotal numeric(12,2) := greatest(0, coalesce((v_order ->> 'discount_subtotal')::numeric, 0));
  v_final_total numeric(12,2);
  v_vat_rate numeric(6,5) := 0;
  v_prices_include_vat boolean := false;
  v_method text := lower(coalesce(v_payment ->> 'method', 'cash'));
  v_received numeric(12,2);
  v_change numeric(12,2);
begin
  perform public.hm_pos_assert_staff();
  if jsonb_typeof(request_payload -> 'items') <> 'array' or jsonb_array_length(request_payload -> 'items') = 0 then
    raise exception 'At least one menu item is required';
  end if;
  if v_method not in ('cash', 'gcash', 'bank_transfer') then raise exception 'Unsupported payment method'; end if;

  for v_item in select value from jsonb_array_elements(request_payload -> 'items') loop
    select * into v_menu from public.menu_items
    where id = (v_item ->> 'menu_item_id')::uuid and not is_archived for update;
    if not found or not v_menu.is_available then raise exception 'A selected menu item is unavailable'; end if;

    v_quantity := coalesce((v_item ->> 'quantity')::integer, 0);
    v_unit_price := coalesce((v_item ->> 'unit_price')::numeric, v_menu.price);
    if v_quantity <= 0 then raise exception 'Item quantity must be greater than zero'; end if;
    if v_unit_price < 0 then raise exception 'Item price cannot be negative'; end if;
    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    select * into v_stock from public.stock
    where menu_item_id = v_menu.id and not is_archived for update;
    if found then
      if v_stock.quantity < v_quantity then raise exception 'Insufficient stock for %', v_menu.name; end if;
      update public.stock set quantity = quantity - v_quantity where id = v_stock.id;
      if v_stock.quantity - v_quantity <= 0 then
        update public.menu_items set is_available = false, unavailable_reason = 'out_of_stock' where id = v_menu.id;
      end if;
    end if;
  end loop;

  v_subtotal := round(v_subtotal, 2);
  if v_discount_amount > v_subtotal then raise exception 'Discount cannot exceed subtotal'; end if;
  v_final_total := round(v_subtotal - v_discount_amount, 2);
  v_received := coalesce((v_payment ->> 'amount_received')::numeric, v_final_total);
  if v_received < v_final_total then raise exception 'Amount received is less than the total'; end if;
  v_change := case when v_method = 'cash' then round(v_received - v_final_total, 2) else 0 end;

  insert into public.orders (
    id, order_number, receipt_number, status, cashier_id, subtotal,
    discount_type, discount_customer_name, discount_id_number, discount_subtotal,
    discount_amount, vat_exempt_amount, final_total, vat_rate, prices_include_vat,
    payment_status, payment_confirmed
  ) values (
    v_order_id, nullif(trim(v_order ->> 'order_number'), ''), null, 'Completed', auth.uid(), v_subtotal,
    nullif(trim(v_order ->> 'discount_type'), ''), nullif(trim(v_order ->> 'discount_customer_name'), ''),
    nullif(trim(v_order ->> 'discount_id_number'), ''), v_discount_subtotal,
    v_discount_amount, greatest(0, coalesce((v_order ->> 'vat_exempt_amount')::numeric, 0)),
    v_final_total, v_vat_rate, v_prices_include_vat, 'paid', true
  );

  for v_item in select value from jsonb_array_elements(request_payload -> 'items') loop
    select * into v_menu from public.menu_items where id = (v_item ->> 'menu_item_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_price := coalesce((v_item ->> 'unit_price')::numeric, v_menu.price);
    v_line_total := round(v_unit_price * v_quantity, 2);
    insert into public.order_items (
      order_id, menu_item_id, item_name, display_name, unit_price, quantity,
      addons_total, line_total, addons, customizations, is_discounted,
      discount_amount, vat_exempt_amount
    ) values (
      v_order_id, v_menu.id, v_menu.name, v_menu.name, v_unit_price, v_quantity,
      greatest(0, coalesce((v_item ->> 'addons_total')::numeric, 0)), v_line_total,
      coalesce(v_item -> 'addons', '[]'::jsonb), coalesce(v_item -> 'customizations', '{}'::jsonb),
      coalesce((v_item ->> 'is_discounted')::boolean, false),
      greatest(0, coalesce((v_item ->> 'discount_amount')::numeric, 0)),
      greatest(0, coalesce((v_item ->> 'vat_exempt_amount')::numeric, 0))
    );
  end loop;

  insert into public.transactions (
    order_id, cashier_id, method, status, amount_due, amount_received,
    change_amount, reference_number, bank_name, paid_at
  ) values (
    v_order_id, auth.uid(), v_method, 'paid', v_final_total, v_received,
    v_change, nullif(trim(v_payment ->> 'reference_number'), ''),
    nullif(trim(v_payment ->> 'bank_name'), ''),
    coalesce((v_payment ->> 'paid_at')::timestamptz, now())
  );

  insert into public.transaction_audit_log (order_id, action, new_value, performed_by)
  values (v_order_id, 'order_created', jsonb_build_object('total', v_final_total, 'payment_method', v_method), auth.uid());

  return (
    select jsonb_build_object(
      'id', id, 'order_number', order_number, 'receipt_number', receipt_number,
      'subtotal', subtotal, 'discount_amount', discount_amount,
      'total', final_total, 'final_total', final_total, 'change_amount', v_change,
      'vat_rate', vat_rate, 'prices_include_vat', prices_include_vat
    ) from public.orders where id = v_order_id
  );
end;
$$;

create or replace function public.staff_void_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  perform public.hm_pos_assert_admin();
  if nullif(trim(p_reason), '') is null then raise exception 'A void reason is required'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.is_voided then raise exception 'Order is already voided'; end if;

  update public.orders set
    status = 'Voided', payment_status = 'voided', is_voided = true,
    voided_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_order_id;

  update public.transactions set status = 'voided', voided_at = now()
  where order_id = p_order_id;

  for v_item in
    select menu_item_id, sum(quantity)::numeric as quantity
    from public.order_items where order_id = p_order_id and menu_item_id is not null
    group by menu_item_id
  loop
    update public.stock set quantity = quantity + v_item.quantity
    where menu_item_id = v_item.menu_item_id and not is_archived;
    update public.menu_items set is_available = manual_available, unavailable_reason = case when manual_available then null else unavailable_reason end
    where id = v_item.menu_item_id and not is_archived;
  end loop;

  insert into public.transaction_audit_log (order_id, action, reason, previous_value, new_value, performed_by)
  values (
    p_order_id, 'order_voided', trim(p_reason),
    jsonb_build_object('status', v_order.status, 'payment_status', v_order.payment_status),
    jsonb_build_object('status', 'Voided', 'payment_status', 'voided'),
    auth.uid()
  );
end;
$$;

create or replace function public.admin_update_portal_user(p_user_id uuid, p_role text)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.users%rowtype; v_role text := public.normalize_role(p_role);
begin
  perform public.hm_pos_assert_admin();
  if v_role not in ('admin', 'cashier') then raise exception 'Role must be Admin / Manager or Cashier'; end if;
  update public.users set role = v_role where id = p_user_id and removed_at is null returning * into v_row;
  if not found then raise exception 'User not found'; end if;
  return v_row;
end;
$$;

-- Create internal accounts directly in Auth with a confirmed password. This
-- keeps user provisioning inside the database and does not send email, OTP,
-- or invitation messages.
create or replace function public.admin_create_portal_user(
  p_full_name text,
  p_username text,
  p_password text,
  p_role text
) returns public.users
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_actor public.users%rowtype;
  v_row public.users%rowtype;
  v_user_id uuid := gen_random_uuid();
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_username text := btrim(coalesce(p_username, ''));
  v_password text := coalesce(p_password, '');
  v_role text := public.normalize_role(p_role);
  v_email text;
begin
  perform public.hm_pos_assert_admin();
  perform pg_advisory_xact_lock(hashtextextended('hm_pos_portal_user_creation', 0));

  select * into v_actor
  from public.users
  where id = auth.uid() and role = 'admin' and is_active and removed_at is null;
  if not found then raise exception 'Administrator access required'; end if;
  if v_role not in ('admin', 'cashier') then raise exception 'Role must be Admin / Manager or Cashier'; end if;
  if char_length(v_full_name) < 2 or char_length(v_full_name) > 60
     or v_full_name !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then
    raise exception 'Full name must be 2 to 60 letters';
  end if;
  if v_username !~ '^[A-Za-z0-9._-]{3,24}$' then
    raise exception 'Username must be 3 to 24 letters, numbers, dots, underscores, or hyphens';
  end if;
  if char_length(v_password) not between 8 and 32 then
    raise exception 'Password must be 8 to 32 characters';
  end if;
  if exists (select 1 from public.users where lower(username) = lower(v_username)) then
    raise exception 'That username is already in use';
  end if;

  -- An internal email-shaped identifier satisfies Supabase Auth's identity
  -- model while keeping the portal username as the only user-facing login.
  v_email := lower(v_username) || '@hm-pos.local';
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'That username is already in use';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
    crypt(v_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'hm_pos_internal_account', true),
    jsonb_build_object('full_name', v_full_name, 'username', v_username, 'hm_pos_role', v_role),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id, v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email', null, now(), now()
  );

  select * into v_row from public.users where id = v_user_id;
  if not found then raise exception 'The portal profile could not be created'; end if;

  insert into public.portal_audit_events (
    actor_id, actor_name_snapshot, actor_role_snapshot, surface, module, action,
    entity_type, entity_id, entity_label, summary, result, severity, after_data, metadata
  ) values (
    v_actor.id, coalesce(v_actor.full_name, v_actor.username, v_actor.email), 'admin', 'admin',
    'users_access', 'user.created', 'profile', v_row.id::text, v_row.username,
    coalesce(v_actor.full_name, v_actor.username, v_actor.email) || ' added ' || v_row.username,
    'success', 'info',
    jsonb_build_object('full_name', v_row.full_name, 'username', v_row.username, 'role', v_row.role),
    jsonb_build_object('local_login', true, 'email_sent', false, 'otp_used', false)
  );
  return v_row;
exception when unique_violation then
  raise exception 'That username is already in use';
end;
$$;

-- Update another portal user's local credentials without a service-role
-- client or an email-change workflow.
create or replace function public.admin_update_portal_user_credentials(
  p_user_id uuid,
  p_username text,
  p_password text default null
) returns public.users
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_actor public.users%rowtype;
  v_current public.users%rowtype;
  v_row public.users%rowtype;
  v_username text := btrim(coalesce(p_username, ''));
  v_password text := coalesce(p_password, '');
begin
  perform public.hm_pos_assert_admin();
  select * into v_actor from public.users where id = auth.uid() and role = 'admin' and is_active and removed_at is null;
  if not found then raise exception 'Administrator access required'; end if;
  select * into v_current from public.users where id = p_user_id and is_active and removed_at is null for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() then raise exception 'Use your profile settings to update your own account'; end if;
  if v_username !~ '^[A-Za-z0-9._-]{3,24}$' then
    raise exception 'Username must be 3 to 24 letters, numbers, dots, underscores, or hyphens';
  end if;
  if v_password <> '' and char_length(v_password) not between 8 and 32 then
    raise exception 'Password must be 8 to 32 characters';
  end if;
  if exists (select 1 from public.users where id <> p_user_id and lower(username) = lower(v_username)) then
    raise exception 'That username is already in use';
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_username),
      encrypted_password = case when v_password = '' then encrypted_password else crypt(v_password, gen_salt('bf')) end,
      updated_at = now()
  where id = p_user_id;
  if not found then raise exception 'Authentication account not found'; end if;

  update public.users
  set username = v_username, updated_at = now()
  where id = p_user_id
  returning * into v_row;

  insert into public.portal_audit_events (
    actor_id, actor_name_snapshot, actor_role_snapshot, surface, module, action,
    entity_type, entity_id, entity_label, summary, result, severity, before_data, after_data, metadata
  ) values (
    v_actor.id, coalesce(v_actor.full_name, v_actor.username, v_actor.email), 'admin', 'admin',
    'users_access', 'user.credentials_updated', 'profile', v_row.id::text, v_row.username,
    coalesce(v_actor.full_name, v_actor.username, v_actor.email) || ' updated ' || v_row.username,
    'success', 'info', jsonb_build_object('username', v_current.username),
    jsonb_build_object('username', v_row.username, 'password_changed', v_password <> ''),
    jsonb_build_object('local_login', true)
  );
  return v_row;
exception when unique_violation then
  raise exception 'That username is already in use';
end;
$$;

-- Keep the profile row for historical order references, but block the user
-- from future portal access without calling an Edge Function.
create or replace function public.admin_remove_portal_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_current public.users%rowtype;
  v_removed_at timestamptz := now();
begin
  perform public.hm_pos_assert_admin();
  select * into v_actor from public.users where id = auth.uid() and role = 'admin' and is_active and removed_at is null;
  if not found then raise exception 'Administrator access required'; end if;
  select * into v_current from public.users where id = p_user_id and removed_at is null for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot remove your own administrator account'; end if;
  if v_current.role = 'admin' and not exists (
    select 1 from public.users
    where id <> p_user_id and role = 'admin' and is_active and removed_at is null
  ) then
    raise exception 'At least one administrator is required';
  end if;

  update public.users
  set is_active = false, removed_at = v_removed_at, updated_at = v_removed_at
  where id = p_user_id;

  insert into public.portal_audit_events (
    actor_id, actor_name_snapshot, actor_role_snapshot, surface, module, action,
    entity_type, entity_id, entity_label, summary, result, severity, before_data, after_data, metadata
  ) values (
    v_actor.id, coalesce(v_actor.full_name, v_actor.username, v_actor.email), 'admin', 'admin',
    'users_access', 'user.removed', 'profile', v_current.id::text,
    coalesce(v_current.username, v_current.full_name, v_current.email),
    coalesce(v_actor.full_name, v_actor.username, v_actor.email) || ' removed ' || coalesce(v_current.username, v_current.email),
    'success', 'critical',
    jsonb_build_object('is_active', v_current.is_active, 'role', v_current.role),
    jsonb_build_object('is_active', false, 'removed_at', v_removed_at),
    jsonb_build_object('email_sent', false, 'otp_used', false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.portal_configuration enable row level security;
alter table public.portal_audit_events enable row level security;
alter table public.staff_preferences enable row level security;
alter table public.main_categories enable row level security;
alter table public.subcategories enable row level security;
alter table public.menu_items enable row level security;
alter table public.addons enable row level security;
alter table public.stock enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_audit_log enable row level security;

create policy "HM staff read users" on public.users for select to authenticated using (public.hm_pos_is_staff());
create policy "HM users update own activity" on public.users for update to authenticated using (id = auth.uid() or public.hm_pos_is_admin()) with check (id = auth.uid() or public.hm_pos_is_admin());

create policy "HM staff read configuration" on public.portal_configuration for select to authenticated using (public.hm_pos_is_staff());
create policy "HM admin manage configuration" on public.portal_configuration for all to authenticated using (public.hm_pos_is_admin()) with check (public.hm_pos_is_admin());

create policy "HM admin read audit" on public.portal_audit_events for select to authenticated using (public.hm_pos_is_admin());
create policy "HM admin write audit" on public.portal_audit_events for insert to authenticated with check (public.hm_pos_is_admin());

create policy "HM users read own preferences" on public.staff_preferences for select to authenticated using (user_id = auth.uid());
create policy "HM users manage own preferences" on public.staff_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "HM staff read categories" on public.main_categories for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read subcategories" on public.subcategories for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read menu" on public.menu_items for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read addons" on public.addons for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read stock" on public.stock for select to authenticated using (public.hm_pos_is_staff());

create policy "HM staff read orders" on public.orders for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read order items" on public.order_items for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read transactions" on public.transactions for select to authenticated using (public.hm_pos_is_staff());
create policy "HM staff read transaction audit" on public.transaction_audit_log for select to authenticated using (public.hm_pos_is_staff());

grant usage on schema public to authenticated;
grant select, update on public.users to authenticated;
grant select on public.portal_configuration, public.portal_audit_events to authenticated;
grant insert, update, delete on public.portal_configuration to authenticated;
grant insert on public.portal_audit_events to authenticated;
grant select, insert, update, delete on public.staff_preferences to authenticated;
grant select on public.main_categories, public.subcategories, public.menu_items, public.addons, public.stock to authenticated;
grant select on public.orders, public.order_items, public.transactions, public.transaction_audit_log to authenticated;

grant execute on function public.staff_upsert_main_category(uuid, text, text, integer) to authenticated;
grant execute on function public.staff_archive_main_category(uuid) to authenticated;
grant execute on function public.staff_upsert_subcategory(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.staff_archive_subcategory(uuid) to authenticated;
grant execute on function public.staff_upsert_menu_item(uuid, uuid, uuid, text, text, text, numeric, text, text, boolean, boolean, boolean, text, boolean, boolean, boolean, integer, date, date, integer, jsonb) to authenticated;
grant execute on function public.staff_set_menu_item_availability(uuid, boolean) to authenticated;
grant execute on function public.staff_archive_menu_item(uuid) to authenticated;
grant execute on function public.staff_duplicate_menu_item(uuid) to authenticated;
grant execute on function public.staff_upsert_stock(uuid, uuid, numeric, numeric, numeric, text, text, text, text, numeric, date) to authenticated;
grant execute on function public.staff_adjust_stock(uuid, numeric, text) to authenticated;
grant execute on function public.create_cashier_order(jsonb) to authenticated;
grant execute on function public.staff_void_order(uuid, text) to authenticated;
grant execute on function public.admin_update_portal_user(uuid, text) to authenticated;
grant execute on function public.admin_create_portal_user(text, text, text, text) to authenticated;
grant execute on function public.admin_update_portal_user_credentials(uuid, text, text) to authenticated;
grant execute on function public.admin_remove_portal_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage used by the menu and optional in-store payment QR configuration
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('portal-assets', 'portal-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "HM public read menu images" on storage.objects;
create policy "HM public read menu images" on storage.objects for select using (bucket_id = 'menu-images');
drop policy if exists "HM admin manage menu images" on storage.objects;
create policy "HM admin manage menu images" on storage.objects for all to authenticated
  using (bucket_id = 'menu-images' and public.hm_pos_is_admin())
  with check (bucket_id = 'menu-images' and public.hm_pos_is_admin());

drop policy if exists "HM public read portal assets" on storage.objects;
create policy "HM public read portal assets" on storage.objects for select using (bucket_id = 'portal-assets');
drop policy if exists "HM admin manage portal assets" on storage.objects;
create policy "HM admin manage portal assets" on storage.objects for all to authenticated
  using (bucket_id = 'portal-assets' and public.hm_pos_is_admin())
  with check (bucket_id = 'portal-assets' and public.hm_pos_is_admin());

-- End of HM POS walk-in-only schema.
