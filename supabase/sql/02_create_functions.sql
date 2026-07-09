create or replace function public.next_order_public_id()
returns integer
language plpgsql
security definer
as $$
declare
  next_id integer;
begin
  update public.order_counter
  set current_value = case
    when current_value >= 999 then 1
    else current_value + 1
  end,
  updated_at = now()
  where id = 1
  returning current_value into next_id;

  return next_id;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists set_product_availability_updated_at on public.product_availability;
create trigger set_product_availability_updated_at
before update on public.product_availability
for each row
execute function public.set_updated_at();
