const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const fallbackStorage = new Map();

function safeLocalGet(key) {
  try {
    const value = window.safeLocalGet(key);

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

window.FOGON_ADMIN_BUILD = "47-login-first";


const STORAGE_ORDERS = "fogon_orders";
const STORAGE_AVAILABILITY = "fogon_availability";
const STORAGE_KITCHEN_HIDDEN = "fogon_kitchen_hidden";
const STORAGE_ADMIN_THEME = "fogon_admin_theme";
/* El PIN no está escrito en el código público. */
let adminPinInMemory = "";
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
let lastNewOrderSignature = "";

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
  if (!adminPinInMemory) throw new Error("La sesión terminó. Recarga e introduce el PIN nuevamente.");
  return adminPinInMemory;
}

function clearAdminSession() {
  adminPinInMemory = "";
  safeSessionRemove("fogon_admin_unlocked");
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
    id: String(row.id),
    createdAt: row.created_at || row.createdAt || row.raw?.createdAt || new Date().toISOString(),
    customer: row.customer || row.raw?.customer || {},
    items: row.items || row.raw?.items || [],
    totals: row.totals || row.raw?.totals || {},
    paymentMethod: row.payment_method || row.raw?.paymentMethod || "",
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

  if (db?.isReady()) {
    try {
      const orders = await db.fetchOrders();
      setOrders(orders);
      renderAll();
    } catch (error) {
      console.warn("No se pudieron sincronizar pedidos desde Supabase:", error);
    }
    return;
  }

  if (!BACKEND_URL) return;
  try {
    const data = await backendRequest("/api/orders");
    const orders = (data?.orders || []).map(orderFromBackend).filter(Boolean);
    setOrders(orders);
    renderAll();
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

function hideKitchenOrder(orderId) {
  const ids = getKitchenHiddenIds();
  setKitchenHiddenIds([...ids, orderId]);
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

function setSoundBanner(message = "") {
  const banner = $("#soundBanner");
  if (!banner) return;
  const text = banner.querySelector("p");
  if (message && text) text.innerHTML = message;
  banner.hidden = Boolean(soundUnlocked);
}

function unlockSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      soundUnlocked = false;
      setSoundBanner("<strong>Sonido no disponible</strong><br>Este navegador no permite Web Audio.");
      return false;
    }
    if (!audioCtx) audioCtx = new AudioContextClass();

    const resumeResult = audioCtx.state === "suspended" ? audioCtx.resume() : Promise.resolve();
    Promise.resolve(resumeResult).then(() => {
      soundUnlocked = audioCtx.state === "running";
      setSoundBanner();
    }).catch(() => {
      soundUnlocked = false;
      setSoundBanner("<strong>Activa el sonido</strong><br>Toca el panel una vez. El navegador bloqueó el audio hasta una interacción.");
    });

    soundUnlocked = audioCtx.state === "running" || audioCtx.state === "suspended";
    setSoundBanner();
    return true;
  } catch (_) {
    soundUnlocked = false;
    setSoundBanner("<strong>Activa el sonido</strong><br>Toca el panel una vez. El navegador bloqueó el audio hasta una interacción.");
    return false;
  }
}

function beep() {
  if (!soundUnlocked && !unlockSound()) return;
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.65, now + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    master.connect(audioCtx.destination);

    [0, 0.18, 0.36].forEach((offset, index) => {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(index % 2 === 0 ? 920 : 720, now + offset);
      osc.connect(master);
      osc.start(now + offset);
      osc.stop(now + offset + 0.16);
    });
  } catch (_) {}
}

function startAlarm() {
  const banner = $("#soundBanner");
  if (!soundUnlocked && banner) banner.hidden = false;
  if (alarmTimer) return;
  beep();
  alarmTimer = setInterval(() => {
    if (newOrders().length) beep();
    else stopAlarm();
  }, 1200);
}

function stopAlarm() {
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = null;
}

function updateAlarm() {
  const pending = newOrders();
  const signature = pending.map((order) => order.id).join("|");
  if (pending.length) {
    if (signature !== lastNewOrderSignature) beep();
    startAlarm();
  } else {
    stopAlarm();
  }
  lastNewOrderSignature = signature;
}

