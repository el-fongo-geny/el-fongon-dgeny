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
