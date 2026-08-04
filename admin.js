(() => {
"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const fallbackStorage = new Map();

function safeLocalGet(key) {
  try {
    const value = window.localStorage.getItem(key);

    if (value !== null) {
      fallbackStorage.set(key, value);
    }

    return value;
  } catch (error) {
    console.warn("localStorage bloqueado; usando memoria temporal:", error);

    return fallbackStorage.has(key)
      ? fallbackStorage.get(key)
      : null;
  }
}

function safeLocalSet(key, value) {
  const cleanValue = String(value);
  fallbackStorage.set(key, cleanValue);

  try {
    window.localStorage.setItem(key, cleanValue);
    return true;
  } catch (error) {
    console.warn(
      "No se pudo escribir en localStorage; se conserva en memoria:",
      error
    );

    return false;
  }
}

function safeLocalRemove(key) {
  fallbackStorage.delete(key);

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("No se pudo borrar localStorage:", error);
  }
}

function safeSessionRemove(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.warn("sessionStorage bloqueado:", error);
  }
}

function showLoginRuntimeError(error) {
  const message =
    error?.message ||
    String(error || "Error desconocido");

  const errorBox = document.querySelector("#pinError");

  if (errorBox) {
    errorBox.hidden = false;
    errorBox.textContent = `Error del panel: ${message}`;
  }

  console.error("Error del administrador:", error);
}

window.FOGON_ADMIN_BUILD = "74-kitchen-order-type-no-minimize-button";

if (!window.CSS) window.CSS = {};
if (!window.CSS.escape) {
  window.CSS.escape = function (value) {
    return String(value).replace(/["\\]/g, "\\$&");
  };
}


const STORAGE_ORDERS = "fogon_orders";
const STORAGE_AVAILABILITY = "fogon_availability";
const STORAGE_KITCHEN_HIDDEN = "fogon_kitchen_hidden";
const STORAGE_ADMIN_THEME = "fogon_admin_theme";
const STORAGE_KITCHEN_SELECTED = "fogon_kitchen_selected";
const STORAGE_ADMIN_TRUSTED_SESSION = "fogon_admin_trusted_session_v1";
const ADMIN_TRUSTED_SESSION_MS = 8 * 60 * 60 * 1000;
/* El PIN no está escrito en el código público. */
let adminPinInMemory = "";

/*
  menu-data.js no se carga en esta página porque contiene la aplicación
  completa del menú público y colisiona con admin.js. Los nombres de
  productos para Disponibilidad se cargan después desde admin-catalog.
*/
let adminCatalogMenuItems = [];
let adminCatalogInventoryItems = [];
const BACKEND_URL = (window.FOGON_BACKEND_URL || "").replace(/\/$/, "");
const ORDER_MODE_MANUAL_KEY = "system:orders-manual";
const ORDER_MODE_OPEN_KEY = "system:orders-open";

const INVENTORY_ITEMS = [
  "Pollo guisar", "Pollo pica pollo", "Alitas", "Bistec", "Chuleta", "Orejita",
  "Patica", "Trompa", "Tilapia", "Chillo", "Camarones", "Res", "Cerdo",
  "Chicharron", "Pechuga de Pollo", "Salami", "Bacon", "Longaniza", "Pinguilin",
  "Rabito", "Platano verde", "Platano maduro", "Pepino", "Tomate", "Lechuga",
  "Repollo", "Papa", "Papas fritas", "Queso mexicano", "Queso dominicano",
  "Queso rayado", "Arroz", "Habichuela", "Gandules con coco", "Guandules",
  "Yuca", "Ketchup", "Mayonesa", "Yautia", "Envase para llevar con division",
  "Envase para llevar sin division", "Jamon", "Huevo", "Tocino", "Cebolla",
  "Pimientos", "Chabola", "Tamarindo", "Guanabana", "Aguacate", "Bacalao",
  "Limon", "Zapatero", "Lechoza", "Envase para Habichuela",
  "Envase de mayo-kepchut", "Vaso de jugo", "Envase de niño", "Envase de set",
  "Leche condensada", "Leche evaporada", "Plato de plastico para comer",
  "Cucharas desechables", "Envase redondo", "Hielo", "Envase de sancocho",
  "Envase para salsa pequeño", "Envase para salsa mediano", "Cafe dominicano",
  "Guante", "Servilleta", "Sorvete", "Vaso para cafe", "Sal", "Azucar",
  "Vinagre", "Sopita", "Aceite", "Aceite de oliva"
].map((name, index) => ({
  id: `inventory:${index + 1}:${name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
  es: name,
  en: name
}));

function getOrderMode() {
  const availability = getAvailability();
  const manual = availability[ORDER_MODE_MANUAL_KEY] === true;
  const open = availability[ORDER_MODE_OPEN_KEY] === true;
  return manual ? (open ? "open" : "closed") : "auto";
}

function renderOrderModeButton() {
  const button = $("#orderModeBtn");
  if (!button) return;
  const mode = getOrderMode();
  const labels = {
    auto: "Pedidos: AUTOMATICO (11:00-20:30)",
    open: "Pedidos: ABIERTO",
    closed: "Pedidos: CERRADO"
  };
  button.textContent = labels[mode];
  button.dataset.mode = mode;
  button.classList.toggle("is-open", mode === "open");
  button.classList.toggle("is-closed", mode === "closed");
}

async function setOrderMode(mode) {
  if (mode === "auto") {
    await setAvailability(ORDER_MODE_MANUAL_KEY, false);
    await setAvailability(ORDER_MODE_OPEN_KEY, false);
  } else {
    await setAvailability(ORDER_MODE_OPEN_KEY, mode === "open");
    await setAvailability(ORDER_MODE_MANUAL_KEY, true);
  }
  renderOrderModeButton();
}

async function cycleOrderMode() {
  const mode = getOrderMode();
  const next = mode === "auto" ? "open" : mode === "open" ? "closed" : "auto";
  await setOrderMode(next);
}

let availabilityQuery = "";
let alarmTimer = null;
let audioCtx = null;
let soundUnlocked = false;
let soundConfirmationPlayed = false;
let lastSoundUnlockAttemptAt = 0;
let lastNewOrderSignature = "";
let ordersRenderInitialized = false;
let knownOrderIds = new Set();
let lastOrdersRenderSignature = "";
const paymentActionLocks = new Set();
const expandedOrderIds = new Set();
let automaticCloverQueueRunning = false;
let automaticCloverQueueTimer = null;
const automaticCloverAttemptedAt = new Map();
const AUTOMATIC_CLOVER_RETRY_MS = 8000;

function applyAdminTheme() {
  const theme = safeLocalGet(STORAGE_ADMIN_THEME) || "dark";
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  document.body.classList.toggle("light-mode", !isDark);
  const btn = $("#adminThemeToggleBtn");
  if (btn) btn.textContent = isDark ? "Modo claro" : "Modo oscuro";
}

function toggleAdminTheme() {
  const isDark = document.body.classList.contains("dark-mode");
  safeLocalSet(STORAGE_ADMIN_THEME, isDark ? "light" : "dark");
  applyAdminTheme();
}

function safeParse(key, fallback) {
  try {
    return JSON.parse(safeLocalGet(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

function getOrders() {
  return safeParse(STORAGE_ORDERS, []);
}

function setOrders(orders) {
  safeLocalSet(STORAGE_ORDERS, JSON.stringify(orders));
}

function saveOrders(orders) {
  setOrders(orders);
  renderAll();
}


function getSupabaseFunctionConfig() {
  const cfg = window.FOGON_SUPABASE || {};
  const supabaseUrl = String(cfg.url || "").replace(/\/$/, "");
  const anonKey = String(cfg.anonKey || "").trim();
  if (!supabaseUrl || !anonKey) throw new Error("Faltan la URL o la anon key de Supabase en supabase-config.js.");
  return { supabaseUrl, anonKey };
}


function buildEdgeFunctionHeaders(anonKey) {
  const headers = {
    "Content-Type": "application/json",
    "apikey": anonKey
  };

  /*
    Las claves legacy anon son JWT y pueden enviarse como Bearer.
    Las claves nuevas sb_publishable_ no son JWT y NO deben enviarse
    dentro de Authorization.
  */
  const looksLikeJwt =
    anonKey.startsWith("eyJ") &&
    anonKey.split(".").length === 3;

  if (looksLikeJwt) {
    headers.Authorization = `Bearer ${anonKey}`;
  }

  return headers;
}

function adminLoginErrorMessage(error) {
  const status = Number(error?.status || 0);
  const payload = error?.payload || {};
  const code = String(payload?.error || "").trim();
  const detail = String(payload?.detail || error?.message || error || "").trim();

  if (status === 401 && code === "invalid_admin_pin") {
    return "PIN incorrecto. Confirma que coincide exactamente con el Secret ADMIN_PIN.";
  }

  if (code === "missing_admin_pin_secret") {
    return "Falta el Secret ADMIN_PIN dentro de Supabase.";
  }

  if (status === 404) {
    return "La función admin-auth no existe o todavía no está desplegada.";
  }

  if (/invalid jwt/i.test(detail)) {
    return "Supabase está bloqueando la función por JWT. Desactiva Verify JWT en admin-auth.";
  }

  if (/missing authorization header/i.test(detail)) {
    return "Verify JWT sigue activado en admin-auth. Debe estar desactivado.";
  }

  if (/failed to fetch|networkerror|load failed/i.test(detail)) {
    return "El navegador no pudo conectar con admin-auth. Revisa la URL de Supabase, el despliegue y CORS.";
  }

  return detail || "No se pudo validar el acceso.";
}

async function callAdminAuth(adminPin) {
  const { supabaseUrl, anonKey } = getSupabaseFunctionConfig();

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-auth`, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    headers: buildEdgeFunctionHeaders(anonKey),
    body: JSON.stringify({
      adminPin: String(adminPin || "").trim()
    })
  });

  const rawText = await response.text();
  let result = {};

  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    result = { detail: rawText };
  }

  if (!response.ok || !result?.ok) {
    const message = [
      `HTTP ${response.status}`,
      result?.error,
      result?.detail
    ].filter(Boolean).join(" · ");

    const error = new Error(message || "No se pudo validar el acceso.");
    error.status = response.status;
    error.payload = result;
    throw error;
  }

  return result;
}

async function callProtectedAdminFunction(functionName, payload = {}) {
  const { supabaseUrl, anonKey } = getSupabaseFunctionConfig();
  const response = await fetch(
    `${supabaseUrl}/functions/v1/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: buildEdgeFunctionHeaders(anonKey),
      body: JSON.stringify({
        ...payload,
        adminPin: getAdminPinOrThrow()
      })
    }
  );

  const rawText = await response.text();
  let result = {};

  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    result = { detail: rawText };
  }

  if (!response.ok || !result?.ok) {
    const message = [
      `HTTP ${response.status}`,
      result?.error,
      result?.detail,
      result?.message,
      result?.active_public_id
        ? `Clover ocupado con el pedido #${result.active_public_id}`
        : ""
    ].filter(Boolean).join(" · ");

    const error = new Error(message || "La operación fue rechazada.");
    error.status = response.status;
    error.payload = result;
    throw error;
  }

  return result;
}

