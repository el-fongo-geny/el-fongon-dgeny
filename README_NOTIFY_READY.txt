El Fogon D' Geny - Edge Function notify-order-ready

Archivos incluidos:
- supabase/functions/notify-order-ready/index.ts
- supabase/functions/.env.example
- supabase/sql/06_notify_order_ready_columns.sql
- admin.js
- .gitignore

Orden:
1. Ejecuta supabase/sql/06_notify_order_ready_columns.sql en Supabase SQL Editor.
2. Copia supabase/functions/.env.example como supabase/functions/.env y rellena claves solo en local.
3. Sube Secrets en Supabase Dashboard o con CLI.
4. Despliega la función: supabase functions deploy notify-order-ready
5. Reemplaza admin.js en GitHub con el admin.js incluido.

No subas supabase/functions/.env a GitHub.
