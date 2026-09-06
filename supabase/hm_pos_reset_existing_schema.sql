-- HM POS · destructive reset for the previous installer
--
-- USE ONLY when you want to rebuild the HM POS database from scratch.
-- This permanently deletes the previous HM POS tables and their data.
-- It does not delete auth.users, so Supabase login accounts remain.
--
-- Run this file first in Supabase SQL Editor, then run:
--   supabase/hm_pos_schema.sql

begin;

-- Remove functions/triggers from the previous HM POS schema. The name filter
-- is intentionally limited to HM POS helper/RPC prefixes.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'hm_pos_%'
        or p.proname like 'staff_%'
        or p.proname like 'admin_%'
        or p.proname in (
          'normalize_role',
          'is_staff_profile',
          'create_cashier_order',
          'queue_order_email',
          'submit_benefit_application',
          'review_benefit_application',
          'deduct_order_item_inventory'
        )
      )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', fn.schema_name, fn.function_name, fn.arguments);
  end loop;
end;
$$;

-- Remove every table created by the earlier HM POS installer. CASCADE clears
-- the old foreign keys, policies, and triggers before the clean bootstrap.
drop table if exists public.order_inventory_deductions cascade;
drop table if exists public.finished_product_sale_mappings cascade;
drop table if exists public.supply_movements cascade;
drop table if exists public.finished_product_movements cascade;
drop table if exists public.inventory_movements cascade;
drop table if exists public.finished_products cascade;
drop table if exists public.supplies cascade;
drop table if exists public.inventory_stock cascade;
drop table if exists public.ingredients cascade;
drop table if exists public.menu_item_ingredients cascade;
drop table if exists public.benefit_application_events cascade;
drop table if exists public.benefit_applications cascade;
drop table if exists public.customer_email_otps cascade;
drop table if exists public.customer_otp_rate_limits cascade;
drop table if exists public.customer_messages cascade;
drop table if exists public.delivery_areas cascade;
drop table if exists public.site_testimonials cascade;
drop table if exists public.menu_item_supplies cascade;
drop table if exists public.payments cascade;
drop table if exists public.refunds cascade;
drop table if exists public.transaction_audit_log cascade;
drop table if exists public.order_cancellations cascade;
drop table if exists public.order_email_outbox cascade;
drop table if exists public.transactions cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.stock cascade;
drop table if exists public.addons cascade;
drop table if exists public.menu_items cascade;
drop table if exists public.subcategories cascade;
drop table if exists public.main_categories cascade;
drop table if exists public.menu_change_approvals cascade;
drop table if exists public.staff_preferences cascade;
drop table if exists public.portal_audit_events cascade;
drop table if exists public.portal_configuration cascade;
drop table if exists public.users cascade;
drop table if exists public.profiles cascade;

drop sequence if exists public.hm_pos_order_sequence cascade;
drop sequence if exists public.hm_pos_receipt_sequence cascade;

-- Storage objects cannot be deleted directly through SQL in Supabase.
-- If these old buckets exist, remove them from Dashboard > Storage after
-- this reset succeeds. The clean HM POS schema only uses menu-images and
-- portal-assets.

commit;

-- After this file succeeds, run hm_pos_schema.sql.