async function callAdminCatalog(action, adminPin, extraBody = {}) {
  const { supabaseUrl, anonKey } = getSupabaseFunctionConfig();
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-catalog`, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    headers: buildEdgeFunctionHeaders(anonKey),
    body: JSON.stringify({ action, adminPin, ...extraBody })
  });
  const rawText = await response.text();
  let result = {};
  try { result = rawText ? JSON.parse(rawText) : {}; } catch (_) { result = { detail: rawText }; }
  if (!response.ok || !result?.ok) {
    const message = [`HTTP ${response.status}`, result?.error, result?.detail].filter(Boolean).join(" · ");
    const error = new Error(message || "Supabase rechazó la solicitud.");
    error.status = response.status;
    throw error;
  }
  return result;
}


async function loadAdminCatalogMenuItems() {
  try {
    const result = await callAdminCatalog(
      "list_catalog",
      getAdminPinOrThrow()
    );

    const products = Array.isArray(result?.catalog?.products)
      ? result.catalog.products
      : [];

    adminCatalogMenuItems = products
      .filter((product) => product && product.id)
      .map((product) => ({
        id: String(product.id),
        es: String(product.name_es || product.name_en || product.id),
        en: String(product.name_en || product.name_es || product.id)
      }));

    const inventory = Array.isArray(result?.catalog?.inventory)
      ? result.catalog.inventory
      : [];

    adminCatalogInventoryItems = inventory
      .filter((item) => item && item.id && item.active !== false)
      .map((item) => ({
        id: String(item.id).startsWith("inventory:")
          ? String(item.id)
          : `inventory:${String(item.id)}`,
        es: String(item.name_es || item.name_en || item.id),
        en: String(item.name_en || item.name_es || item.id),
        group: String(item.group_name || "Inventario"),
        sortOrder: Number(item.sort_order || 0)
      }));

    renderAvailability();
    return adminCatalogMenuItems;
  } catch (error) {
    /*
      El catálogo es secundario. Su fallo nunca debe cerrar ni impedir
      abrir Pedidos y Cocina.
    */
    console.warn(
      "No se pudieron cargar productos desde admin-catalog:",
      error
    );

    adminCatalogMenuItems = [];
    adminCatalogInventoryItems = [];
    renderAvailability();
    return [];
  }
}

async function validateAdminPin(pin) {
  const cleanPin = String(pin || "").trim();

  if (!cleanPin) {
    throw new Error("Escribe el PIN.");
  }

  /*
    El panel diario se autentica con una función independiente.
    No depende del catálogo ni de sus tablas para poder abrir.
  */
  await callAdminAuth(cleanPin);

  return cleanPin;
}

function getAdminPinOrThrow() {
  if (!adminPinInMemory) {
    throw new Error(
      "La sesión terminó. Introduce nuevamente el PIN del panel."
    );
  }

  return adminPinInMemory;
}

function readTrustedAdminSession() {
  let session = null;

  try {
    session = JSON.parse(
      safeLocalGet(STORAGE_ADMIN_TRUSTED_SESSION) || "null"
    );
  } catch (_) {
    session = null;
  }

  const pin = String(session?.pin || "").trim();
  const expiresAt = Number(session?.expiresAt || 0);

  if (!pin || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    safeLocalRemove(STORAGE_ADMIN_TRUSTED_SESSION);
    return null;
  }

  return {
    pin,
    expiresAt,
    createdAt: Number(session?.createdAt || 0)
  };
}

function saveTrustedAdminSession(pin) {
  const createdAt = Date.now();
  const expiresAt = createdAt + ADMIN_TRUSTED_SESSION_MS;

  safeLocalSet(
    STORAGE_ADMIN_TRUSTED_SESSION,
    JSON.stringify({
      pin: String(pin || "").trim(),
      createdAt,
      expiresAt
    })
  );

  return expiresAt;
}

function clearAdminSession({ forgetTrustedDevice = true } = {}) {
  adminPinInMemory = "";
  safeSessionRemove("fogon_admin_unlocked");

  if (forgetTrustedDevice) {
    safeLocalRemove(STORAGE_ADMIN_TRUSTED_SESSION);
  }
}

function showLoginPanel(message = "") {
  const login = $("#adminLogin");
  const panel = $("#adminPanel");
  const input = $("#pinInput");
  const error = $("#pinError");

  if (panel) {
    panel.hidden = true;
    panel.style.display = "none";
  }

  if (login) {
    login.hidden = false;
    login.style.display = "";
  }

  if (error) {
    error.hidden = !message;
    error.textContent = message;
  }

  if (input) {
    input.disabled = false;
    input.value = "";
    setTimeout(() => input.focus(), 0);
  }
}

function logoutAdmin(message = "") {
  stopAlarm();
  clearAdminSession({ forgetTrustedDevice: true });
  showLoginPanel(
    message || "Sesión cerrada. Introduce el PIN para volver a entrar."
  );
}

async function backendRequest(path, options = {}) {
  if (!BACKEND_URL) return null;
  const response = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) throw new Error(`Backend error ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

function orderFromBackend(row) {
  if (!row) return null;
  return {
    ...(row.raw || {}),
    id: String(row.public_id ?? row.id),
    databaseId: row.id || row.databaseId || null,
    createdAt: row.created_at || row.createdAt || row.raw?.createdAt || new Date().toISOString(),
    customer: row.customer || row.raw?.customer || {},
    items: row.items || row.raw?.items || [],
    totals: row.totals || row.raw?.totals || {},
    paymentMethod: row.payment_method || row.raw?.paymentMethod || "",
    paymentStatus: row.payment_status || row.raw?.paymentStatus || "pending",
    paymentStartedAt: row.payment_started_at || row.raw?.paymentStartedAt || null,
    paymentCompletedAt: row.payment_completed_at || row.raw?.paymentCompletedAt || null,
    paymentError: row.payment_error || row.raw?.paymentError || "",
    cloverPaymentId: row.clover_payment_id || row.raw?.cloverPaymentId || null,
    cloverExternalPaymentId: row.clover_external_payment_id || row.raw?.cloverExternalPaymentId || null,
    hiddenForAll: Boolean(row.hidden_for_all || row.raw?.hiddenForAll),
    hiddenAt: row.hidden_at || row.raw?.hiddenAt || null,
    orderType: row.order_type || row.raw?.orderType || (Array.isArray(row.items) && row.items[0]?.orderType) || "",
    status: row.status || row.raw?.status || "new",
    language: row.language || row.raw?.language || "es",
    acceptedAt: row.accepted_at || row.raw?.acceptedAt || null,
    readyAt: row.ready_at || row.raw?.readyAt || null,
    cloverOrderId: row.clover_order_id || row.raw?.cloverOrderId || null,
    whatsappSent: Boolean(row.whatsapp_sent || row.raw?.whatsappSent)
  };
}

async function syncOrdersFromBackend() {
  const db = window.FOGON_DB;

  async function applyOrdersIfChanged(nextOrders) {
    const currentOrders = getOrders();
    if (stableOrdersSignature(currentOrders) === stableOrdersSignature(nextOrders)) {
      updateElapsedLabels();
      updateAlarm();
      scheduleAutomaticCloverQueue(300);
      return false;
    }

    setOrders(nextOrders);
    renderOrders();
    renderKitchen();
    renderPayments();
    scheduleAutomaticCloverQueue(300);
    return true;
  }

  if (db?.isReady()) {
    try {
      const orders = await db.fetchOrders();
      await applyOrdersIfChanged(Array.isArray(orders) ? orders : []);
    } catch (error) {
      console.warn("No se pudieron sincronizar pedidos desde Supabase:", error);
    }
    return;
  }

  if (!BACKEND_URL) return;
  try {
    const data = await backendRequest("/api/orders");
    const orders = (data?.orders || []).map(orderFromBackend).filter(Boolean);
    await applyOrdersIfChanged(orders);
  } catch (error) {
    console.warn("No se pudieron sincronizar pedidos desde el backend:", error);
  }
}

async function syncAvailabilityFromBackend() {
  const db = window.FOGON_DB;

  if (db?.isReady()) {
    try {
      const availability = await db.fetchAvailability();
      safeLocalSet(STORAGE_AVAILABILITY, JSON.stringify(availability));
      renderAvailability();
      renderOrderModeButton();
    } catch (error) {
      console.warn("No se pudo sincronizar disponibilidad desde Supabase:", error);
    }
    return;
  }

  if (!BACKEND_URL) return;
  try {
    const data = await backendRequest("/api/availability");
    if (data?.availability) {
      safeLocalSet(STORAGE_AVAILABILITY, JSON.stringify(data.availability));
      renderAvailability();
    }
  } catch (error) {
    console.warn("No se pudo sincronizar disponibilidad desde el backend:", error);
  }
}

async function updateOrderStatusBackend(orderId, status, extra = {}) {
  const db = window.FOGON_DB;

  if (db?.isReady()) {
    await db.updateOrderStatus(orderId, status, extra);
    return;
  }

  if (!BACKEND_URL) return;
  await backendRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...extra })
  });
}

