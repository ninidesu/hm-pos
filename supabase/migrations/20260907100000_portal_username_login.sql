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
    and public.normalize_role(u.role) in ('admin', 'manager', 'cashier')
  limit 1;
$$;

revoke all on function public.resolve_portal_login_email(text) from public;
grant execute on function public.resolve_portal_login_email(text) to anon, authenticated;
