-- HM POS · repair direct portal Auth records
--
-- Direct local portal accounts must have a complete Supabase Auth record and
-- an email identity, even though the user only signs in with a username.
-- This migration repairs accounts already created by the earlier SQL
-- function and keeps future direct accounts login-ready. It does not send
-- email, OTP, invitation, or invoke an Edge Function.

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

-- Repair nullable Auth values and create the email identity used by password
-- authentication whenever an account is inserted directly by HM POS.
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
  update auth.users
  set instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
      confirmation_token = coalesce(confirmation_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      recovery_token = coalesce(recovery_token, '')
  where id = new.id;

  if new.email is not null and not exists (
    select 1 from auth.identities where user_id = new.id and provider = 'email'
  ) then
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), new.id, new.id::text,
      jsonb_build_object('sub', new.id::text, 'email', new.email, 'email_verified', true),
      'email', null, coalesce(new.created_at, now()), now()
    );
  end if;

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

update auth.users
set instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
    email_confirmed_at = coalesce(email_confirmed_at, created_at, now()),
    confirmation_token = coalesce(confirmation_token, ''),
    email_change = coalesce(email_change, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    recovery_token = coalesce(recovery_token, '')
where id in (select id from public.users where removed_at is null);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  auth_user.id,
  auth_user.id::text,
  jsonb_build_object('sub', auth_user.id::text, 'email', auth_user.email, 'email_verified', true),
  'email',
  null,
  coalesce(auth_user.created_at, now()),
  now()
from auth.users auth_user
join public.users portal_user on portal_user.id = auth_user.id
where auth_user.email is not null
  and not exists (
    select 1 from auth.identities identity_row
    where identity_row.user_id = auth_user.id and identity_row.provider = 'email'
  );

notify pgrst, 'reload schema';