async function deleteOrderBackend(orderId) {
  const db = window.FOGON_DB;

  if (db?.isReady()) {
    await db.deleteOrder(orderId);
    return;
  }

  if (!BACKEND_URL) return;
  await backendRequest(`/api/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
}

function getAvailability() {
  return safeParse(STORAGE_AVAILABILITY, {});
}

async function setAvailability(itemId, available) {
  const availability = getAvailability();
  availability[itemId] = available;
  safeLocalSet(STORAGE_AVAILABILITY, JSON.stringify(availability));
  renderAvailability();

  const db = window.FOGON_DB;
  if (db?.isReady()) {
    try {
      await db.setAvailability(itemId, available);
    } catch (error) {
      console.warn("No se pudo guardar disponibilidad en Supabase:", error);
    }
    return;
  }

  if (BACKEND_URL) {
    try {
      await backendRequest(`/api/availability/${encodeURIComponent(itemId)}`, {
        method: "PUT",
        body: JSON.stringify({ available })
      });
    } catch (error) {
      console.warn("No se pudo guardar disponibilidad en el backend:", error);
    }
  }
}

function getKitchenHiddenIds() {
  return safeParse(STORAGE_KITCHEN_HIDDEN, []);
}

function setKitchenHiddenIds(ids) {
  safeLocalSet(STORAGE_KITCHEN_HIDDEN, JSON.stringify(Array.from(new Set(ids))));
}

function getSelectedKitchenOrderId() {
  return String(safeLocalGet(STORAGE_KITCHEN_SELECTED) || "");
}

function setSelectedKitchenOrderId(orderId) {
  safeLocalSet(STORAGE_KITCHEN_SELECTED, String(orderId || ""));
}

function hideKitchenOrder(orderId) {
  const ids = getKitchenHiddenIds();
  setKitchenHiddenIds([...ids, orderId]);
  if (getSelectedKitchenOrderId() === String(orderId)) setSelectedKitchenOrderId("");
  renderKitchen();
  updateCounters();
}

function cleanKitchenHiddenIds(existingOrders) {
  const existingIds = new Set(existingOrders.map((order) => order.id));
  const cleaned = getKitchenHiddenIds().filter((id) => existingIds.has(id));
  setKitchenHiddenIds(cleaned);
}

function newOrders(orders = getOrders()) {
  return orders.filter((order) => order.status === "new" || !order.status);
}

function kitchenOrders(orders = getOrders()) {
  const hidden = new Set(getKitchenHiddenIds());
  return orders.filter((order) => !hidden.has(order.id));
}

function setSoundBanner(message = "", forceVisible = null) {
  const banner = $("#soundBanner");
  if (!banner) return;

  const text =
    banner.querySelector("#soundBannerText") ||
    banner.querySelector("p");

  if (message && text) {
    text.innerHTML = message;
  }

  banner.hidden =
    forceVisible === null
      ? soundUnlocked
      : !Boolean(forceVisible);
}

function ensureAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    window.webkitAudioContext;

  if (!AudioContextClass) {
    soundUnlocked = false;
    setSoundBanner(
      "<strong>Sonido no disponible</strong><br>Este navegador no permite Web Audio.",
      true
    );
    return null;
  }

  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextClass();

    audioCtx.addEventListener?.("statechange", () => {
      refreshSoundState();
    });

    if (!audioCtx.addEventListener) {
      audioCtx.onstatechange = refreshSoundState;
    }
  }

  return audioCtx;
}

function refreshSoundState() {
  soundUnlocked =
    Boolean(audioCtx) &&
    audioCtx.state === "running";

  if (soundUnlocked) {
    setSoundBanner("", false);
    return true;
  }

  const state = audioCtx?.state || "sin iniciar";

  setSoundBanner(
    "<strong>Toca para activar el sonido</strong><br>" +
    `Estado actual: ${escapeHtml(state)}. ` +
    "Pulsa “Activar y probar sonido” una vez después de abrir o recargar el panel.",
    true
  );

  return false;
}

function playTonePattern(testOnly = false) {
  if (!audioCtx || audioCtx.state !== "running") {
    return false;
  }

  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();

    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(
      testOnly ? 0.34 : 0.68,
      now + 0.02
    );
    master.gain.exponentialRampToValueAtTime(
      0.0001,
      now + (testOnly ? 0.34 : 0.82)
    );

    master.connect(audioCtx.destination);

    const notes = testOnly
      ? [{ offset: 0, frequency: 880, duration: 0.2 }]
      : [
          { offset: 0, frequency: 940, duration: 0.16 },
          { offset: 0.2, frequency: 720, duration: 0.16 },
          { offset: 0.4, frequency: 940, duration: 0.2 }
        ];

    notes.forEach((note) => {
      const oscillator = audioCtx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        note.frequency,
        now + note.offset
      );
      oscillator.connect(master);
      oscillator.start(now + note.offset);
      oscillator.stop(
        now + note.offset + note.duration
      );
    });

    return true;
  } catch (error) {
    console.warn("No se pudo reproducir el sonido:", error);
    soundUnlocked = false;
    refreshSoundState();
    return false;
  }
}

async function unlockSound({
  playTest = false,
  announce = false
} = {}) {
  const now = Date.now();

  if (
    now - lastSoundUnlockAttemptAt < 350 &&
    audioCtx?.state !== "running"
  ) {
    return false;
  }

  lastSoundUnlockAttemptAt = now;

  try {
    const context = ensureAudioContext();
    if (!context) return false;

    if (
      context.state === "suspended" ||
      context.state === "interrupted"
    ) {
      await context.resume();
    }

    soundUnlocked = context.state === "running";

    if (!soundUnlocked) {
      refreshSoundState();
      return false;
    }

    if (playTest && !soundConfirmationPlayed) {
      playTonePattern(true);
      soundConfirmationPlayed = true;
    }

    if (announce) {
      setSoundBanner(
        "<strong>Sonido activado</strong><br>" +
        "La alarma está preparada y sonará con cada pedido nuevo.",
        true
      );

      setTimeout(() => {
        if (audioCtx?.state === "running") {
          setSoundBanner("", false);
        }
      }, 1800);
    } else {
      setSoundBanner("", false);
    }

    return true;
  } catch (error) {
    console.warn("Safari bloqueó el sonido:", error);
    soundUnlocked = false;
    refreshSoundState();
    return false;
  }
}

async function beep() {
  if (!audioCtx || audioCtx.state !== "running") {
    const unlocked = await unlockSound({
      playTest: false,
      announce: false
    });

    if (!unlocked) {
      return false;
    }
  }

  return playTonePattern(false);
}

function startAlarm() {
  if (alarmTimer) return;

  if (!refreshSoundState()) {
    setSoundBanner(
      "<strong>Hay un pedido pendiente, pero el sonido está bloqueado</strong><br>" +
      "Pulsa “Activar y probar sonido” para iniciar la alarma.",
      true
    );
  }

  void beep();

  alarmTimer = setInterval(() => {
    if (newOrders().length) {
      void beep();
    } else {
      stopAlarm();
    }
  }, 1200);
}

function stopAlarm() {
  if (alarmTimer) {
    clearInterval(alarmTimer);
  }

  alarmTimer = null;
}

function updateAlarm() {
  const pending = newOrders();
  const signature = pending
    .map((order) => order.id)
    .join("|");

  if (pending.length) {
    if (signature !== lastNewOrderSignature) {
      void beep();
    }

    startAlarm();
  } else {
    stopAlarm();
  }

  lastNewOrderSignature = signature;
}

async function acceptOrder(orderId) {
  const cleanOrderId = String(orderId || "");
  const acceptedAt = new Date().toISOString();
  const orders = getOrders().map((order) => (
    String(order.id) === cleanOrderId
      ? { ...order, status: "accepted", acceptedAt }
      : order
  ));

  saveOrders(orders);

  try {
    await updateOrderStatusBackend(cleanOrderId, "accepted", { acceptedAt });
    await syncOrdersFromBackend();

    const acceptedOrder = findOrder(cleanOrderId);
    if (
      acceptedOrder &&
      String(acceptedOrder.paymentMethod || "").toLowerCase() === "card" &&
      normalizePaymentStatus(acceptedOrder) !== "paid"
    ) {
      scheduleAutomaticCloverQueue(0);
    }
  } catch (error) {
    console.warn("No se pudo aceptar el pedido o colocarlo en la cola Clover:", error);
  }
}

async function markReady(orderId) {
  const readyAt = new Date().toISOString();
  const orders = getOrders().map((order) => (
    order.id === orderId
      ? { ...order, status: "ready", readyAt }
      : order
  ));
  saveOrders(orders);
  try {
    await updateOrderStatusBackend(orderId, "ready", { readyAt });
    await syncOrdersFromBackend();
  } catch (error) {
    console.warn("No se pudo marcar listo en Supabase:", error);
  }
}

async function removeOrderEverywhere(orderId) {
  return hidePaidOrder(orderId);
}

function normalizePaymentStatus(order) {
  const value = String(order?.paymentStatus || "pending")
    .trim()
    .toLowerCase();

  return value || "pending";
}

function paymentStatusLabel(order) {
  const status = normalizePaymentStatus(order);

  if (status === "processing") return "Cobrando en Clover";
  if (status === "paid") return "Cobrado";
  if (status === "failed") return "Cobro fallido";
  if (status === "cancelled") return "Cobro cancelado";
  if (status === "review") return "Revisar en Clover";
  return "Pendiente de cobro";
}

function paymentStatusClass(order) {
  const status = normalizePaymentStatus(order);
  return ["processing", "paid", "failed", "cancelled", "review"].includes(status)
    ? status
    : "pending";
}

function findOrder(orderId) {
  return getOrders().find(
    (order) => String(order.id) === String(orderId)
  ) || null;
}

function requireDatabaseOrderId(order) {
  const databaseId = String(order?.databaseId || "").trim();

  if (!databaseId) {
    throw new Error(
      "Este pedido no tiene el UUID interno de Supabase. Recarga el panel antes de cobrar."
    );
  }

  return databaseId;
}

async function startCloverPayment(orderId, options = {}) {
  const cleanOrderId = String(orderId || "");
  const automatic = options.automatic === true;

  if (paymentActionLocks.has(cleanOrderId)) {
    return { ok: false, reason: "locked" };
  }

  const order = findOrder(cleanOrderId);

  if (!order) {
    if (!automatic) alert("No se encontró el pedido.");
    return { ok: false, reason: "not_found" };
  }

  if (String(order.paymentMethod || "").toLowerCase() !== "card") {
    if (!automatic) alert("Este pedido no fue marcado para pago con tarjeta.");
    return { ok: false, reason: "not_card" };
  }

  const status = normalizePaymentStatus(order);

  if (status === "paid") {
    return { ok: true, reason: "already_paid" };
  }

  if (status === "processing" || status === "review") {
    return { ok: false, reason: status };
  }

  paymentActionLocks.add(cleanOrderId);
  automaticCloverAttemptedAt.set(cleanOrderId, Date.now());
  renderOrders();
  renderPayments();

  try {
    const result = await callProtectedAdminFunction(
      "clover-start-payment",
      {
        order_id: requireDatabaseOrderId(order),
        queue_if_busy: true,
        priority: "latest"
      }
    );

    await syncOrdersFromBackend();

    return {
      ok: true,
      queued: Boolean(result?.queued),
      result
    };
  } catch (error) {
    console.error("Falló el envío automático a Clover:", error);
    await syncOrdersFromBackend();

    const code = String(error?.payload?.error || "");
    const busy =
      code === "clover_busy" ||
      code === "active_payment_exists" ||
      Number(error?.status || 0) === 409 ||
      Boolean(error?.payload?.active_public_id);

    if (busy) {
      /*
        Clover solo puede presentar un cobro físico a la vez.
        El pedido nuevo conserva estado pending y tendrá prioridad
        en el siguiente intento automático.
      */
      return {
        ok: false,
        queued: true,
        reason: "clover_busy",
        activePublicId: error?.payload?.active_public_id || null
      };
    }

    const indeterminate =
      code === "payment_state_indeterminate" ||
      code === "payment_requires_review";

    if (!automatic && indeterminate) {
      alert(
        `No vuelvas a cobrar el pedido #${order.id} todavía.\n\n` +
        "Revisa la transacción en Clover antes de repetirla."
      );
    } else if (!automatic) {
      alert(`No se pudo enviar el cobro a Clover.\n\n${error?.message || error}`);
    }

    return {
      ok: false,
      reason: indeterminate ? "review" : "error",
      error
    };
  } finally {
    paymentActionLocks.delete(cleanOrderId);
    renderOrders();
    renderPayments();
    scheduleAutomaticCloverQueue(AUTOMATIC_CLOVER_RETRY_MS);
  }
}

