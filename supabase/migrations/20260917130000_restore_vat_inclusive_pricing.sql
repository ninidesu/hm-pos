-- Restore the store-wide 12% VAT-inclusive pricing policy.
-- Existing menu prices and charged totals are already customer-facing amounts,
-- so historical monetary values are preserved while their VAT metadata is
-- restored for reporting and receipt breakdowns.

insert into public.portal_configuration (scope, key, value, is_public)
values (
  'system',
  'pricing',
  '{"vatRate":0.12,"pricesIncludeVat":true,"currency":"PHP","version":3}'::jsonb,
  true
)
on conflict (scope, key) do update
set value = '{"vatRate":0.12,"pricesIncludeVat":true,"currency":"PHP","version":3}'::jsonb,
    is_public = true,
    updated_at = now();

alter table public.orders
  alter column vat_rate set default 0.12;

alter table public.orders
  alter column prices_include_vat set default true;

update public.orders
   set vat_rate = 0.12,
       prices_include_vat = true;

create or replace function public.apply_global_pricing_policy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pricing_policy jsonb;
  policy_rate numeric;
begin
  select value
    into pricing_policy
    from public.portal_configuration
   where scope = 'system'
     and key = 'pricing';

  policy_rate := coalesce((pricing_policy ->> 'vatRate')::numeric, 0.12);
  if policy_rate <= 0 or policy_rate > 1 then policy_rate := 0.12; end if;
  new.vat_rate := policy_rate;
  new.prices_include_vat := true;
  return new;
end;
$$;

drop trigger if exists order_pricing_policy_snapshot on public.orders;
create trigger order_pricing_policy_snapshot
before insert on public.orders
for each row
execute function public.apply_global_pricing_policy_snapshot();

