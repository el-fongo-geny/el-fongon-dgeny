create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  public_id integer not null,
  customer_name text not null,
  customer_phone text not null,
  language text not null default 'es',
  payment_method text,
  status text not null default 'new',
  kitchen_done boolean not null default false,
  kitchen_hidden boolean not null default false,
  whatsapp_sent boolean not null default false,
  whatsapp_sent_at timestamptz,
  clover_synced boolean not null default false,
  clover_order_id text,
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_public_id_idx on public.orders (public_id);

create table if not exists public.product_availability (
  product_id text primary key,
  available boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.order_counter (
  id integer primary key default 1,
  current_value integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.order_counter (id, current_value)
values (1, 0)
on conflict (id) do nothing;


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


alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.product_availability;

-- Si dice "relation is already member of publication", no pasa nada: ya estaba activado.


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
