-- Let the unauthenticated portal load only the public store identity.
-- A security-definer function avoids granting anonymous users access to the
-- wider system configuration table, which also contains private settings.

create or replace function public.hm_pos_get_public_store_info()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select value
        from public.portal_configuration
       where scope = 'system'
         and key = 'store'
         and is_public = true
       limit 1
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.hm_pos_get_public_store_info() from public;
grant execute on function public.hm_pos_get_public_store_info() to anon, authenticated;
