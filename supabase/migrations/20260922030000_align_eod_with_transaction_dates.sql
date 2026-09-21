-- Align EOD reporting with the calendar date shown in Transaction History.
-- Operating-hour enforcement still prevents new cashier sales outside 06:00-22:00;
-- the report includes any historical/auditable records that already exist that day.

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
  v_start timestamptz := (p_business_date::text || ' 00:00:00+08')::timestamptz;
  v_end timestamptz := ((p_business_date + 1)::text || ' 00:00:00+08')::timestamptz;
  v_completed_count int := 0;
  v_voided_count int := 0;
  v_gross_sales numeric(12,2) := 0;
  v_discounts numeric(12,2) := 0;
  v_void_amount numeric(12,2) := 0;
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
  if p_business_date > (clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Future dates cannot have an End of Day summary.';
  end if;

  if p_cashier_id is not null then
    select coalesce(full_name, username, 'Cashier') into v_cashier_name
    from public.users where id = p_cashier_id;
  end if;

  for rec in
    select o.subtotal, o.discount_amount, o.final_total, o.is_voided,
           o.payment_status, o.payment_confirmed, t.method as payment_method
    from public.orders o
    left join lateral (
      select method from public.transactions
      where order_id = o.id order by created_at desc limit 1
    ) t on true
    where o.cashier_id is not null
      and o.created_at >= v_start
      and o.created_at < v_end
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
      case lower(coalesce(rec.payment_method, 'cash'))
        when 'cash' then v_cash_count := v_cash_count + 1; v_cash_amount := v_cash_amount + coalesce(rec.final_total, 0);
        when 'gcash' then v_gcash_count := v_gcash_count + 1; v_gcash_amount := v_gcash_amount + coalesce(rec.final_total, 0);
        when 'bank_transfer' then v_bank_count := v_bank_count + 1; v_bank_amount := v_bank_amount + coalesce(rec.final_total, 0);
        when 'bank' then v_bank_count := v_bank_count + 1; v_bank_amount := v_bank_amount + coalesce(rec.final_total, 0);
        else v_other_count := v_other_count + 1; v_other_amount := v_other_amount + coalesce(rec.final_total, 0);
      end case;
    end if;
  end loop;

  return jsonb_build_object(
    'business_date', p_business_date::text,
    'opening_time', '6:00 AM', 'closing_time', '10:00 PM',
    'cashier_name', v_cashier_name,
    'completed_transactions', v_completed_count,
    'voided_transactions', v_voided_count,
    'gross_sales', round(v_gross_sales, 2),
    'discounts', round(v_discounts, 2),
    'refunds_and_voids', round(v_void_amount, 2),
    'void_amount', round(v_void_amount, 2), 'refund_amount', 0,
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

revoke all on function public.get_cashier_eod_summary(date, uuid) from public;
grant execute on function public.get_cashier_eod_summary(date, uuid) to authenticated;

notify pgrst, 'reload schema';
