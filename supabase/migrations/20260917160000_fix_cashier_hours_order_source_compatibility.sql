-- HM POS can be installed with the compact walk-in orders schema, which does
-- not include the legacy customer-order column `order_source`. Trigger row
-- fields are resolved when the trigger runs, so directly reading
-- NEW.order_source fails at checkout on those installations.
--
-- Read optional legacy columns through to_jsonb(NEW) instead. cashier_id is
-- the canonical signal for HM POS walk-in orders and remains enforced.

create or replace function public.hm_pos_validate_cashier_operating_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_time time;
  v_open_time time;
  v_close_time time;
begin
  if coalesce(v_new->>'order_source', '') = 'cashier_pos'
     or nullif(v_new->>'cashier_id', '') is not null then
    v_time := (
      coalesce(nullif(v_new->>'created_at', '')::timestamptz, clock_timestamp())
      at time zone 'Asia/Manila'
    )::time;

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