function automaticCloverCandidates() {
  return getOrders()
    .filter((order) => {
      const method = String(order.paymentMethod || "").toLowerCase();
      const status = normalizePaymentStatus(order);
      const accepted = order.status === "accepted" || order.status === "ready";

      return (
        method === "card" &&
        accepted &&
        !order.hiddenForAll &&
        ["pending", "failed", "cancelled"].includes(status)
      );
    })
    .sort((left, right) =>
      orderCreatedTimestamp(right) - orderCreatedTimestamp(left)
    );
}

function scheduleAutomaticCloverQueue(delay = 250) {
  if (automaticCloverQueueTimer) {
    clearTimeout(automaticCloverQueueTimer);
  }

  automaticCloverQueueTimer = setTimeout(() => {
    automaticCloverQueueTimer = null;
    void processAutomaticCloverQueue();
  }, Math.max(0, Number(delay || 0)));
}

async function processAutomaticCloverQueue() {
  if (automaticCloverQueueRunning || !adminPinInMemory) return;

  const orders = getOrders();
  const active = orders.find(
    (order) => normalizePaymentStatus(order) === "processing"
  );

  /*
    Nunca se interrumpe a ciegas un cobro que ya está visible
    en el terminal. El pedido más nuevo queda primero y se envía
    inmediatamente cuando Clover deja de estar procesando.
  */
  if (active) {
    scheduleAutomaticCloverQueue(AUTOMATIC_CLOVER_RETRY_MS);
    return;
  }

  const candidate = automaticCloverCandidates()[0];
  if (!candidate) return;

  const lastAttempt = Number(
    automaticCloverAttemptedAt.get(String(candidate.id)) || 0
  );

  if (Date.now() - lastAttempt < AUTOMATIC_CLOVER_RETRY_MS) {
    scheduleAutomaticCloverQueue(
      AUTOMATIC_CLOVER_RETRY_MS - (Date.now() - lastAttempt)
    );
    return;
  }

  automaticCloverQueueRunning = true;

  try {
    await startCloverPayment(candidate.id, { automatic: true });
  } finally {
    automaticCloverQueueRunning = false;
  }
}
async function confirmCashPayment(orderId) {
  const cleanOrderId = String(orderId || "");
  if (paymentActionLocks.has(cleanOrderId)) return;

  const order = findOrder(cleanOrderId);
  if (!order) {
    alert("No se encontró el pedido.");
    return;
  }

  if (String(order.paymentMethod || "").toLowerCase() !== "cash") {
    alert("Este pedido no fue marcado para pago en efectivo.");
    return;
  }

  if (!confirm(
    `¿Confirmas que recibiste ${money(order.totals?.total)} en efectivo para el pedido #${order.id}?`
  )) return;

  paymentActionLocks.add(cleanOrderId);
  renderPayments();

  try {
    await callProtectedAdminFunction(
      "admin-order-payment",
      {
        action: "confirm_cash",
        order_id: requireDatabaseOrderId(order)
      }
    );

    await syncOrdersFromBackend();
    alert(
      `Efectivo confirmado para el pedido #${order.id}. ` +
      "Ahora aparece el botón “Quitar pedido para todos”."
    );
  } catch (error) {
    console.error("No se pudo confirmar el efectivo:", error);
    alert(`No se pudo confirmar el efectivo.\n\n${error?.message || error}`);
  } finally {
    paymentActionLocks.delete(cleanOrderId);
    renderPayments();
  }
}

async function hidePaidOrder(orderId) {
  const cleanOrderId = String(orderId || "");
  if (paymentActionLocks.has(cleanOrderId)) return;

  const order = findOrder(cleanOrderId);
  if (!order) {
    alert("No se encontró el pedido.");
    return;
  }

  const firstConfirmation = confirm(
    `¿Quitar el pedido #${order.id} para todos los dispositivos?`
  );
  if (!firstConfirmation) return;

  const secondConfirmation = confirm(
    `CONFIRMACIÓN FINAL\n\nEl pedido #${order.id} desaparecerá de Pedidos, Cocina y Cobros para todos.\nLa venta seguirá guardada en Supabase.\n\n¿Confirmas que deseas quitarlo?`
  );
  if (!secondConfirmation) return;

  paymentActionLocks.add(cleanOrderId);
  renderOrders();
  renderPayments();

  try {
    await callProtectedAdminFunction(
      "admin-order-payment",
      {
        action: "hide_for_all",
        order_id: requireDatabaseOrderId(order)
      }
    );

    const nextOrders = getOrders().filter(
      (candidate) => String(candidate.id) !== cleanOrderId
    );
    setOrders(nextOrders);
    renderAll();
    await syncOrdersFromBackend();
  } catch (error) {
    console.error("No se pudo quitar el pedido:", error);
    alert(`No se pudo quitar el pedido.\n\n${error?.message || error}`);
  } finally {
    paymentActionLocks.delete(cleanOrderId);
    renderOrders();
    renderPayments();
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function edgeFunctionErrorDetails(error) {
  const parts = [];
  if (error && error.message) parts.push(error.message);

  const response = error && error.context;
  if (response) {
    if (response.status) parts.push(`HTTP ${response.status}`);
    try {
      const readable = typeof response.clone === "function" ? response.clone() : response;
      const payload = await readable.json();
      if (payload?.error) parts.push(payload.error);
      if (payload?.detail) parts.push(payload.detail);
      if (!payload?.error && !payload?.detail) parts.push(JSON.stringify(payload));
    } catch (_) {
      try {
        const readable = typeof response.clone === "function" ? response.clone() : response;
        const body = await readable.text();
        if (body) parts.push(body);
      } catch (_) {
        // La respuesta no tenia un cuerpo legible.
      }
    }
  }

  return Array.from(new Set(parts.filter(Boolean))).join(" · ") || "Error desconocido";
}


async function sendReadyNotification(orderId) {
  const orders = getOrders();
  const order = orders.find(
    (candidate) => String(candidate.id) === String(orderId)
  );

  if (!order) {
    alert("No se encontró el pedido.");
    return;
  }

  const cfg = window.FOGON_SUPABASE || {};
  const supabaseUrl = String(cfg.url || "").replace(/\/$/, "");
  const anonKey = String(cfg.anonKey || "").trim();

  if (!supabaseUrl || !anonKey) {
    alert("Faltan la URL o la anon key de Supabase en supabase-config.js.");
    return;
  }

  const endpoint =
    `${supabaseUrl}/functions/v1/send-whatsapp-order-ready`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: buildEdgeFunctionHeaders(anonKey),
      body: JSON.stringify({
        orderId: order.databaseId || order.id,
        publicId: Number(order.id) || null,
        adminPin: getAdminPinOrThrow()
      })
    });

    const rawText = await response.text();
    let result = {};

    try {
      result = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      result = { detail: rawText };
    }

    if (!response.ok || !result?.ok) {
      const reason = [
        `HTTP ${response.status}`,
        result?.error,
        result?.detail,
        result?.result?.error?.message
      ].filter(Boolean).join(" · ");

      throw new Error(
        reason || "WhatsApp no confirmó el envío."
      );
    }

    const updatedOrders = getOrders().map((candidate) => (
      String(candidate.id) === String(orderId)
        ? {
            ...candidate,
            status: "ready",
            readyAt: result.readyAt || new Date().toISOString(),
            whatsappSent: true
          }
        : candidate
    ));

    saveOrders(updatedOrders);
    await syncOrdersFromBackend();

    if (result.alreadySent) {
      alert(
        `El pedido ${order.id} ya tenía el WhatsApp enviado. ` +
        "No se envió un duplicado."
      );
      return;
    }

    alert(
      `Pedido ${order.id} marcado como listo. ` +
      "WhatsApp enviado correctamente."
    );
  } catch (whatsappError) {
    console.error("Falló el envío por WhatsApp:", whatsappError);

    alert(
      `No se pudo enviar el WhatsApp al cliente.

` +
      `${whatsappError?.message || whatsappError}`
    );
  }
}


