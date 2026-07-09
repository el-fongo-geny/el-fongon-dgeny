/*
  supabase-config.js
  El Fogón D' Geny - Configuración pública de Supabase

  IMPORTANTE:
  - Este archivo SÍ puede ir en GitHub Pages.
  - Aquí SOLO va la URL del proyecto y la anon/public key.
  - NO pongas aquí service_role key.
  - NO pongas aquí database password.
  - NO pongas aquí tokens de WhatsApp.
  - NO pongas aquí tokens de Clover.
*/
(function () {
  "use strict";

  const SUPABASE_URL = "PEGA_AQUI_TU_SUPABASE_API_URL";
  const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_SUPABASE_ANON_PUBLIC_KEY";

  window.FOGON_SUPABASE = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    tables: {
      orders: "orders",
      availability: "product_availability",
      counter: "order_counter"
    },
    functions: {
      nextOrderId: "next_order_public_id"
    }
  };
})();