async function acceptOrder(orderId) {
  const acceptedAt = new Date().toISOString();
  const orders = getOrders().map((order) => (
    order.id === orderId
      ? { ...order, status: "accepted", acceptedAt }
      : order
  ));
  saveOrders(orders);
  try {
    await updateOrderStatusBackend(orderId, "accepted", { acceptedAt });
    await syncOrdersFromBackend();
  } catch (error) {
    console.warn("No se pudo actualizar pedido en Supabase:", error);
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
  if (!confirm(`¿Marcar ${orderId} como entregado y quitarlo para todos?`)) return;
  const orders = getOrders().filter((order) => order.id !== orderId);
  setOrders(orders);
  const hidden = getKitchenHiddenIds().filter((id) => id !== orderId);
  setKitchenHiddenIds(hidden);
  renderAll();
  try {
    await deleteOrderBackend(orderId);
    await syncOrdersFromBackend();
  } catch (error) {
    console.warn("No se pudo quitar el pedido en Supabase:", error);
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
  const order = orders.find((candidate) => String(candidate.id) === String(orderId));
  if (!order) return;

  const cfg = window.FOGON_SUPABASE || {};
  const supabaseUrl = String(cfg.url || "").replace(/\/$/, "");
  const anonKey = String(cfg.anonKey || "").trim();

  if (!supabaseUrl || !anonKey) {
    alert("Faltan la URL o la anon key de Supabase en supabase-config.js.");
    return;
  }

  /*
    rapid-action es la funcion que marca el pedido listo y crea la fila en
    sms_queue. sms-gateway queda reservado para la APK Android: heartbeat,
    claim y result.
  */
  const endpoint = `${supabaseUrl}/functions/v1/rapid-action`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": anonKey,
        "Authorization": `Bearer ${anonKey}`
      },
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
        result?.detail
      ].filter(Boolean).join(" · ");
      throw new Error(reason || "rapid-action no confirmo la operacion.");
    }

    const updatedOrders = getOrders().map((candidate) => (
      String(candidate.id) === String(orderId)
        ? {
            ...candidate,
            status: "ready",
            readyAt: new Date().toISOString(),
            smsQueued: Boolean(result?.sms?.queued || candidate.smsQueued)
          }
        : candidate
    ));
    saveOrders(updatedOrders);
    await syncOrdersFromBackend();

    if (result?.sms?.queued) {
      alert(result.sms.alreadyQueued
        ? "Mensaje bloqueado porque ya se envio otro para este pedido durante los ultimos 30 segundos."
        : "Pedido listo. SMS anadido a la cola; el Android lo enviara automaticamente.");
      return;
    }

    const reasons = {
      invalid_phone: "el telefono del cliente no es valido",
      empty_message: "el mensaje quedo vacio",
      queue_insert_failed: result?.sms?.detail || "no se pudo insertar en sms_queue"
    };
    const reason = reasons[result?.sms?.reason] || result?.sms?.reason || "causa desconocida";
    alert(`Pedido marcado como listo, pero el SMS no entro en la cola: ${reason}.`);
  } catch (error) {
    console.error("Error al llamar rapid-action:", error);
    alert(`No se pudo ejecutar rapid-action para enviar el SMS. ${error?.message || error}`);
  }
}

function orderTypeLabel(type) {
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

  const orderCount = $("#orderCount");
  const pendingCount = $("#pendingCount");
  const kitchenCount = $("#kitchenCount");
  const kitchenVisibleCount = $("#kitchenVisibleCount");

  if (orderCount) orderCount.textContent = orders.length;
  if (pendingCount) pendingCount.textContent = pending.length;
  if (kitchenCount) kitchenCount.textContent = kitchen.length;
  if (kitchenVisibleCount) kitchenVisibleCount.textContent = kitchen.length;
}

function renderOrders() {
  const orders = getOrders();
  updateCounters();

  const ordersList = $("#ordersList");
  if (!ordersList) return;

  ordersList.innerHTML = orders.length ? orders.map((order) => {
    const isNew = order.status === "new" || !order.status;
    const isReady = order.status === "ready";
    return `
    <article class="order-card ${isNew ? "is-new" : "is-accepted"}">
      <div class="order-head">
        <div>
          <strong>${escapeHtml(order.id)}</strong>
          <p>${new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <span class="order-status ${statusClass(order)}">${statusLabel(order)}</span>
      </div>
      <p><strong>${escapeHtml(order.customer?.name || "Sin nombre")}</strong> · ${escapeHtml(order.customer?.phone || "Sin teléfono")}</p>
      <p><strong>Tipo:</strong> ${escapeHtml(orderTypeLabel(order.orderType || ((order.items || [])[0] || {}).orderType))}</p>
      <p><strong>Pago:</strong> ${escapeHtml(paymentLabel(order.paymentMethod))}</p>
      <div class="order-items">
        ${(order.items || []).map((item) => itemDetailsHtml(item)).join("")}
      </div>
      <div class="order-total">
        <span>Total</span>
        <strong>${money(order.totals?.total)}</strong>
      </div>
      ${isNew ? `<button class="primary-btn full accept-order" data-accept-order="${escapeHtml(order.id)}" type="button">Aceptar pedido y parar sonido</button>` : `<p class="accepted-note">${isReady ? "Pedido listo" : "Pedido aceptado"}${order.acceptedAt ? ` · ${new Date(order.acceptedAt).toLocaleTimeString()}` : ""}</p>`}
      <div class="order-actions-row">
        ${!isNew ? `<button class="secondary-btn" data-ready-order="${escapeHtml(order.id)}" type="button">Pedido listo / Enviar SMS</button>` : ""}
        <button class="secondary-btn danger-btn" data-deliver-order="${escapeHtml(order.id)}" type="button">Entregado / quitar para todos</button>
      </div>
    </article>`;
  }).join("") : `<p class="empty-state">No hay pedidos todavía.</p>`;

  updateAlarm();
}

