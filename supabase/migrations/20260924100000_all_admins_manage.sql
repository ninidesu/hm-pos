-- Make every active Admin / Manager account a full management writer.
-- Older management RPCs still call compatibility guards that looked at the
-- retired profiles table. Current portal accounts are stored in public.users.

create or replace function public.is_admin_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.hm_pos_is_admin();
$$;

create or replace function public.is_staff_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.hm_pos_is_staff();
$$;

create or replace function public.assert_inventory_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hm_pos_assert_admin();
end;
$$;

create or replace function public.assert_menu_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hm_pos_assert_admin();
end;
$$;

create or replace function public.assert_transaction_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hm_pos_assert_admin();
end;
$$;

create or replace function public.assert_menu_availability_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hm_pos_assert_admin();
end;
$$;

revoke all on function public.is_admin_profile() from public;
revoke all on function public.is_staff_profile() from public;
revoke all on function public.assert_inventory_writer() from public;
revoke all on function public.assert_menu_writer() from public;
revoke all on function public.assert_transaction_writer() from public;
revoke all on function public.assert_menu_availability_writer() from public;

grant execute on function public.is_admin_profile() to authenticated;
grant execute on function public.is_staff_profile() to authenticated;
grant execute on function public.assert_inventory_writer() to authenticated;
grant execute on function public.assert_menu_writer() to authenticated;
grant execute on function public.assert_transaction_writer() to authenticated;
grant execute on function public.assert_menu_availability_writer() to authenticated;

notify pgrst, 'reload schema';
