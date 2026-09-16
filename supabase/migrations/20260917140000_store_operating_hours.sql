-- Store open hours are managed from Admin > Settings > Store info.
-- The cashier UI, EOD reporting, and server-side order guard all read this
-- shared configuration. Times are daily Asia/Manila hours in HH:MM format.

insert into public.portal_configuration (scope, key, value, is_public)
values (
  'system',
  'store',
  '{"openTime":"06:00","closeTime":"22:00"}'::jsonb,
  true
)
on conflict (scope, key) do update
set value = jsonb_set(
              jsonb_set(
                coalesce(public.portal_configuration.value, '{}'::jsonb),
                '{openTime}',
                to_jsonb(coalesce(public.portal_configuration.value->>'openTime', '06:00'))
              ),
              '{closeTime}',
              to_jsonb(coalesce(public.portal_configuration.value->>'closeTime', '22:00'))
            ),
    is_public = true,
    updated_at = now();

create or replace function public.hm_pos_get_store_hours()
returns table(open_time time, close_time time)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  store_policy jsonb;
  configured_open text;
  configured_close text;
begin
  select value
    into store_policy
    from public.portal_configuration
   where scope = 'system'
     and key = 'store';

  configured_open := coalesce(store_policy->>'openTime', '06:00');
  configured_close := coalesce(store_policy->>'closeTime', '22:00');

  if configured_open !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
    configured_open := '06:00';
  end if;
  if configured_close !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
    configured_close := '22:00';
  end if;

  open_time := configured_open::time;
  close_time := configured_close::time;
  if close_time <= open_time then
    open_time := '06:00:00'::time;
    close_time := '22:00:00'::time;
  end if;
  return next;
end;
$$;

revoke all on function public.hm_pos_get_store_hours() from public, anon, authenticated;

create or replace function public.hm_pos_validate_cashier_operating_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_time time;
  v_open_time time;
  v_close_time time;
begin
  if coalesce(new.order_source, '') = 'cashier_pos' or new.cashier_id is not null then
    v_time := (coalesce(new.created_at, clock_timestamp()) at time zone 'Asia/Manila')::time;
    select open_time, close_time
      into v_open_time, v_close_time
      from public.hm_pos_get_store_hours();
    if v_time < v_open_time or v_time >= v_close_time then
      raise exception 'POS is currently closed. Operating hours are % – %.',
        to_char(v_open_time, 'HH12:MI AM'),
        to_char(v_close_time, 'HH12:MI AM');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hm_pos_validate_cashier_operating_hours_trigger on public.orders;
create trigger hm_pos_validate_cashier_operating_hours_trigger
before insert on public.orders
for each row
execute function public.hm_pos_validate_cashier_operating_hours();

-- Keep the RPC guard aligned with the trigger. This is the VAT-inclusive
-- cashier implementation from the preceding pricing migration with only the
-- operating-hours check made configuration-driven.
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
 v_open_time time; v_close_time time;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not public.hm_pos_is_staff() then raise exception 'Cashier access required'; end if;

 manila_now := clock_timestamp() at time zone 'Asia/Manila';
 select open_time, close_time
   into v_open_time, v_close_time
   from public.hm_pos_get_store_hours();
 if manila_now::time < v_open_time or manila_now::time >= v_close_time then
  raise exception 'POS is currently closed. Operating hours are % – %.',
    to_char(v_open_time, 'HH12:MI AM'),
    to_char(v_close_time, 'HH12:MI AM');
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