async function sendDailyMissingReport() {
  const button = $("#sendDailyMissingBtn");
  if (button?.disabled) return;
  try {
    button.disabled = true;
    button.textContent = "Enviando faltantes…";
    const { supabaseUrl, anonKey } = getSupabaseFunctionConfig();
    const response = await fetch(`${supabaseUrl}/functions/v1/send-daily-missing`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: buildEdgeFunctionHeaders(anonKey),
      body: JSON.stringify({ action: "send_now", adminPin: getAdminPinOrThrow() })
    });
    const raw = await response.text();
    let result = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch (_) { result = { detail: raw }; }
    if (!response.ok || !result?.ok) {
      throw new Error([`HTTP ${response.status}`, result?.error, result?.detail].filter(Boolean).join(" · "));
    }
    alert(`Faltantes enviados a +1 650-722-4407. ${Number(result.count || 0)} elemento(s).`);
  } catch (error) {
    console.error(error);
    alert(`No se pudieron enviar los faltantes.\n\n${error?.message || error}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Enviar faltantes del día por WhatsApp";
    }
  }
}

let kitchenSwipe = null;

function selectKitchenCard(card) {
  const id = String(card?.dataset?.kitchenOrderId || "");
  if (!id) return;
  setSelectedKitchenOrderId(id);
  $$(".kitchen-order-card").forEach((item) => {
    item.classList.toggle("kitchen-selected", String(item.dataset.kitchenOrderId) === id);
  });
}

function startKitchenSwipe(card, x, y) {
  if (!card?.classList.contains("kitchen-selected")) return;
  kitchenSwipe = { card, startX: x, startY: y, dx: 0, horizontal: false };
}

function moveKitchenSwipe(x, y) {
  if (!kitchenSwipe) return;
  const dx = x - kitchenSwipe.startX;
  const dy = y - kitchenSwipe.startY;
  if (!kitchenSwipe.horizontal) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (Math.abs(dy) >= Math.abs(dx) || dx >= 0) {
      kitchenSwipe = null;
      return;
    }
    kitchenSwipe.horizontal = true;
    kitchenSwipe.card.classList.add("kitchen-dragging");
  }
  kitchenSwipe.dx = Math.min(0, dx);
  kitchenSwipe.card.style.transform = `translate3d(${Math.max(-180, kitchenSwipe.dx)}px,0,0)`;
}

function finishKitchenSwipe() {
  if (!kitchenSwipe) return;
  const { card, dx, horizontal } = kitchenSwipe;
  kitchenSwipe = null;
  card.classList.remove("kitchen-dragging");
  if (horizontal && dx <= -90) {
    const id = String(card.dataset.kitchenOrderId || "");
    card.classList.add("kitchen-closing");
    setTimeout(() => hideKitchenOrder(id), 190);
    return;
  }
  card.style.transform = "";
}

function initKitchenGesturesAndMissingButton() {
  const style = document.createElement("style");
  style.textContent = `
    .kitchen-order-card{touch-action:pan-y;user-select:none;-webkit-user-select:none;transition:transform 180ms ease,opacity 180ms ease,box-shadow 180ms ease;will-change:transform,opacity}
    .kitchen-order-card.kitchen-selected{outline:4px solid rgba(255,174,0,.95);box-shadow:0 0 0 7px rgba(255,174,0,.18)}
    .kitchen-order-card.kitchen-dragging{transition:none}
    .kitchen-order-card.kitchen-closing{transform:translate3d(-120%,80px,0) rotate(-7deg)!important;opacity:0}
    .kitchen-swipe-hint{display:none;margin:10px 0;font-weight:800}
    .kitchen-order-card.kitchen-selected .kitchen-swipe-hint{display:block}
  `;
  document.head.appendChild(style);

  document.addEventListener("click", (event) => {
    const missing = event.target.closest("#sendDailyMissingBtn");
    if (missing) {
      event.preventDefault();
      sendDailyMissingReport();
      return;
    }
    const card = event.target.closest(".kitchen-order-card");
    if (card && !event.target.closest("button,a,input,select,textarea")) selectKitchenCard(card);
  });

  document.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".kitchen-order-card");
    if (card) startKitchenSwipe(card, event.clientX, event.clientY);
  });
  document.addEventListener("pointermove", (event) => moveKitchenSwipe(event.clientX, event.clientY));
  document.addEventListener("pointerup", finishKitchenSwipe);
  document.addEventListener("pointercancel", finishKitchenSwipe);

  document.addEventListener("touchstart", (event) => {
    const card = event.target.closest(".kitchen-order-card");
    const touch = event.touches?.[0];
    if (card && touch) startKitchenSwipe(card, touch.clientX, touch.clientY);
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    moveKitchenSwipe(touch.clientX, touch.clientY);
    if (kitchenSwipe?.horizontal) event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", finishKitchenSwipe);
  document.addEventListener("touchcancel", finishKitchenSwipe);
}

function resolveOrderType(order) {
  const firstItem = Array.isArray(order?.items) ? order.items[0] : null;
  const raw = order?.raw && typeof order.raw === "object" ? order.raw : {};

  const candidates = [
    order?.orderType,
    order?.order_type,
    order?.fulfillmentType,
    order?.fulfillment_type,
    order?.serviceType,
    order?.service_type,
    raw?.orderType,
    raw?.order_type,
    raw?.fulfillmentType,
    raw?.fulfillment_type,
    firstItem?.orderType,
    firstItem?.order_type,
    firstItem?.fulfillmentType,
    firstItem?.fulfillment_type
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[_\s]+/g, "-");

    if (!normalized) continue;

    if (
      normalized === "dine-in" ||
      normalized === "dinein" ||
      normalized === "for-here" ||
      normalized === "here" ||
      normalized === "para-aqui" ||
      normalized === "comer-aqui" ||
      normalized === "local"
    ) {
      return "dine-in";
    }

    if (
      normalized === "takeout" ||
      normalized === "take-out" ||
      normalized === "to-go" ||
      normalized === "togo" ||
      normalized === "para-llevar" ||
      normalized === "pickup" ||
      normalized === "pick-up"
    ) {
      return "takeout";
    }
  }

  return "";
}

function orderTypeLabel(typeOrOrder) {
  const type = typeof typeOrOrder === "object"
    ? resolveOrderType(typeOrOrder)
    : resolveOrderType({ orderType: typeOrOrder });

  if (type === "dine-in") return "Para aquí";
  if (type === "takeout") return "Para llevar";
  return "No indicado";
}

function paymentLabel(method) {
  if (method === "card") return "Tarjeta en ventanilla";
  if (method === "cash") return "Efectivo en ventanilla";
  return "No indicado";
}

function statusLabel(order) {
  const status = order.status || "new";
  if (status === "ready") return "Listo";
  if (status === "accepted") return "Aceptado";
  return "Nuevo";
}

function statusClass(order) {
  const status = order.status || "new";
  if (status === "ready") return "ready";
  if (status === "accepted") return "accepted";
  return "new";
}

function adminItemConfigurationKey(item) {
  return JSON.stringify({
    productId: String(item?.productId || item?.product_id || item?.nameEs || item?.name || ""),
    name: String(item?.nameEs || item?.name || ""),
    selections: (item?.selections || []).map((selection) => ({
      group: String(selection.groupEs || selection.group || ""),
      name: String(selection.nameEs || selection.name || ""),
      price: Number(selection.price || 0)
    })),
    extras: (item?.extras || []).map((extra) => ({
      name: String(extra.nameEs || extra.name || ""),
      price: Number(extra.price || 0)
    })),
    removables: (item?.removables || []).map((remove) =>
      typeof remove === "string" ? remove : String(remove.nameEs || remove.name || "")
    ),
    notes: String(item?.notes || "").trim(),
    lineTotal: Number(item?.lineTotal || 0)
  });
}

function aggregateOrderItems(items) {
  const grouped = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = adminItemConfigurationKey(item);
    const quantity = Math.max(1, Number(item?.quantity || 1));

    if (!grouped.has(key)) {
      grouped.set(key, { ...item, quantity });
      return;
    }

    const existing = grouped.get(key);
    existing.quantity = Number(existing.quantity || 1) + quantity;
  });

  return Array.from(grouped.values());
}

function orderTotalQuantity(items) {
  return aggregateOrderItems(items).reduce(
    (total, item) => total + Math.max(1, Number(item.quantity || 1)),
    0
  );
}

function itemDetailsHtml(item, compact = false) {
  const itemNameEs = item.nameEs || item.name || "";
  return `
    <div class="order-item-line">
      <strong>${escapeHtml(item.quantity)}x ${escapeHtml(itemNameEs)}</strong>
      ${(item.selections || []).map((selection) => `<p>${escapeHtml(selection.groupEs || selection.group)}: ${escapeHtml(selection.nameEs || selection.name)}</p>`).join("")}
      ${(item.extras || []).map((extra) => `<p>Extra: ${escapeHtml(extra.nameEs || extra.name)} +${money(extra.price)}</p>`).join("")}
      ${(item.removables || []).map((remove) => `<p>${escapeHtml(typeof remove === "string" ? remove : (remove.nameEs || remove.name))}</p>`).join("")}
      ${item.notes ? `<p><strong>Nota:</strong> ${escapeHtml(item.notes)}</p>` : ""}
      ${compact ? "" : `<p class="item-price">${money((item.lineTotal || 0) * (item.quantity || 1))}</p>`}
    </div>
  `;
}

function updateCounters() {
  const orders = getOrders();
  const kitchen = kitchenOrders(orders);
  const pending = newOrders(orders);
  const paymentsPending = orders.filter(
    (order) => normalizePaymentStatus(order) !== "paid"
  );

  const orderCount = $("#orderCount");
  const pendingCount = $("#pendingCount");
  const kitchenCount = $("#kitchenCount");
  const kitchenVisibleCount = $("#kitchenVisibleCount");
  const paymentCount = $("#paymentCount");
  const paymentOrderCount = $("#paymentOrderCount");

  if (orderCount) orderCount.textContent = orders.length;
  if (pendingCount) pendingCount.textContent = pending.length;
  if (kitchenCount) kitchenCount.textContent = kitchen.length;
  if (kitchenVisibleCount) kitchenVisibleCount.textContent = kitchen.length;
  if (paymentCount) paymentCount.textContent = paymentsPending.length;
  if (paymentOrderCount) paymentOrderCount.textContent = orders.length;
}


function orderCreatedTimestamp(order) {
  const value = Date.parse(order?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function orderElapsedLabel(order) {
  const createdAt = orderCreatedTimestamp(order);
  if (!createdAt) return "";

  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - createdAt) / 60000)
  );

  if (elapsedMinutes < 1) return "Ahora";
  if (elapsedMinutes === 1) return "Hace 1 min";
  if (elapsedMinutes < 60) return `Hace ${elapsedMinutes} min`;

  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;

  return minutes
    ? `Hace ${hours} h ${minutes} min`
    : `Hace ${hours} h`;
}

function stableOrdersSignature(orders) {
  try {
    return JSON.stringify(orders);
  } catch (_) {
    return String(Date.now());
  }
}

function updateElapsedLabels() {
  document.querySelectorAll("[data-order-elapsed]").forEach((node) => {
    const orderId = String(node.getAttribute("data-order-elapsed") || "");
    const order = getOrders().find((item) => String(item.id) === orderId);
    if (order) node.textContent = orderElapsedLabel(order);
  });
}


function toggleOrderCard(orderId) {
  const cleanOrderId = String(orderId || "");
  if (!cleanOrderId) return;

  const card = document.querySelector(
    `[data-order-card="${CSS.escape(cleanOrderId)}"]`
  );

  const body = card?.querySelector(".order-card-body");
  const button = card?.querySelector("[data-toggle-order]");
  const hint = card?.querySelector(".order-card-toggle-hint > span:first-child");
  const isExpanded = expandedOrderIds.has(cleanOrderId);

  if (isExpanded) {
    expandedOrderIds.delete(cleanOrderId);
    card?.classList.remove("is-expanded");
    card?.classList.add("is-collapsed");
    if (body) body.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    if (hint) hint.textContent = "Pulsa la cabecera para abrir";
    return;
  }

  expandedOrderIds.add(cleanOrderId);
  card?.classList.remove("is-collapsed");
  card?.classList.add("is-expanded");
  if (body) body.hidden = false;
  if (button) button.setAttribute("aria-expanded", "true");
  if (hint) hint.textContent = "Pedido abierto";
}


function compactOrderItemHtml(item) {
  const quantity = Math.max(1, Number(item?.quantity || 1));
  const itemNameEs = item?.nameEs || item?.name || "";

  const details = [
    ...(item?.selections || []).map((selection) =>
      `${selection.groupEs || selection.group}: ${selection.nameEs || selection.name}`
    ),
    ...(item?.extras || []).map((extra) =>
      `Extra: ${extra.nameEs || extra.name}${Number(extra.price || 0) ? ` +${money(extra.price)}` : ""}`
    ),
    ...(item?.removables || []).map((remove) =>
      `Sin: ${typeof remove === "string" ? remove : (remove.nameEs || remove.name || "")}`
    ),
    ...(item?.notes ? [`Nota: ${item.notes}`] : [])
  ];

  return `
    <span class="compact-order-item">
      <span class="compact-order-item-head">
        <strong>${escapeHtml(quantity)}x ${escapeHtml(itemNameEs)}</strong>
        <b>${money(Number(item?.lineTotal || 0) * quantity)}</b>
      </span>
      ${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}
    </span>
  `;
}

function renderOrders() {
  const orders = getOrders()
    .slice()
    .sort((left, right) =>
      orderCreatedTimestamp(right) - orderCreatedTimestamp(left)
    );

  const renderSignature = stableOrdersSignature(orders);
  const ordersList = $("#ordersList");
  if (!ordersList) return;

  if (renderSignature === lastOrdersRenderSignature && ordersList.childNodes.length) {
    updateCounters();
    updateElapsedLabels();
    updateAlarm();
    return;
  }

  lastOrdersRenderSignature = renderSignature;
  knownOrderIds = new Set(orders.map((order) => String(order.id)));
  Array.from(expandedOrderIds).forEach((orderId) => {
    if (!knownOrderIds.has(orderId)) expandedOrderIds.delete(orderId);
  });
  ordersRenderInitialized = true;
  updateCounters();

  ordersList.innerHTML = orders.length ? orders.map((order) => {
    const orderId = String(order.id);
    const isNew = order.status === "new" || !order.status;
    const isReady = order.status === "ready";
    const isExpanded = expandedOrderIds.has(orderId);
    const totalQuantity = orderTotalQuantity(order.items);
    return `
    <article
      class="order-card ${isNew ? "is-new" : "is-accepted"} ${isExpanded ? "is-expanded" : "is-collapsed"}"
      data-order-card="${escapeHtml(orderId)}"
    >
      <button
        class="order-card-toggle"
        type="button"
        data-toggle-order="${escapeHtml(orderId)}"
        aria-expanded="${isExpanded ? "true" : "false"}"
        aria-controls="order-body-${escapeHtml(orderId)}"
      >
        <span class="order-card-accent" aria-hidden="true"></span>
        <span class="order-card-topline">
          <span class="order-number">#${escapeHtml(orderId)}</span>
          <span class="order-status ${statusClass(order)}">${statusLabel(order)}</span>
        </span>
        <span class="order-customer-name">${escapeHtml(order.customer?.name || "Sin nombre")}</span>
        <span class="order-card-meta">
          <span data-order-elapsed="${escapeHtml(orderId)}">${escapeHtml(orderElapsedLabel(order))}</span>
          <span>${escapeHtml(orderTypeLabel(order))}</span>
        </span>
        <span class="compact-order-service">
          <span><strong>Teléfono:</strong> ${escapeHtml(order.customer?.phone || "Sin teléfono")}</span>
          <span><strong>Pago:</strong> ${escapeHtml(paymentLabel(order.paymentMethod))}</span>
          <span><strong>Cobro:</strong> ${escapeHtml(paymentStatusLabel(order))}</span>
          <span><strong>Entrada:</strong> ${escapeHtml(new Date(order.createdAt).toLocaleString())}</span>
        </span>

        <span class="compact-order-items">
          ${aggregateOrderItems(order.items).map((item) => compactOrderItemHtml(item)).join("")}
        </span>

        <span class="compact-order-total">
          <span>${totalQuantity} artículo${totalQuantity === 1 ? "" : "s"}</span>
          <strong>Total ${money(order.totals?.total)}</strong>
        </span>

        <span class="order-card-summary order-card-toggle-hint" aria-hidden="true">
          <span>${isExpanded ? "Pedido abierto" : "Pulsa la cabecera para abrir"}</span>
          <span class="order-chevron">⌄</span>
        </span>
      </button>

      <div
        id="order-body-${escapeHtml(orderId)}"
        class="order-card-body"
        ${isExpanded ? "" : "hidden"}
      >
        <div class="order-contact">
          <p class="order-fulfillment-type"><strong>Tipo de pedido:</strong> ${escapeHtml(orderTypeLabel(order))}</p>
          <p><strong>Teléfono:</strong> ${escapeHtml(order.customer?.phone || "Sin teléfono")}</p>
          <p><strong>Pago:</strong> ${escapeHtml(paymentLabel(order.paymentMethod))}</p>
          <p><strong>Cobro:</strong> ${escapeHtml(paymentStatusLabel(order))}</p>
          <p><strong>Entrada:</strong> ${escapeHtml(new Date(order.createdAt).toLocaleString())}</p>
        </div>

        <div class="order-items">
          ${aggregateOrderItems(order.items).map((item) => itemDetailsHtml(item)).join("")}
        </div>

        <div class="order-total">
          <span>Total</span>
          <strong>${money(order.totals?.total)}</strong>
        </div>

        ${isNew
          ? `<button class="primary-btn full accept-order" data-accept-order="${escapeHtml(orderId)}" type="button">Aceptar pedido y parar sonido</button>`
          : `<p class="accepted-note">${isReady ? "Pedido listo" : "Pedido aceptado"}${order.acceptedAt ? ` · ${new Date(order.acceptedAt).toLocaleTimeString()}` : ""}</p>`}

        ${!isNew ? `
          <section class="order-inline-payment" aria-label="Acciones del pedido y cobro">
            <div class="order-inline-payment-head">
              <div>
                <small>${String(order.paymentMethod || "").toLowerCase() === "card" ? "Cobro con tarjeta" : "Cobro en efectivo"}</small>
                <strong>${money(order.totals?.total)}</strong>
              </div>
              <span class="payment-state ${paymentStatusClass(order)}">${escapeHtml(paymentStatusLabel(order))}</span>
            </div>

            <div class="order-inline-payment-actions">
              <button class="secondary-btn ready-order-btn" data-ready-order="${escapeHtml(orderId)}" type="button">
                Pedido listo / Enviar WhatsApp
              </button>
              ${paymentActionHtml(order)}
            </div>
          </section>
        ` : ""}
      </div>
    </article>`;
  }).join("") : `<p class="empty-state">No hay pedidos todavía.</p>`;

  updateAlarm();
}

function paymentActionHtml(order) {
  const orderId = escapeHtml(order.id);
  const method = String(order.paymentMethod || "").toLowerCase();
  const status = normalizePaymentStatus(order);
  const busy = paymentActionLocks.has(String(order.id));
  const removeButton = `<button class="secondary-btn danger-btn full remove-order-btn" data-hide-paid="${orderId}" type="button">Quitar pedido para todos</button>`;

  if (busy) {
    return `
      <button class="primary-btn full" type="button" disabled>Procesando…</button>
      ${removeButton}
    `;
  }

  if (method === "card") {
    if (status === "processing") {
      return `
        <button class="primary-btn full clover-pay-btn" type="button" disabled>Esperando tarjeta en Clover…</button>
        ${removeButton}
      `;
    }

    if (status === "review") {
      return `
        <div class="payment-review-warning">
          Revisa este cobro en Clover antes de volver a cobrar.
        </div>
        ${removeButton}
      `;
    }

    if (status === "paid") {
      return removeButton;
    }

    return `
      <button class="primary-btn full clover-pay-btn" data-clover-pay="${orderId}" type="button">
        ${status === "failed" || status === "cancelled" ? "Reintentar con Clover" : "Cobrar con Clover"}
      </button>
      ${removeButton}
    `;
  }

  if (method === "cash") {
    if (status === "paid") {
      return removeButton;
    }

    return `
      <button class="primary-btn full cash-pay-btn" data-cash-pay="${orderId}" type="button">Cobrar en efectivo</button>
      ${removeButton}
    `;
  }

  return `
    <button class="secondary-btn full" type="button" disabled>Método de pago no indicado</button>
    ${removeButton}
  `;
}

function paymentQueuePriority(order) {
  const status = normalizePaymentStatus(order);
  if (status === "processing") return 0;
  if (status === "review") return 1;
  if (order.status === "ready") return 2;
  if (order.status === "accepted") return 3;
  return 4;
}

function renderPayments() {
  const paymentsList = $("#paymentsList");
  if (!paymentsList) return;

  const orders = getOrders()
    .slice()
    .sort((left, right) => {
      const priority = paymentQueuePriority(left) - paymentQueuePriority(right);
      if (priority) return priority;
      return orderCreatedTimestamp(left) - orderCreatedTimestamp(right);
    });

  const activePayment = orders.find(
    (order) => normalizePaymentStatus(order) === "processing"
  );
  const queueStatus = $("#cloverQueueStatus");

  if (queueStatus) {
    if (activePayment) {
      queueStatus.className = "clover-queue-status is-busy";
      queueStatus.textContent =
        `Clover ocupado con el pedido #${activePayment.id}. ` +
        "Los demás pedidos siguen disponibles, pero no pueden iniciar otro cobro con tarjeta todavía.";
    } else {
      queueStatus.className = "clover-queue-status is-ready";
      queueStatus.textContent =
        "Clover disponible. Selecciona el pedido del cliente que está frente al terminal.";
    }
  }

  paymentsList.innerHTML = orders.length
    ? orders.map((order) => {
        const status = normalizePaymentStatus(order);
        const error = String(order.paymentError || "").trim();
        const method = paymentLabel(order.paymentMethod);

        return `
          <article class="payment-order-card payment-${paymentStatusClass(order)}">
            <div class="payment-order-head">
              <div>
                <span class="payment-order-number">#${escapeHtml(order.id)}</span>
                <h3>${escapeHtml(order.customer?.name || "Sin nombre")}</h3>
              </div>
              <span class="payment-state ${paymentStatusClass(order)}">${escapeHtml(paymentStatusLabel(order))}</span>
            </div>

            <div class="payment-order-summary">
              <span>${escapeHtml(method)}</span>
              <strong>${money(order.totals?.total)}</strong>
            </div>

            <p class="payment-order-meta">
              ${escapeHtml(orderTypeLabel(order))} · ${escapeHtml(orderElapsedLabel(order))}
            </p>

            ${error ? `<p class="payment-error-text">${escapeHtml(error)}</p>` : ""}
            ${status === "paid" && String(order.paymentMethod || "").toLowerCase() === "cash"
              ? `<p class="payment-cash-confirmed">Efectivo confirmado. Ya puedes quitar el pedido para todos.</p>`
              : ""}

            <div class="payment-action-wrap">
              ${paymentActionHtml(order)}
            </div>
          </article>
        `;
      }).join("")
    : `<p class="empty-state">No hay pedidos pendientes en el panel.</p>`;

  updateCounters();
}

