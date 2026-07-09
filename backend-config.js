/*
  backend-config.js
  El Fogón D' Geny

  Esta versión funciona directamente con Supabase desde GitHub Pages.
  Por eso BACKEND_URL queda vacío.

  Luego, cuando creemos Edge Functions o un backend público para WhatsApp/Clover,
  puedes poner aquí esa URL pública. No uses localhost en producción.
*/
(function () {
  "use strict";

  const BACKEND_URL = "";

  window.FOGON_BACKEND_URL = BACKEND_URL;
  window.FOGON_CONFIG = window.FOGON_CONFIG || {
    appName: "El Fogón D' Geny",
    version: "v17-supabase-direct",
    features: {
      requireCustomerPhone: true,
      localFallback: true,
      supabaseDirect: true
    }
  };
})();
