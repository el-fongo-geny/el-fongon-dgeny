alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.product_availability;

-- Si dice "relation is already member of publication", no pasa nada: ya estaba activado.
