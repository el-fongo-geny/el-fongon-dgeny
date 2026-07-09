-- Prueba rápida del contador. Debe devolver 1, luego 2, etc.
select public.next_order_public_id() as next_id;

-- Para reiniciar antes del primer pedido real:
-- update public.order_counter set current_value = 0, updated_at = now() where id = 1;