-- Keep the optional server-side EOD RPC on the same configured business-day
-- window and return the same labels shown in the cashier receipt.
create or replace function public.get_cashier_eod_summary(
  p_business_date date,
  p_cashier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_open_time time;
  v_close_time time;
  v_completed_count int := 0;
  v_voided_count int := 0;
  v_gross_sales numeric(12,2) := 0;
  v_discounts numeric(12,2) := 0;
  v_void_amount numeric(12,2) := 0;
  v_refund_amount numeric(12,2) := 0;
  v_net_sales numeric(12,2) := 0;
  v_total_collected numeric(12,2) := 0;
  v_cash_count int := 0;
  v_cash_amount numeric(12,2) := 0;
  v_gcash_count int := 0;
  v_gcash_amount numeric(12,2) := 0;
  v_bank_count int := 0;
  v_bank_amount numeric(12,2) := 0;
  v_other_count int := 0;
  v_other_amount numeric(12,2) := 0;
  v_cashier_name text := 'All Cashiers';
  rec record;
begin
  select open_time, close_time
    into v_open_time, v_close_time
    from public.hm_pos_get_store_hours();
  v_start := (p_business_date::text || ' ' || v_open_time::text || '+08')::timestamptz;
  v_end := (p_business_date::text || ' ' || v_close_time::text || '+08')::timestamptz;

  if p_cashier_id is not null then
    select coalesce(full_name, username, 'Cashier') into v_cashier_name
    from public.users
    where id = p_cashier_id;
  end if;

  for rec in
    select
      o.id,
      o.subtotal,
      o.discount_amount,
      o.final_total,
      o.is_voided,
      o.payment_status,
      o.payment_confirmed,
      t.method as payment_method
    from public.orders o
    left join lateral (
      select method from public.transactions where order_id = o.id order by created_at desc limit 1
    ) t on true
    where o.cashier_id is not null
      and o.created_at >= v_start
      and o.created_at <= v_end
      and (p_cashier_id is null or o.cashier_id = p_cashier_id)
  loop
    if coalesce(rec.is_voided, false) then
      v_voided_count := v_voided_count + 1;
      v_void_amount := v_void_amount + coalesce(rec.final_total, rec.subtotal, 0);
    elsif coalesce(rec.payment_status, '') = 'paid' or coalesce(rec.payment_confirmed, false) then
      v_completed_count := v_completed_count + 1;
      v_gross_sales := v_gross_sales + coalesce(rec.subtotal, 0);
      v_discounts := v_discounts + coalesce(rec.discount_amount, 0);
      v_net_sales := v_net_sales + coalesce(rec.final_total, 0);
      v_total_collected := v_total_collected + coalesce(rec.final_total, 0);

      if lower(coalesce(rec.payment_method, 'cash')) = 'cash' then
        v_cash_count := v_cash_count + 1;
        v_cash_amount := v_cash_amount + coalesce(rec.final_total, 0);
      elsif lower(coalesce(rec.payment_method, '')) = 'gcash' then
        v_gcash_count := v_gcash_count + 1;
        v_gcash_amount := v_gcash_amount + coalesce(rec.final_total, 0);
      elsif lower(coalesce(rec.payment_method, '')) in ('bank_transfer', 'bank') then
        v_bank_count := v_bank_count + 1;
        v_bank_amount := v_bank_amount + coalesce(rec.final_total, 0);
      else
        v_other_count := v_other_count + 1;
        v_other_amount := v_other_amount + coalesce(rec.final_total, 0);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'business_date', p_business_date::text,
    'opening_time', to_char(v_open_time, 'HH12:MI AM'),
    'closing_time', to_char(v_close_time, 'HH12:MI AM'),
    'cashier_name', v_cashier_name,
    'completed_transactions', v_completed_count,
    'voided_transactions', v_voided_count,
    'gross_sales', round(v_gross_sales, 2),
    'discounts', round(v_discounts, 2),
    'refunds_and_voids', round(v_void_amount + v_refund_amount, 2),
    'void_amount', round(v_void_amount, 2),
    'refund_amount', round(v_refund_amount, 2),
    'net_sales', round(v_net_sales, 2),
    'total_collected', round(v_total_collected, 2),
    'payment_breakdown', jsonb_build_object(
      'cash', jsonb_build_object('count', v_cash_count, 'amount', round(v_cash_amount, 2)),
      'gcash', jsonb_build_object('count', v_gcash_count, 'amount', round(v_gcash_amount, 2)),
      'bank_transfer', jsonb_build_object('count', v_bank_count, 'amount', round(v_bank_amount, 2)),
      'other', jsonb_build_object('count', v_other_count, 'amount', round(v_other_amount, 2))
    ),
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_cashier_eod_summary(date, uuid) from public, anon, authenticated;
grant execute on function public.get_cashier_eod_summary(date, uuid) to authenticated;

notify pgrst, 'reload schema';