function renderKitchen() {
  const orders = getOrders();
  cleanKitchenHiddenIds(orders);
  const visibleOrders = kitchenOrders(orders);
  updateCounters();

  const kitchenList = $("#kitchenList");
  if (!kitchenList) return;

  kitchenList.innerHTML = visibleOrders.length ? visibleOrders.map((order) => `
    <article class="kitchen-order-card ${getSelectedKitchenOrderId() === String(order.id) ? "kitchen-selected" : ""}" data-kitchen-order-id="${escapeHtml(order.id)}">
      <div class="kitchen-order-head">
        <div class="kitchen-order-identity">
          <strong>#${escapeHtml(order.id)}</strong>
          <span class="kitchen-fulfillment-type">${escapeHtml(orderTypeLabel(order))}</span>
        </div>
        <span>${statusLabel(order)}</span>
      </div>
      <div class="kitchen-items">
        ${aggregateOrderItems(order.items).map((item) => itemDetailsHtml(item, true)).join("")}
      </div>
      <p class="kitchen-swipe-hint">Toca para preparar · desliza a la izquierda para retirar de Cocina</p>
      <button class="secondary-btn full" data-kitchen-done="${escapeHtml(order.id)}" type="button">Terminado en cocina</button>
    </article>
  `).join("") : `<p class="empty-state">No hay comandas pendientes para cocina.</p>`;
}

