El Fogón D' Geny — v18 Mobile Fixed

Qué corrige:
- En móvil, cada producto aparece en una sola fila, sin texto cortado por columnas estrechas.
- Se evita que las imágenes salgan gigantes si el layout se rompe.
- Se añade cache-busting en index.html y admin.html: style.css?v=18-mobile-fixed.
- Mantiene Supabase directo: pedidos, disponibilidad, cocina y contador 1-999.

Qué subir a GitHub:
1) Reemplaza en la raíz del repo estos archivos:
   - index.html
   - admin.html
   - style.css
   - app.js
   - admin.js
   - supabase-client.js
   - backend-config.js
   - menu-data.js
   - schema.sql
   - README_V18_MOBILE_FIXED.txt
   - .nojekyll

2) NO borres assets/images. Tus imágenes deben quedarse en:
   assets/images/

3) Antes de subir, revisa supabase-config.js.
   Si ya tienes tus claves reales en GitHub, NO lo reemplaces con el placeholder.
   Si lo reemplazas, vuelve a poner:
   const SUPABASE_URL = "https://tu-proyecto.supabase.co";
   const SUPABASE_ANON_KEY = "tu_anon_public_key";

4) Después de hacer Commit en GitHub, abre la web y recarga fuerte:
   Android/Chrome: menú de Chrome > recargar, o abre en pestaña incógnito.

Panel iPad:
/admin.html
PIN: 5425
