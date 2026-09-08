-- Menu item choices with pack quantities and stock-aware checkout.
-- A choice quantity is the number of base pieces consumed by one purchased choice.

create table if not exists public.order_menu_stock_deductions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  quantity numeric(12,3) not null check (quantity > 0),
  reversed boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists order_menu_stock_deductions_item_unique
  on public.order_menu_stock_deductions(order_item_id);

-- The public RPC is wrapped by 20260902090000, so replace only its internal
-- implementation and keep server-generated order and receipt identifiers.
create or replace function public.create_cashier_order_internal(request_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 o jsonb:=coalesce(request_payload->'order','{}'); p jsonb:=coalesce(request_payload->'payment','{}'); i jsonb; m public.menu_items%rowtype; choice jsonb;
 oid uuid:=gen_random_uuid(); ono text:='WI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 q integer; total_q integer:=0; base numeric(12,2); adds numeric(12,2); unit numeric(12,2); line numeric(12,2); sub numeric(12,2):=0; discounted_sub numeric(12,2):=0;
 dtype text:=nullif(btrim(o->>'discount_type'),''); discount numeric(12,2):=0; grand numeric(12,2);
 method text:=lower(btrim(coalesce(p->>'method',''))); received numeric(12,2); change_due numeric(12,2);
 requested_addons integer; valid_addons integer; temperature text; variant text; is_discounted boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not public.hm_pos_is_staff() then raise exception 'Cashier access required'; end if;
 if jsonb_array_length(coalesce(request_payload->'items','[]'))=0 then raise exception 'The cashier order has no items'; end if;
 for i in select * from jsonb_array_elements(request_payload->'items') loop
  begin q:=(i->>'quantity')::integer; exception when others then raise exception 'Every item must have a valid quantity'; end;
  if q<1 or q>99 then raise exception 'Item quantity must be between 1 and 99'; end if;
  total_q:=total_q+q; if total_q>200 then raise exception 'An order cannot contain more than 200 items'; end if;
  select * into m from public.menu_items where id=(i->>'menu_item_id')::uuid and is_available=true and is_archived=false;
  if not found then raise exception 'A selected menu item is unavailable'; end if;
  base:=m.price; variant:=nullif(btrim(i->'customizations'->>'variantKey'),'');
  if variant is not null then
   if coalesce(m.variant_options->>'type','')='choices' then
    select value into choice from jsonb_array_elements(case when jsonb_typeof(m.variant_options->'choices')='array' then m.variant_options->'choices' else '[]'::jsonb end) where value->>'key'=variant;
    if not found then raise exception 'A selected item choice is unavailable'; end if;
    base:=coalesce((choice->>'price')::numeric,m.price);
   elsif not (m.variant_options?'prices' and (m.variant_options->'prices')?variant) then
    raise exception 'A selected item variant is unavailable';
   else
    base:=(m.variant_options->'prices'->>variant)::numeric;
   end if;
  end if;
  temperature:=lower(btrim(coalesce(i->'customizations'->>'temperature','')));
  if m.temperature_type='iced_only' and temperature not in ('cold','iced') then raise exception 'This item requires a cold temperature'; end if;
  if m.temperature_type='hot_only' and temperature<>'hot' then raise exception 'This item requires a hot temperature'; end if;
  if m.temperature_type='flexible' and temperature not in ('hot','cold','iced') then raise exception 'Select a valid item temperature'; end if;
  select count(distinct lower(btrim(x->>'name'))) into requested_addons from jsonb_array_elements(coalesce(i->'addons','[]')) x;
  if requested_addons>0 and not coalesce(m.allow_addons,false) then raise exception 'Add-ons are not allowed for this item'; end if;
  select count(*),coalesce(sum(a.price),0) into valid_addons,adds from public.addons a
   where lower(a.name) in(select lower(btrim(x->>'name')) from jsonb_array_elements(coalesce(i->'addons','[]')) x)
   and a.is_available=true and a.applies_to in ('both',m.item_type)
   and (a.target_temperature='both' or (a.target_temperature in ('iced','cold') and temperature in ('iced','cold')) or (a.target_temperature='hot' and temperature='hot'));
  if valid_addons<>requested_addons then raise exception 'One or more selected add-ons are unavailable for this item'; end if;
  sub:=sub+((base+adds)*q);
  if dtype is not null and coalesce((i->>'is_discounted')::boolean,false) then discounted_sub:=discounted_sub+(base*q); end if;
 end loop;
 if dtype is not null then
  if dtype not in ('PWD','Senior') then raise exception 'Unsupported discount type'; end if;
  if nullif(btrim(o->>'discount_customer_name'),'') is null or nullif(btrim(o->>'discount_id_number'),'') is null then raise exception 'Discount customer name and ID number are required'; end if;
  if discounted_sub <= 0 then raise exception 'At least one item must be selected for the discount'; end if;
  discount:=round(discounted_sub*0.20,2);
 end if;
 grand:=sub-discount;
 if method not in ('cash','gcash','bank_transfer') then raise exception 'Unsupported payment method'; end if;
 if method='cash' then
  received:=coalesce((p->>'amount_received')::numeric,0); if received<grand then raise exception 'Cash received is less than the total'; end if; change_due:=received-grand;
 elsif method='gcash' then
  if coalesce(p->>'reference_number','') !~ '^[0-9]{13}$' then raise exception 'GCash reference number must be exactly 13 digits'; end if; received:=grand; change_due:=0;
 else
  if nullif(btrim(p->>'bank_name'),'') is null then raise exception 'Bank name is required'; end if;
  if coalesce(p->>'reference_number','') !~ '^[A-Za-z0-9-]{6,30}$' then raise exception 'Bank reference must be 6 to 30 letters, numbers, or hyphens'; end if; received:=grand; change_due:=0;
 end if;
 insert into public.orders(id,order_number,order_sequence,order_source,cashier_id,order_type,status,customer_name,subtotal,discount_type,discount_customer_name,discount_id_number,discount_subtotal,discount_amount,final_total,payment_status,payment_confirmed)
 values(oid,ono,floor(extract(epoch from clock_timestamp()))::bigint,'cashier_pos',auth.uid(),'walk-in','Preparing',coalesce(nullif(btrim(o->>'customer_name'),''),'Walk-in Customer'),sub,dtype,nullif(btrim(o->>'discount_customer_name'),''),nullif(btrim(o->>'discount_id_number'),''),case when dtype is null then 0 else discounted_sub end,discount,grand,'paid',true);
 for i in select * from jsonb_array_elements(request_payload->'items') loop
  select * into m from public.menu_items where id=(i->>'menu_item_id')::uuid; q:=(i->>'quantity')::integer; base:=m.price; variant:=nullif(btrim(i->'customizations'->>'variantKey'),'');
  if variant is not null then
   if coalesce(m.variant_options->>'type','')='choices' then
    select value into choice from jsonb_array_elements(case when jsonb_typeof(m.variant_options->'choices')='array' then m.variant_options->'choices' else '[]'::jsonb end) where value->>'key'=variant;
    if not found then raise exception 'A selected item choice is unavailable'; end if;
    base:=coalesce((choice->>'price')::numeric,m.price);
   else
    base:=(m.variant_options->'prices'->>variant)::numeric;
   end if;
  end if;
  select coalesce(sum(a.price),0) into adds from public.addons a where lower(a.name) in(select lower(btrim(x->>'name')) from jsonb_array_elements(coalesce(i->'addons','[]')) x) and a.is_available=true;
  unit:=base+adds; line:=unit*q; is_discounted:=dtype is not null and coalesce((i->>'is_discounted')::boolean,false);
  insert into public.order_items(order_id,menu_item_id,item_name,unit_price,quantity,line_total,is_discounted,discount_amount,customizations,addons)
  values(oid,m.id,m.name,unit,q,line,is_discounted,case when is_discounted then round(base*q*0.20,2) else 0 end,coalesce(i->'customizations','{}'),coalesce(i->'addons','[]'));
 end loop;
 insert into public.payments(order_id,method,amount_due,amount_received,change_amount,reference_number,account_number,bank_name,status,paid_at)
 values(oid,method,grand,received,change_due,nullif(p->>'reference_number',''),nullif(p->>'account_number',''),nullif(p->>'bank_name',''),'paid',now());
 return jsonb_build_object('id',oid,'order_number',ono,'subtotal',sub,'discount_amount',discount,'total',grand,'change_amount',change_due);
end; $$;

create or replace function public.deduct_order_item_inventory(p_order_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item public.order_items%rowtype; v_order public.orders%rowtype; v_variant text; v_choice_units numeric := 1;
  v_mapping record; v_recipe record; v_amount numeric; v_current numeric; v_has_product_mapping boolean; v_stock public.stock%rowtype;
begin
  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then raise exception 'Order item not found'; end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  if v_order.status = 'Cancelled' or coalesce(v_order.is_voided, false) then return; end if;
  if v_order.order_source = 'customer_pos' and not coalesce(v_order.payment_confirmed, false) then return; end if;
  if v_order.order_source = 'cashier_pos' and (v_order.receipt_number is null or not coalesce(v_order.payment_confirmed, false)) then return; end if;

  v_variant := nullif(coalesce(v_item.customizations->>'variation_id', v_item.customizations->>'variantKey', ''), '');
  if v_variant is not null then
    select greatest(1, coalesce((choice->>'quantity')::numeric, 1)) into v_choice_units
    from public.menu_items menu
    cross join lateral jsonb_array_elements(case when jsonb_typeof(menu.variant_options->'choices')='array' then menu.variant_options->'choices' else '[]'::jsonb end) choice
    where menu.id = v_item.menu_item_id and menu.variant_options->>'type' = 'choices' and choice->>'key' = v_variant;
    if not found then v_choice_units := 1; end if;
  end if;

  select * into v_stock from public.stock where menu_item_id = v_item.menu_item_id and not is_archived for update;
  if found and not exists (select 1 from public.order_menu_stock_deductions where order_item_id = v_item.id) then
    v_amount := v_item.quantity * v_choice_units;
    if v_stock.quantity < v_amount then raise exception 'Insufficient stock for %', v_item.item_name; end if;
    update public.stock set quantity = quantity - v_amount where id = v_stock.id;
    if v_stock.quantity - v_amount <= 0 then
      update public.menu_items set is_available = false, unavailable_reason = 'out_of_stock' where id = v_item.menu_item_id;
    end if;
    insert into public.order_menu_stock_deductions(order_id, order_item_id, menu_item_id, quantity)
      values(v_order.id, v_item.id, v_item.menu_item_id, v_amount);
  end if;

  select exists (
    select 1 from public.finished_product_sale_mappings mapping
    join public.finished_products product on product.id = mapping.finished_product_id and not product.is_archived
    where mapping.menu_item_id = v_item.menu_item_id
      and (mapping.variant_key is not distinct from v_variant or (mapping.variant_key is null and not exists (
        select 1 from public.finished_product_sale_mappings exact_mapping where exact_mapping.menu_item_id = v_item.menu_item_id and exact_mapping.variant_key is not distinct from v_variant
      )))
  ) into v_has_product_mapping;

  if v_has_product_mapping then
    for v_mapping in select mapping.* from public.finished_product_sale_mappings mapping join public.finished_products product on product.id = mapping.finished_product_id and not product.is_archived where mapping.menu_item_id = v_item.menu_item_id and (mapping.variant_key is not distinct from v_variant or (mapping.variant_key is null and not exists (select 1 from public.finished_product_sale_mappings exact_mapping where exact_mapping.menu_item_id = v_item.menu_item_id and exact_mapping.variant_key is not distinct from v_variant))) loop
      if exists (select 1 from public.order_inventory_deductions where order_item_id = v_item.id and finished_product_id = v_mapping.finished_product_id) then continue; end if;
      v_amount := v_mapping.units_per_sale * v_item.quantity * v_choice_units;
      select quantity into v_current from public.finished_products where id = v_mapping.finished_product_id for update;
      if v_current < v_amount then raise exception 'Insufficient product stock for this order'; end if;
      update public.finished_products set quantity = quantity - v_amount, updated_at = now() where id = v_mapping.finished_product_id;
      insert into public.finished_product_movements(finished_product_id, order_id, order_item_id, movement_type, quantity, reason, created_by) values(v_mapping.finished_product_id, v_order.id, v_item.id, 'deduction', v_amount, 'Order stock deduction', auth.uid());
      insert into public.order_inventory_deductions(order_id, order_item_id, finished_product_id, quantity) values(v_order.id, v_item.id, v_mapping.finished_product_id, v_amount);
    end loop;
  else
    for v_recipe in select ingredient_id, quantity_per_serving from public.menu_item_ingredients where menu_item_id = v_item.menu_item_id loop
      if exists (select 1 from public.order_inventory_deductions where order_item_id = v_item.id and ingredient_id = v_recipe.ingredient_id) then continue; end if;
      v_amount := v_recipe.quantity_per_serving * v_item.quantity * v_choice_units;
      select quantity into v_current from public.inventory_stock where ingredient_id = v_recipe.ingredient_id for update;
      if v_current < v_amount then raise exception 'Insufficient ingredient stock for this order'; end if;
      update public.inventory_stock set quantity = quantity - v_amount, updated_at = now() where ingredient_id = v_recipe.ingredient_id;
      insert into public.inventory_movements(ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by) values(v_recipe.ingredient_id, v_order.id, v_item.id, 'deduction', v_amount, 'Order stock deduction', auth.uid());
      insert into public.order_inventory_deductions(order_id, order_item_id, ingredient_id, quantity) values(v_order.id, v_item.id, v_recipe.ingredient_id, v_amount);
    end loop;
  end if;
end;
$$;

create or replace function public.restore_order_inventory(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_deduction record; v_menu_deduction record;
begin
  for v_menu_deduction in select * from public.order_menu_stock_deductions where order_id = p_order_id and not reversed for update loop
    update public.stock set quantity = quantity + v_menu_deduction.quantity where menu_item_id = v_menu_deduction.menu_item_id and not is_archived;
    update public.menu_items set is_available = manual_available, unavailable_reason = case when manual_available then null else unavailable_reason end where id = v_menu_deduction.menu_item_id and not is_archived;
    update public.order_menu_stock_deductions set reversed = true where id = v_menu_deduction.id;
  end loop;
  for v_deduction in select * from public.order_inventory_deductions where order_id = p_order_id and not reversed for update loop
    if v_deduction.ingredient_id is not null then
      update public.inventory_stock set quantity = quantity + v_deduction.quantity, updated_at = now() where ingredient_id = v_deduction.ingredient_id;
      insert into public.inventory_movements(ingredient_id, order_id, order_item_id, movement_type, quantity, reason, created_by) values(v_deduction.ingredient_id, p_order_id, v_deduction.order_item_id, 'restock', v_deduction.quantity, 'Order stock restored', auth.uid());
    else
      update public.finished_products set quantity = quantity + v_deduction.quantity, updated_at = now() where id = v_deduction.finished_product_id;
      insert into public.finished_product_movements(finished_product_id, order_id, order_item_id, movement_type, quantity, reason, created_by) values(v_deduction.finished_product_id, p_order_id, v_deduction.order_item_id, 'restock', v_deduction.quantity, 'Order stock restored', auth.uid());
    end if;
    update public.order_inventory_deductions set reversed = true where id = v_deduction.id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
