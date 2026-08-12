-- El Fogón D' Geny
--
-- IMPORTANTE:
-- Este archivo histórico ya no intenta recrear la base de producción, porque
-- el proyecto actual contiene muchas más tablas, RPC, índices y políticas que
-- el esquema inicial. Ejecutar aquel archivo abría INSERT/UPDATE/DELETE a anon.
--
-- Para obtener el esquema real y todos los datos usa:
--   scripts/backup-supabase.ps1   (Windows)
--   scripts/backup-supabase.sh    (macOS/Linux)
--
-- Para aplicar las correcciones actuales ejecuta, una sola vez y completo:
--   supabase/migrations/20260812173000_v105_security_consistency.sql
--
-- El bloque siguiente es únicamente un guardarraíl idempotente. Mantiene
-- V104.8B cerrado y corrige el permiso interno de next_order_public_id().

begin;

revoke insert, update, delete on table public.orders from anon, authenticated;
revoke insert, update, delete on table public.product_availability from anon, authenticated;
revoke all on table public.order_counter from anon, authenticated;

grant select, insert, update, delete on table public.orders to service_role;
grant select, insert, update, delete on table public.product_availability to service_role;
grant select, update on table public.order_counter to service_role;

revoke execute on function public.next_order_public_id()
  from public, anon, authenticated;
grant execute on function public.next_order_public_id() to service_role;

alter table public.orders enable row level security;
alter table public.product_availability enable row level security;
alter table public.order_counter enable row level security;

drop policy if exists "orders_insert" on public.orders;
drop policy if exists "orders_update" on public.orders;
drop policy if exists "orders_delete" on public.orders;
drop policy if exists "availability_insert" on public.product_availability;
drop policy if exists "availability_update" on public.product_availability;
drop policy if exists "counter_select" on public.order_counter;
drop policy if exists "counter_update" on public.order_counter;

commit;
