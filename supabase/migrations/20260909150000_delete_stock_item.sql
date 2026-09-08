-- Replace stock adjustment removal with a reasoned, permanent stock-record delete.
-- The linked menu item remains in the menu catalog; only its stock-management row
-- is removed from the stock table.

create or replace function public.staff_delete_stock(p_stock_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock public.stock%rowtype;
  v_item_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor_name text;
  v_actor_role text;
begin
  perform public.hm_pos_assert_admin();
  if v_reason = '' then raise exception 'A reason is required to remove an item'; end if;
  if length(v_reason) > 160 then raise exception 'The removal reason must be 160 characters or fewer'; end if;

  select s.*
    into v_stock
    from public.stock s
   where s.id = p_stock_id
   for update;
  if not found then raise exception 'Stock record not found'; end if;

  select name into v_item_name from public.menu_items where id = v_stock.menu_item_id;

  select coalesce(username, full_name, email, 'Unknown user'), role
    into v_actor_name, v_actor_role
    from public.users
   where id = auth.uid();

  insert into public.portal_audit_events (
    actor_id, actor_name_snapshot, actor_role_snapshot, surface, module, action,
    entity_type, entity_id, entity_label, summary, result, severity, before_data, metadata
  ) values (
    auth.uid(), v_actor_name, v_actor_role, 'admin', 'inventory', 'stock.deleted',
    'stock', v_stock.id::text, coalesce(v_item_name, 'Stock item'),
    coalesce(v_actor_name, 'An administrator') || ' removed ' || coalesce(v_item_name, 'a stock item') || ' from stock management',
    'success', 'warning', to_jsonb(v_stock), jsonb_build_object('reason', v_reason)
  );

  delete from public.stock where id = v_stock.id;
end;
$$;

revoke all on function public.staff_delete_stock(uuid, text) from public;
grant execute on function public.staff_delete_stock(uuid, text) to authenticated;

notify pgrst, 'reload schema';