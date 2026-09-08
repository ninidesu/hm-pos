-- HM POS one-time data reset.
-- Run manually in the Supabase SQL Editor as a database owner/service role.
-- This clears walk-in transaction records and resets all tracked stock to 50.

begin;

-- Remove records that point at orders before deleting the orders themselves.
-- Some older deployments do not include the optional email, cancellation,
-- refund, audit, or inventory-tracking tables. Delete from those tables only
-- when they exist so this reset can run against either schema version.
do $$
declare
  table_name text;
  order_scoped_tables constant text[] := array[
    'inventory_movements',
    'finished_product_movements',
    'supply_movements'
  ];
begin
  foreach table_name in array array[
    'order_email_outbox',
    'order_cancellations',
    'refunds',
    'transaction_audit_log',
    'order_menu_stock_deductions',
    'order_inventory_deductions'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('delete from public.%I', table_name);
    end if;
  end loop;

  foreach table_name in array order_scoped_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('delete from public.%I where order_id is not null', table_name);
    end if;
  end loop;
end;
$$;

delete from public.transactions;
delete from public.payments;
delete from public.order_items;
delete from public.orders;

-- Reset every stock source used by the POS and inventory area.
update public.stock
set quantity = 50, updated_at = now();

update public.inventory_stock
set quantity = 50, updated_at = now();

update public.finished_products
set quantity = 50, updated_at = now();

update public.supplies
set quantity = 50, updated_at = now();

-- A previous zero-stock deduction can leave a menu item unavailable.
update public.menu_items
set is_available = manual_available,
    unavailable_reason = case when manual_available then null else unavailable_reason end,
    updated_at = now()
where unavailable_reason = 'out_of_stock';

commit;