function renderAvailability() {
  const availability = getAvailability();
  const query = availabilityQuery.trim().toLowerCase();
  const menuSource = Array.isArray(adminCatalogMenuItems)
    ? adminCatalogMenuItems
    : [];

  const menuItems = menuSource.map((item) => ({
    id: item.id,
    es: item.es,
    en: item.en,
    group: "Productos del menu"
  }));
  const inventoryItems = INVENTORY_ITEMS.map((item) => ({
    ...item,
    group: "Inventario interno"
  }));
  const items = [...menuItems, ...inventoryItems].filter((item) => {
    const haystack = `${item.es} ${item.en} ${item.group}`.toLowerCase();
    return haystack.includes(query);
  });
  const availabilityList = $("#availabilityList");
  if (!availabilityList) return;

  const groups = ["Productos del menu", "Inventario interno"];
  availabilityList.innerHTML = groups.map((group) => {
    const groupItems = items.filter((item) => item.group === group);
    if (!groupItems.length) return "";
    return `
      <section class="availability-group">
        <h3>${escapeHtml(group)}</h3>
        ${groupItems.map((item) => {
          const available = availability[item.id] !== false;
          return `
            <label class="availability-row">
              <span>${escapeHtml(item.es)}${item.en !== item.es ? `<small>${escapeHtml(item.en)}</small>` : ""}</span>
              <input type="checkbox" data-availability="${escapeHtml(item.id)}" ${available ? "checked" : ""}>
            </label>
          `;
        }).join("")}
      </section>
    `;
  }).join("");

  renderOrderModeButton();
}

function renderAll() {
  renderOrders();
  renderKitchen();
  renderPayments();
  renderAvailability();
}