-- Keep approved customer PWD/Senior checkout aligned with VAT-inclusive prices:
-- remove the VAT portion first, then apply the 20% benefit to the VAT-exclusive
-- base. The final total is reduced by both the removed VAT and the discount.
create or replace function public.create_customer_order_with_benefit_discount(request_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
  order_id uuid;
  benefit_kind text;
  target_item uuid;
  target_unit numeric(12,2);
  target_quantity integer;
  base_price numeric(12,2);
  vat_exempt numeric(12,2);
  discount numeric(12,2);
  savings numeric(12,2);
  order_row public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce((request_payload->>'apply_benefit_discount')::boolean,false) then
    select kind into benefit_kind
      from public.benefit_applications
     where customer_id=auth.uid() and status='approved'
     limit 1;
    if not found then raise exception 'Senior Citizen/PWD verification is not approved'; end if;
  end if;

  result:=public.create_customer_order(request_payload-'apply_benefit_discount');
  if not coalesce((request_payload->>'apply_benefit_discount')::boolean,false) then return result; end if;

  order_id:=(result->>'id')::uuid;
  select * into order_row from public.orders where id=order_id for update;
  if coalesce(order_row.discount_amount,0)>0 then return result; end if;

  select oi.id,oi.unit_price,oi.quantity
    into target_item,target_unit,target_quantity
    from public.order_items oi
    join public.menu_items mi on mi.id=oi.menu_item_id
   where oi.order_id=order_id and mi.online_benefit_eligible
   order by oi.unit_price desc,oi.id
   limit 1;
  if target_item is null then raise exception 'No eligible item in this order'; end if;

  target_unit:=round(target_unit*greatest(target_quantity,1),2);
  base_price:=round(target_unit/1.12,2);
  vat_exempt:=round(target_unit-base_price,2);
  discount:=round(base_price*0.20,2);
  savings:=round(vat_exempt+discount,2);

  update public.order_items
     set line_total=line_total-savings,
         is_discounted=true,
         discount_amount=discount,
         vat_exempt_amount=vat_exempt
   where id=target_item;

  update public.orders
     set discount_type=case when benefit_kind='pwd' then 'PWD' else 'Senior' end,
         discount_customer_name=order_row.customer_name,
         discount_subtotal=target_unit,
         discount_amount=discount,
         vat_exempt_amount=vat_exempt,
         vat_rate=0.12,
         prices_include_vat=true,
         final_total=order_row.final_total-savings,
         updated_at=now()
   where id=order_id;

  update public.payments p set amount_due=p.amount_due-savings where p.order_id=order_id;
  return result||jsonb_build_object(
    'discount_amount',discount,
    'vat_exempt_amount',vat_exempt,
    'total',order_row.final_total-savings
  );
end; $$;

-- Cashier POS checkout. Menu prices are VAT-inclusive; server-side pricing is
-- authoritative so the browser cannot bypass the VAT or benefit calculation.
create or replace function public.create_cashier_order_internal(request_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $cashier_body$
declare
 o jsonb:=coalesce(request_payload->'order','{}'); p jsonb:=coalesce(request_payload->'payment','{}'); i jsonb; m public.menu_items%rowtype; choice jsonb;
 oid uuid:=gen_random_uuid(); ono text:='WI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 q integer; total_q integer:=0; base numeric(12,2); adds numeric(12,2); unit numeric(12,2); line numeric(12,2); sub numeric(12,2):=0; discounted_sub numeric(12,2):=0;
 dtype text:=nullif(btrim(o->>'discount_type'),''); discount numeric(12,2):=0; vat_exempt numeric(12,2):=0; grand numeric(12,2);
 method text:=lower(btrim(coalesce(p->>'method',''))); received numeric(12,2); change_due numeric(12,2);
 requested_addons integer; valid_addons integer; temperature text; variant text; is_discounted boolean;
 item_base_total numeric(12,2); item_discount numeric(12,2); item_vat_exempt numeric(12,2);
 pricing_policy jsonb; vat_rate numeric(12,6):=0.12;
 manila_now timestamp with time zone;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not public.hm_pos_is_staff() then raise exception 'Cashier access required'; end if;

 manila_now := clock_timestamp() at time zone 'Asia/Manila';
 if manila_now::time < '06:00:00'::time or manila_now::time >= '22:00:00'::time then
  raise exception 'POS is currently closed. Operating hours are 6:00 AM – 10:00 PM.';
 end if;

 select value into pricing_policy from public.portal_configuration where scope='system' and key='pricing';
 vat_rate:=coalesce((pricing_policy->>'vatRate')::numeric,0.12);
 if vat_rate<=0 or vat_rate>1 then vat_rate:=0.12; end if;

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
  vat_exempt:=round(discounted_sub-(discounted_sub/(1+vat_rate)),2);
  discount:=round((discounted_sub/(1+vat_rate))*0.20,2);
 end if;
 grand:=round(sub-vat_exempt-discount,2);

 if method not in ('cash','gcash','bank_transfer') then raise exception 'Unsupported payment method'; end if;
 if method='cash' then
  received:=coalesce((p->>'amount_received')::numeric,0); if received<grand then raise exception 'Cash received is less than the total'; end if; change_due:=received-grand;
 elsif method='gcash' then
  if coalesce(p->>'reference_number','') !~ '^[0-9]{13}$' then raise exception 'GCash reference number must be exactly 13 digits'; end if; received:=grand; change_due:=0;
 else
  if nullif(btrim(p->>'bank_name'),'') is null then raise exception 'Bank name is required'; end if;
  if coalesce(p->>'reference_number','') !~ '^[A-Za-z0-9-]{6,30}$' then raise exception 'Bank reference must be 6 to 30 letters, numbers, or hyphens'; end if; received:=grand; change_due:=0;
 end if;

 insert into public.orders(id,order_number,order_sequence,order_source,cashier_id,order_type,status,customer_name,subtotal,discount_type,discount_customer_name,discount_id_number,discount_subtotal,discount_amount,vat_exempt_amount,final_total,vat_rate,prices_include_vat,payment_status,payment_confirmed)
 values(oid,ono,floor(extract(epoch from clock_timestamp()))::bigint,'cashier_pos',auth.uid(),'walk-in','Preparing',coalesce(nullif(btrim(o->>'customer_name'),''),'Walk-in Customer'),sub,dtype,nullif(btrim(o->>'discount_customer_name'),''),nullif(btrim(o->>'discount_id_number'),''),case when dtype is null then 0 else discounted_sub end,discount,vat_exempt,grand,vat_rate,true,'paid',true);

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
  item_base_total:=base*q;
  item_vat_exempt:=case when is_discounted then round(item_base_total-(item_base_total/(1+vat_rate)),2) else 0 end;
  item_discount:=case when is_discounted then round((item_base_total/(1+vat_rate))*0.20,2) else 0 end;
  insert into public.order_items(order_id,menu_item_id,item_name,unit_price,quantity,line_total,is_discounted,discount_amount,vat_exempt_amount,customizations,addons)
  values(oid,m.id,m.name,unit,q,line,is_discounted,item_discount,item_vat_exempt,coalesce(i->'customizations','{}'),coalesce(i->'addons','[]'));
 end loop;

 insert into public.payments(order_id,method,amount_due,amount_received,change_amount,reference_number,account_number,bank_name,status,paid_at)
 values(oid,method,grand,received,change_due,nullif(p->>'reference_number',''),nullif(p->>'account_number',''),nullif(p->>'bank_name',''),'paid',now());
 return jsonb_build_object('id',oid,'order_number',ono,'subtotal',sub,'discount_amount',discount,'vat_exempt_amount',vat_exempt,'vat_rate',vat_rate,'prices_include_vat',true,'total',grand,'change_amount',change_due);
end;
$cashier_body$;

notify pgrst, 'reload schema';