function renderKitchen() {
  const orders = getOrders();
  cleanKitchenHiddenIds(orders);
  const visibleOrders = kitchenOrders(orders);
  updateCounters();

  const kitchenList = $("#kitchenList");
  if (!kitchenList) return;

  kitchenList.innerHTML = visibleOrders.length ? visibleOrders.map((order) => `
    <article class="kitchen-order-card">
      <div class="kitchen-order-head">
        <strong>${escapeHtml(order.id)}</strong>
        <span>${statusLabel(order)}</span>
      </div>
      <div class="kitchen-items">
        ${(order.items || []).map((item) => itemDetailsHtml(item, true)).join("")}
      </div>
      <button class="secondary-btn full" data-kitchen-done="${escapeHtml(order.id)}" type="button">Terminado en cocina</button>
    </article>
  `).join("") : `<p class="empty-state">No hay comandas pendientes para cocina.</p>`;
}

function renderAvailability() {
  const availability = getAvailability();
  const query = availabilityQuery.trim().toLowerCase();
  const menuSource =
    typeof MENU_ITEMS !== "undefined" && Array.isArray(MENU_ITEMS)
      ? MENU_ITEMS
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
      unlockSound();
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
  }, 0);
}

function initLogin() {
  const form = $("#pinForm");
  const input = $("#pinInput");
  const loginButton = $("#loginButton");
  const error = $("#pinError");

  clearAdminSession();

  if (!form || !input || !loginButton) {
    showLoginRuntimeError(
      new Error("Faltan elementos del formulario de acceso.")
    );

    return;
  }

  let loginRunning = false;

  async function tryLogin(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (loginRunning) {
      return false;
    }

    loginRunning = true;

    const value = String(input.value || "").trim();

    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    input.disabled = true;
    loginButton.disabled = true;
    loginButton.textContent = "Comprobando…";

    try {
      const validatedPin = await validateAdminPin(value);

      adminPinInMemory = validatedPin;
      input.value = "";

      showAdminPanel();
      return true;
    } catch (loginError) {
      console.error("Acceso rechazado:", loginError);

      if (error) {
        error.hidden = false;
        error.textContent =
          adminLoginErrorMessage(loginError);
      }

      input.focus();
      input.select();
      return false;
    } finally {
      loginRunning = false;
      input.disabled = false;
      loginButton.disabled = false;
      loginButton.textContent = "Entrar";
    }
  }

  loginButton.addEventListener("click", tryLogin);
  form.addEventListener("submit", tryLogin);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      tryLogin(event);
    }
  });

  input.focus();
}

function init() {
  /*
    El acceso se conecta antes que cualquier preferencia o sección.
  */
  try {
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

  window.addEventListener("pagehide", clearAdminSession);

  document.addEventListener("pointerdown", unlockSound);
  document.addEventListener("keydown", unlockSound);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unlockSound();
      updateAlarm();
    }
  });

  const banner = $("#soundBanner");
  if (banner) banner.hidden = true;

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

  const soundBtn = $("#enableSoundBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      unlockSound();
      if (newOrders().length) beep();
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
    const tabButton = event.target.closest("[data-admin-tab]");
    if (tabButton) switchTab(tabButton.dataset.adminTab);

    const acceptButton = event.target.closest("[data-accept-order]");
    if (acceptButton) acceptOrder(acceptButton.dataset.acceptOrder);

    const readyButton = event.target.closest("[data-ready-order]");
    if (readyButton) sendReadyNotification(readyButton.dataset.readyOrder);

    const kitchenDoneButton = event.target.closest("[data-kitchen-done]");
    if (kitchenDoneButton) hideKitchenOrder(kitchenDoneButton.dataset.kitchenDone);

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
    if (window.FOGON_DB?.isReady() || BACKEND_URL) syncOrdersFromBackend();
    else {
      renderOrders();
      renderKitchen();
    }
  }, 2500);

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
