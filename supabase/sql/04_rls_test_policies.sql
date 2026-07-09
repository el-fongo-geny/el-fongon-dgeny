alter table public.orders enable row level security;
alter table public.product_availability enable row level security;
alter table public.order_counter enable row level security;

drop policy if exists "orders_select" on public.orders;
drop policy if exists "orders_insert" on public.orders;
drop policy if exists "orders_update" on public.orders;
drop policy if exists "orders_delete" on public.orders;

create policy "orders_select" on public.orders for select to anon using (true);
create policy "orders_insert" on public.orders for insert to anon with check (true);
create policy "orders_update" on public.orders for update to anon using (true) with check (true);
create policy "orders_delete" on public.orders for delete to anon using (true);

drop policy if exists "availability_select" on public.product_availability;
drop policy if exists "availability_insert" on public.product_availability;
drop policy if exists "availability_update" on public.product_availability;

create policy "availability_select" on public.product_availability for select to anon using (true);
create policy "availability_insert" on public.product_availability for insert to anon with check (true);
create policy "availability_update" on public.product_availability for update to anon using (true) with check (true);

drop policy if exists "counter_select" on public.order_counter;
drop policy if exists "counter_update" on public.order_counter;

create policy "counter_select" on public.order_counter for select to anon using (true);
create policy "counter_update" on public.order_counter for update to anon using (true) with check (true);
