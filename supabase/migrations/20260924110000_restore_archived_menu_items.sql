-- Allow any active administrator to restore an archived menu item.

create or replace function public.staff_restore_menu_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.menu_items%rowtype;
  v_out_of_stock boolean;
begin
  perform public.hm_pos_assert_admin();

  select * into v_item
  from public.menu_items
  where id = p_id and is_archived
  for update;
  if not found then raise exception 'Archived menu item not found'; end if;

  if not exists (
    select 1 from public.main_categories
    where id = v_item.main_category_id and not is_archived
  ) then
    raise exception 'Restore the item category first';
  end if;

  if v_item.subcategory_id is not null and not exists (
    select 1 from public.subcategories
    where id = v_item.subcategory_id and not is_archived
  ) then
    raise exception 'Restore the item subcategory first';
  end if;

  select exists (
    select 1 from public.stock
    where menu_item_id = p_id and not is_archived and quantity <= 0
  ) into v_out_of_stock;

  update public.menu_items
  set is_archived = false,
      manual_available = true,
      is_available = not v_out_of_stock,
      unavailable_reason = case when v_out_of_stock then 'out_of_stock' else null end,
      updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.staff_restore_menu_item(uuid) from public;
grant execute on function public.staff_restore_menu_item(uuid) to authenticated;

notify pgrst, 'reload schema';
