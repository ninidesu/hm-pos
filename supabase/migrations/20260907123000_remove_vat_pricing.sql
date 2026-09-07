-- Remove VAT from the active pricing policy and from historical order metadata.
-- Monetary totals are intentionally preserved: menu prices and saved totals are
-- already the amounts charged to customers, so this migration only removes VAT
-- treatment and VAT-only metadata.

insert into public.portal_configuration (scope, key, value, is_public)
values (
  'system',
  'pricing',
  '{"vatRate":0,"pricesIncludeVat":false,"currency":"PHP","version":2}'::jsonb,
  true
)
on conflict (scope, key) do update
set value = coalesce(portal_configuration.value, '{}'::jsonb) ||
            '{"vatRate":0,"pricesIncludeVat":false,"currency":"PHP","version":2}'::jsonb,
    is_public = true,
    updated_at = now();

alter table public.orders
  alter column vat_rate set default 0;

alter table public.orders
  alter column prices_include_vat set default false;

update public.orders
   set vat_rate = 0,
       prices_include_vat = false,
       vat_exempt_amount = 0;

update public.order_items
   set vat_exempt_amount = 0;

create or replace function public.apply_global_pricing_policy_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.vat_rate := 0;
  new.prices_include_vat := false;
  return new;
end;
$$;

-- Benefit discounts remain available, but no longer remove VAT before applying
-- the 20% discount.
create or replace function public.create_customer_order_with_benefit_discount(request_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb; order_id uuid; benefit_kind text; target_item uuid; target_unit numeric(12,2); base_price numeric(12,2); discount numeric(12,2); savings numeric(12,2); order_row public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce((request_payload->>'apply_benefit_discount')::boolean,false) then
    select kind into benefit_kind from public.benefit_applications where customer_id=auth.uid() and status='approved' limit 1;
    if not found then raise exception 'Senior Citizen/PWD verification is not approved'; end if;
  end if;
  result:=public.create_customer_order(request_payload-'apply_benefit_discount');
  if not coalesce((request_payload->>'apply_benefit_discount')::boolean,false) then return result; end if;
  order_id:=(result->>'id')::uuid;
  select * into order_row from public.orders where id=order_id for update;
  if coalesce(order_row.discount_amount,0)>0 then return result; end if;
  select oi.id,oi.unit_price into target_item,target_unit from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=order_id and mi.online_benefit_eligible order by oi.unit_price desc,oi.id limit 1;
  if target_item is null then raise exception 'No eligible item in this order'; end if;
  base_price:=round(target_unit,2);
  discount:=round(base_price*0.20,2);
  savings:=discount;
  update public.order_items set line_total=line_total-savings,is_discounted=true,discount_amount=discount where id=target_item;
  update public.orders set discount_type=case when benefit_kind='pwd' then 'PWD' else 'Senior' end,discount_customer_name=order_row.customer_name,discount_subtotal=base_price,discount_amount=discount,final_total=order_row.final_total-savings,updated_at=now() where id=order_id;
  update public.payments p set amount_due=p.amount_due-savings where p.order_id=order_id;
  return result||jsonb_build_object('discount_amount',discount,'total',order_row.final_total-savings);
end; $$;

notify pgrst, 'reload schema';
