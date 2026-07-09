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

  const SUPABASE_URL = "https://jjfxjfkomcjgmhjzhwmc.supabase.co/rest/v1/";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqZnhqZmtvbWNqZ21oanpod21jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDI4MzYsImV4cCI6MjA5OTExODgzNn0.IDw7xJrgxvvi1_u-hI8lybsw5sMNSQN1lNUreCLUvb0";

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