function switchTab(tabName) {
  $$("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === tabName);
  });

  $$("[data-admin-panel]").forEach((panel) => {
    const active = panel.dataset.adminPanel === tabName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}


function showAdminPanel() {
  const login = $("#adminLogin");
  const panel = $("#adminPanel");

  if (login) {
    login.hidden = true;
    login.style.display = "none";
  }

  if (panel) {
    panel.hidden = false;
    panel.style.display = "";
  }

  /*
    La interfaz ya está abierta. Pedidos, sonido y disponibilidad
    se inicializan después y no pueden volver a bloquear el acceso.
  */
  setTimeout(() => {
    try {
      refreshSoundState();
      renderAll();

      if (newOrders().length) {
        startAlarm();
      }
    } catch (error) {
      console.error(
        "Una sección secundaria no pudo iniciarse:",
        error
      );

      const banner = $("#soundBanner");

      if (banner) {
        banner.hidden = false;
        banner.innerHTML = `
          <p>
            <strong>El panel abrió correctamente.</strong><br>
            Una sección secundaria produjo este error:
            ${escapeHtml(error?.message || error)}
          </p>
        `;
      }
    }

    Promise.resolve(syncOrdersFromBackend()).catch((error) => {
      console.warn("No se pudieron cargar los pedidos:", error);
    });

    Promise.resolve(syncAvailabilityFromBackend()).catch((error) => {
      console.warn("No se pudo cargar la disponibilidad:", error);
    });

    Promise.resolve(loadAdminCatalogMenuItems()).catch((error) => {
      console.warn("No se pudo cargar el catálogo administrativo:", error);
    });
  }, 0);
}

function initLogin() {
  const form = $("#pinForm");
  const input = $("#pinInput");
  const loginButton = $("#loginButton");
  const error = $("#pinError");

  if (!form || !input || !loginButton) {
    showLoginRuntimeError(
      new Error("Faltan elementos del formulario de acceso.")
    );
    return;
  }

  let loginRunning = false;

  function setLoginBusy(busy, label = "Entrar") {
    loginRunning = Boolean(busy);
    input.disabled = Boolean(busy);
    loginButton.disabled = Boolean(busy);
    loginButton.textContent = busy ? label : "Entrar";
  }

  async function tryLogin(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (loginRunning) return false;

    /*
      Este intento ocurre dentro del gesto del botón.
      iPad/Safari necesita ese gesto para permitir audio.
    */
    void unlockSound({
      playTest: false,
      announce: false
    });

    const value = String(input.value || "").trim();

    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    setLoginBusy(true, "Comprobando…");

    try {
      const validatedPin =
        await validateAdminPin(value);

      adminPinInMemory = validatedPin;
      saveTrustedAdminSession(validatedPin);
      input.value = "";

      showAdminPanel();

      /*
        Si el gesto inicial consiguió abrir AudioContext,
        confirma con un sonido corto.
      */
      if (audioCtx?.state === "running") {
        playTonePattern(true);
        soundConfirmationPlayed = true;
      } else {
        refreshSoundState();
      }

      return true;
    } catch (loginError) {
      console.error("Acceso rechazado:", loginError);
      clearAdminSession({ forgetTrustedDevice: true });

      if (error) {
        error.hidden = false;
        error.textContent =
          adminLoginErrorMessage(loginError);
      }

      input.focus();
      input.select();
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  async function restoreTrustedSession() {
    const storedSession =
      readTrustedAdminSession();

    if (!storedSession) {
      input.focus();
      return false;
    }

    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    setLoginBusy(true, "Restaurando sesión…");

    try {
      /*
        El PIN guardado se vuelve a validar en admin-auth.
        Así, cambiar ADMIN_PIN en Supabase invalida el dispositivo.
      */
      const validatedPin =
        await validateAdminPin(storedSession.pin);

      adminPinInMemory = validatedPin;
      showAdminPanel();
      refreshSoundState();
      return true;
    } catch (restoreError) {
      console.warn(
        "No se pudo restaurar la sesión de 8 horas:",
        restoreError
      );

      clearAdminSession({ forgetTrustedDevice: true });

      if (error) {
        error.hidden = false;
        error.textContent =
          "La sesión guardada terminó o ya no es válida. Introduce el PIN.";
      }

      return false;
    } finally {
      setLoginBusy(false);
      if (!adminPinInMemory) input.focus();
    }
  }

  loginButton.addEventListener("click", tryLogin);
  form.addEventListener("submit", tryLogin);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      tryLogin(event);
    }
  });

  void restoreTrustedSession();
}

function init() {
  /*
    El acceso se conecta antes que cualquier preferencia o sección.
  */
  try {
    initKitchenGesturesAndMissingButton();
    initLogin();
  } catch (error) {
    showLoginRuntimeError(error);
    return;
  }

  try {
    applyAdminTheme();
  } catch (error) {
    console.warn("No se pudo aplicar el tema:", error);
    document.body.classList.add("dark-mode");
  }

  /*
    No cerramos la sesión al recargar ni al cerrar la pestaña.
    El dispositivo permanece validado durante un máximo de 8 horas.
  */

  const activateSoundFromGesture = () => {
    void unlockSound({
      playTest: !soundConfirmationPlayed,
      announce: !soundUnlocked
    }).then((unlocked) => {
      if (unlocked && newOrders().length) {
        startAlarm();
      }
    });
  };

  document.addEventListener(
    "pointerdown",
    activateSoundFromGesture,
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    activateSoundFromGesture,
    { passive: true }
  );

  document.addEventListener(
    "keydown",
    activateSoundFromGesture
  );

  const recoverAfterForeground = () => {
    if (document.hidden) return;

    refreshSoundState();
    void syncOrdersFromBackend();
    updateAlarm();
  };

  document.addEventListener(
    "visibilitychange",
    recoverAfterForeground
  );

  window.addEventListener(
    "pageshow",
    recoverAfterForeground
  );

  window.addEventListener(
    "focus",
    recoverAfterForeground
  );

  refreshSoundState();

  const orderModeBtn = $("#orderModeBtn");
  if (orderModeBtn) orderModeBtn.addEventListener("click", cycleOrderMode);

  const adminThemeBtn = $("#adminThemeToggleBtn");
  if (adminThemeBtn) adminThemeBtn.addEventListener("click", toggleAdminTheme);

  const clearOrdersBtn = $("#clearOrdersBtn");
  if (clearOrdersBtn) {
    clearOrdersBtn.addEventListener("click", async () => {
      if (confirm("¿Limpiar todos los pedidos? Esto también borra las comandas de cocina.")) {
        safeLocalSet(STORAGE_ORDERS, "[]");
        safeLocalSet(STORAGE_KITCHEN_HIDDEN, "[]");
        renderAll();

        if (window.FOGON_DB?.isReady()) {
          try {
            await window.FOGON_DB.clearOrders();
            await syncOrdersFromBackend();
          } catch (error) {
            console.warn("No se pudieron limpiar los pedidos en Supabase:", error);
          }
        }
      }
    });
  }

  const logoutButton = $("#adminLogoutBtn");
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      logoutAdmin();
    });
  }

  const soundBtn = $("#enableSoundBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      soundBtn.disabled = true;
      soundBtn.textContent = "Activando…";

      try {
        const unlocked = await unlockSound({
          playTest: true,
          announce: true
        });

        if (unlocked && newOrders().length) {
          startAlarm();
        }
      } finally {
        soundBtn.disabled = false;
        soundBtn.textContent =
          soundUnlocked
            ? "Probar sonido"
            : "Activar y probar sonido";
      }
    });
  }

  const availabilitySearch = $("#availabilitySearch");
  if (availabilitySearch) {
    availabilitySearch.addEventListener("input", (event) => {
      availabilityQuery = event.target.value;
      renderAvailability();
    });
  }

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-availability]");
    if (input) setAvailability(input.dataset.availability, input.checked);
  });

  document.addEventListener("click", (event) => {
    const orderToggle = event.target.closest("[data-toggle-order]");
    if (orderToggle) {
      event.preventDefault();
      toggleOrderCard(orderToggle.dataset.toggleOrder);
      return;
    }

    const tabButton = event.target.closest("[data-admin-tab]");
    if (tabButton) switchTab(tabButton.dataset.adminTab);

    const tabJumpButton = event.target.closest("[data-admin-tab-jump]");
    if (tabJumpButton) switchTab(tabJumpButton.dataset.adminTabJump);

    const acceptButton = event.target.closest("[data-accept-order]");
    if (acceptButton) acceptOrder(acceptButton.dataset.acceptOrder);

    const readyButton = event.target.closest("[data-ready-order]");
    if (readyButton) sendReadyNotification(readyButton.dataset.readyOrder);

    const kitchenDoneButton = event.target.closest("[data-kitchen-done]");
    if (kitchenDoneButton) hideKitchenOrder(kitchenDoneButton.dataset.kitchenDone);

    const cloverPayButton = event.target.closest("[data-clover-pay]");
    if (cloverPayButton) {
      event.preventDefault();
      startCloverPayment(cloverPayButton.dataset.cloverPay, { automatic: false });
    }

    const cashPayButton = event.target.closest("[data-cash-pay]");
    if (cashPayButton) {
      event.preventDefault();
      confirmCashPayment(cashPayButton.dataset.cashPay);
    }

    const hidePaidButton = event.target.closest("[data-hide-paid]");
    if (hidePaidButton) {
      event.preventDefault();
      hidePaidOrder(hidePaidButton.dataset.hidePaid);
    }

    const deliverButton = event.target.closest("[data-deliver-order]");
    if (deliverButton) removeOrderEverywhere(deliverButton.dataset.deliverOrder);
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_ORDERS || event.key === STORAGE_KITCHEN_HIDDEN || event.key === null) renderAll();
    if (event.key === STORAGE_AVAILABILITY || event.key === null) { renderAvailability(); renderOrderModeButton(); }
  });

  if (window.FOGON_DB?.isReady()) {
    window.FOGON_DB.subscribeOrders(() => syncOrdersFromBackend());
    window.FOGON_DB.subscribeAvailability(() => syncAvailabilityFromBackend());
  }

  setInterval(() => {
    if (!adminPinInMemory) return;

    const session = readTrustedAdminSession();

    if (!session) {
      logoutAdmin(
        "Han pasado 8 horas. Introduce nuevamente el PIN del panel."
      );
    }
  }, 30000);

  setInterval(() => {
    if (window.FOGON_DB?.isReady() || BACKEND_URL) {
      syncOrdersFromBackend();
    } else {
      updateElapsedLabels();
      updateAlarm();
    }
  }, 5000);

  setInterval(updateElapsedLabels, 30000);

  setInterval(() => {
    if (window.FOGON_DB?.isReady() || BACKEND_URL) syncAvailabilityFromBackend();
  }, 6000);
}
window.addEventListener("error", (event) => {
  if (event?.error) {
    showLoginRuntimeError(event.error);
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (event?.reason) {
    showLoginRuntimeError(event.reason);
  }
});

init();

})();
