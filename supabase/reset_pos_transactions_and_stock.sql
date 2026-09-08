-- HM POS one-time cashier transaction reset.
-- Run manually in the Supabase SQL Editor as a database owner/service role.
-- Only cashier POS transactions are removed. Stock quantities, menu items,
-- users, and inventory master data are intentionally left unchanged.

begin;

-- A cashier_id is required to safely identify cashier-created orders in both
-- the current schema and older deployments without order_source.
do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'public.orders does not exist';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'orders'
      and c.column_name = 'cashier_id'
  ) then
    raise exception 'public.orders.cashier_id does not exist; no rows were deleted';
  end if;
end;
$$;

-- Capture only cashier-created orders before removing their dependent records.
-- Newer schema: order_source = cashier_pos.
-- Older schema: customer orders have customer_id, while cashier orders have
-- cashier_id and no customer_id. If neither discriminator exists, cashier_id
-- is the legacy signal used by the original cashier-only orders table.
create temporary table hm_pos_cashier_reset_orders on commit drop as
with order_rows as (
  select o.id, to_jsonb(o) as row_data
  from public.orders o
)
select id
from order_rows
where case
  when nullif(row_data ->> 'order_source', '') is not null then
    row_data ->> 'order_source' = 'cashier_pos'
  when row_data ? 'customer_id' then
    nullif(row_data ->> 'customer_id', '') is null
    and nullif(row_data ->> 'cashier_id', '') is not null
  else
    nullif(row_data ->> 'cashier_id', '') is not null
end;

-- Delete only dependent rows for the captured cashier orders. Each delete is
-- guarded so missing optional tables/columns are safely skipped.
do $$
begin
  if to_regclass('public.order_email_outbox') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_email_outbox' and column_name = 'order_id') then
    execute 'delete from public.order_email_outbox as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.order_cancellations') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_cancellations' and column_name = 'order_id') then
    execute 'delete from public.order_cancellations as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.refunds') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'refunds' and column_name = 'order_id') then
    execute 'delete from public.refunds as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.transaction_audit_log') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transaction_audit_log' and column_name = 'order_id') then
    execute 'delete from public.transaction_audit_log as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.order_menu_stock_deductions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_menu_stock_deductions' and column_name = 'order_id') then
    execute 'delete from public.order_menu_stock_deductions as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.order_inventory_deductions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_inventory_deductions' and column_name = 'order_id') then
    execute 'delete from public.order_inventory_deductions as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.inventory_movements') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'order_id') then
    execute 'delete from public.inventory_movements as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.finished_product_movements') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finished_product_movements' and column_name = 'order_id') then
    execute 'delete from public.finished_product_movements as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.supply_movements') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supply_movements' and column_name = 'order_id') then
    execute 'delete from public.supply_movements as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.payments') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'order_id') then
    execute 'delete from public.payments as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.transactions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transactions' and column_name = 'order_id') then
    execute 'delete from public.transactions as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.order_items') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'order_id') then
    execute 'delete from public.order_items as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;

  if to_regclass('public.order_feedback') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_feedback' and column_name = 'order_id') then
    execute 'delete from public.order_feedback as t using pg_temp.hm_pos_cashier_reset_orders as r where t.order_id = r.id';
  end if;
end;
$$;

-- Remove only the captured cashier orders. No stock or menu tables are touched.
delete from public.orders as o
using pg_temp.hm_pos_cashier_reset_orders as r
where o.id = r.id;

commit;