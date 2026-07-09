El Fogón D' Geny - v17 Supabase Direct + GitHub Pages

QUÉ HACE ESTA VERSIÓN
- Menú público en index.html.
- Panel iPad/admin/cocina/disponibilidad en admin.html.
- Conexión directa a Supabase desde GitHub Pages usando supabase-config.js y supabase-client.js.
- Pedidos en Supabase: tabla orders.
- Disponibilidad en Supabase: tabla product_availability.
- Contador 1-999 en Supabase: función next_order_public_id().
- Teléfono obligatorio para enviar pedido.
- PIN del panel: 5425.

ANTES DE SUBIR A GITHUB
1. Abre supabase-config.js.
2. Cambia:
   const SUPABASE_URL = "PEGA_AQUI_TU_SUPABASE_API_URL";
   const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_SUPABASE_ANON_PUBLIC_KEY";
3. Pega tu API URL y tu anon public key de Supabase.

NO PEGUES NUNCA
- service_role key
- database password
- token de WhatsApp
- token de Clover

QUÉ SUBIR A GITHUB
Sube el contenido de esta carpeta, no el ZIP.
Incluye:
- index.html
- admin.html
- style.css
- menu-data.js
- app.js
- admin.js
- supabase-config.js
- supabase-client.js
- backend-config.js
- assets/images/ con tus PNG

IMÁGENES
La carpeta assets/images/ está vacía. Mete ahí todas las imágenes PNG del menú con los nombres de IMAGE_NAMES.txt.

IMPORTANTE SOBRE WHATSAPP Y CLOVER
Esta versión ya sincroniza pedidos/disponibilidad con Supabase.
WhatsApp automático y Clover automático todavía necesitan Edge Functions o backend público. Por ahora, el botón de WhatsApp puede abrir WhatsApp manualmente si no hay backend público.

SQL
La carpeta supabase/sql incluye los scripts correctos para las tablas orders, product_availability y order_counter.
No uses el schema.sql viejo que creaba fogon_orders/fogon_availability.
