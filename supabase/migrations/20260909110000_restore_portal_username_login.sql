-- HM POS · restore username-to-email resolution for portal login
--
-- The portal stores internal Auth emails behind usernames. This RPC is the
-- read-only bridge used before Supabase password authentication. It does not
-- send email, OTPs, invitations, or invoke an Edge Function.

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

notify pgrst, 'reload schema';
