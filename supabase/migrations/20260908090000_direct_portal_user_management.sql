-- HM POS · direct local portal account management
--
-- User creation is intentionally local: the Admin sets a username and
-- password, the account is confirmed immediately, and no email, OTP,
-- invitation, or Edge Function is required.

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

grant execute on function public.admin_create_portal_user(text, text, text, text) to authenticated;
grant execute on function public.admin_update_portal_user_credentials(uuid, text, text) to authenticated;
grant execute on function public.admin_remove_portal_user(uuid) to authenticated;
