-- Ejecuta esto una vez en Supabase SQL Editor.
-- Añade columnas que la Edge Function usa para marcar el pedido como listo/notificado.

alter table public.orders
  add column if not exists accepted_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists clover_synced_at timestamptz,
  add column if not exists notify_error text;

create index if not exists orders_ready_at_idx on public.orders (ready_at desc);
