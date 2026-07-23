const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const STORAGE_ORDERS = "fogon_orders";
const STORAGE_AVAILABILITY = "fogon_availability";
const STORAGE_KITCHEN_HIDDEN = "fogon_kitchen_hidden";
const STORAGE_ADMIN_THEME = "fogon_admin_theme";
const BACKEND_URL = (window.FOGON_BACKEND_URL || "").replace(/\/$/, "");

/*
  El PIN no aparece en el código público y no se guarda en el navegador.
  Supabase lo valida y permanece únicamente en memoria mientras la página
  continúa abierta.
*/
let adminPinInMemory = "";
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
  const theme = localStorage.getItem(STORAGE_ADMIN_THEME) || "dark";
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  document.body.classList.toggle("light-mode", !isDark);
  const btn = $("#adminThemeToggleBtn");
  if (btn) btn.textContent = isDark ? "Modo claro" : "Modo oscuro";
}

function toggleAdminTheme() {
  const isDark = document.body.classList.contains("dark-mode");
  localStorage.setItem(STORAGE_ADMIN_THEME, isDark ? "light" : "dark");
  applyAdminTheme();
}

function safeParse(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

function getOrders() {
  return safeParse(STORAGE_ORDERS, []);
}

function setOrders(orders) {
  localStorage.setItem(STORAGE_ORDERS, JSON.stringify(orders));
}

function saveOrders(orders) {
  setOrders(orders);
  renderAll();
}


function getSupabaseFunctionConfig() {
  const cfg = window.FOGON_SUPABASE || {};
  const supabaseUrl = String(cfg.url || "").replace(/\/$/, "");
  const anonKey = String(cfg.anonKey || "").trim();

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Faltan la URL o la anon key de Supabase en supabase-config.js."
    );
  }

  return { supabaseUrl, anonKey };
}

async function callAdminCatalog(action, adminPin, extraBody = {}) {
  const { supabaseUrl, anonKey } = getSupabaseFunctionConfig();
  const endpoint = `${supabaseUrl}/functions/v1/admin-catalog`;

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
      action,
      adminPin,
      ...extraBody
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

    const requestError = new Error(
      reason || "La función admin-catalog rechazó la solicitud."
    );

    requestError.status = response.status;
    requestError.payload = result;
    throw requestError;
  }

  return result;
}

async function validateAdminPin(pin) {
  const cleanPin = String(pin || "").trim();

  if (!cleanPin) {
    throw new Error("Escribe el PIN.");
  }

  await callAdminCatalog("list_catalog", cleanPin);
  return cleanPin;
}

function getAdminPinOrThrow() {
  if (!adminPinInMemory) {
    throw new Error(
      "La sesión de administrador terminó. Recarga la página e introduce el PIN nuevamente."
    );
  }

  return adminPinInMemory;
}

function clearAdminSession() {
  adminPinInMemory = "";
  sessionStorage.removeItem("fogon_admin_unlocked");
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
      localStorage.setItem(STORAGE_AVAILABILITY, JSON.stringify(availability));
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
      localStorage.setItem(STORAGE_AVAILABILITY, JSON.stringify(data.availability));
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
  localStorage.setItem(STORAGE_AVAILABILITY, JSON.stringify(availability));
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
  localStorage.setItem(STORAGE_KITCHEN_HIDDEN, JSON.stringify(Array.from(new Set(ids))));
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
  const menuItems = MENU_ITEMS.map((item) => ({
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



const catalogState = {
  catalog: {
    categories: [],
    products: [],
    optionGroups: [],
    options: [],
    extras: [],
    productExtras: [],
    removables: [],
    productRemovables: [],
    inventory: []
  },
  query: "",
  categoryId: "all",
  selectedProductId: null,
  creating: false,
  dirty: false,
  busy: false
};

function catalogCategoryName(categoryId) {
  const category = catalogState.catalog.categories.find(
    (candidate) => candidate.id === categoryId
  );

  return category?.name_es || categoryId || "Sin categoría";
}

function catalogSetBusy(busy) {
  catalogState.busy = Boolean(busy);

  const loading = $("#catalogLoading");
  if (loading) loading.hidden = !catalogState.busy;

  [
    "#refreshCatalogBtn",
    "#newProductBtn",
    "#saveProductBtn",
    "#deleteProductBtn",
    "#saveCategoryBtn"
  ].forEach((selector) => {
    const button = $(selector);
    if (button) button.disabled = catalogState.busy;
  });
}

function catalogSetDirty(dirty) {
  catalogState.dirty = Boolean(dirty);

  const status = $("#catalogSaveStatus");
  if (!status) return;

  status.dataset.state = catalogState.dirty ? "dirty" : "saved";
  status.textContent = catalogState.dirty ? "Cambios sin guardar" : "Todo guardado";
}

function showCatalogMessage(message, type = "success") {
  const box = $("#catalogMessage");
  if (!box) return;

  box.hidden = !message;
  box.textContent = message || "";
  box.dataset.type = type;

  clearTimeout(showCatalogMessage.timer);

  if (message) {
    showCatalogMessage.timer = setTimeout(() => {
      box.hidden = true;
    }, 4200);
  }
}

function catalogFilteredProducts() {
  const query = catalogState.query.trim().toLowerCase();

  return catalogState.catalog.products.filter((product) => {
    const categoryMatches =
      catalogState.categoryId === "all" ||
      product.category_id === catalogState.categoryId;

    const text = [
      product.name_es,
      product.name_en,
      product.description_es,
      product.description_en,
      catalogCategoryName(product.category_id)
    ].filter(Boolean).join(" ").toLowerCase();

    return categoryMatches && (!query || text.includes(query));
  });
}

function renderCatalogCategoryFilters() {
  const container = $("#catalogCategoryFilters");
  if (!container) return;

  const allCount = catalogState.catalog.products.length;

  const buttons = [
    {
      id: "all",
      label: "Todos los productos",
      count: allCount,
      active: true
    },
    ...catalogState.catalog.categories.map((category) => ({
      id: category.id,
      label: category.name_es,
      count: catalogState.catalog.products.filter(
        (product) => product.category_id === category.id
      ).length,
      active: category.active
    }))
  ];

  container.innerHTML = buttons.map((category) => `
    <button
      class="catalog-category-filter ${catalogState.categoryId === category.id ? "active" : ""}"
      type="button"
      data-catalog-category="${escapeHtml(category.id)}"
    >
      <span>
        ${escapeHtml(category.label)}
        ${category.active === false ? `<small>Inactiva</small>` : ""}
      </span>
      <strong>${category.count}</strong>
    </button>
  `).join("");
}

function renderCatalogProductList() {
  const container = $("#catalogProductList");
  const count = $("#catalogProductCount");
  if (!container) return;

  const products = catalogFilteredProducts();

  if (count) count.textContent = String(products.length);

  if (!products.length) {
    container.innerHTML = `
      <div class="catalog-list-empty">
        <strong>No encontramos productos</strong>
        <p>Prueba otra búsqueda o selecciona una categoría diferente.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = products.map((product) => {
    const selected = product.id === catalogState.selectedProductId;
    const unavailableClass = !product.active ? "is-inactive" : "";
    const hiddenClass = !product.visible ? "is-hidden-product" : "";

    return `
      <article
        class="catalog-product-card ${selected ? "selected" : ""} ${unavailableClass} ${hiddenClass}"
        data-catalog-product-card="${escapeHtml(product.id)}"
      >
        <button
          class="catalog-product-main"
          type="button"
          data-edit-catalog-product="${escapeHtml(product.id)}"
        >
          <span class="catalog-product-thumb">
            ${product.image_url
              ? `<img src="${escapeHtml(product.image_url)}" alt="" loading="lazy">`
              : `<span aria-hidden="true">🍽</span>`
            }
          </span>

          <span class="catalog-product-copy">
            <strong>${escapeHtml(product.name_es)}</strong>
            <small>${escapeHtml(catalogCategoryName(product.category_id))}</small>
            <span class="catalog-product-meta">
              <b>${money(product.base_price)}</b>
              ${!product.visible ? `<em>No visible</em>` : ""}
              ${!product.active ? `<em>Inactivo</em>` : ""}
            </span>
          </span>
        </button>

        <button
          class="catalog-visibility-btn"
          type="button"
          data-toggle-catalog-visibility="${escapeHtml(product.id)}"
          aria-label="${product.visible ? "Ocultar" : "Mostrar"} ${escapeHtml(product.name_es)}"
          title="${product.visible ? "Ocultar del menú" : "Mostrar en el menú"}"
        >
          ${product.visible ? "Visible" : "Oculto"}
        </button>
      </article>
    `;
  }).join("");
}

function renderProductCategorySelect(selectedCategoryId = "") {
  const select = $("#productCategory");
  if (!select) return;

  select.innerHTML = catalogState.catalog.categories.map((category) => `
    <option value="${escapeHtml(category.id)}" ${category.id === selectedCategoryId ? "selected" : ""}>
      ${escapeHtml(category.name_es)}${category.active === false ? " — inactiva" : ""}
    </option>
  `).join("");
}

function updateProductImagePreview() {
  const input = $("#productImageUrl");
  const image = $("#productImagePreview");
  const placeholder = $("#productImagePlaceholder");

  if (!input || !image || !placeholder) return;

  const url = String(input.value || "").trim();

  if (!url) {
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
    return;
  }

  image.onload = () => {
    image.hidden = false;
    placeholder.hidden = true;
  };

  image.onerror = () => {
    image.hidden = true;
    placeholder.hidden = false;
  };

  image.src = url;
}

function productOptionStats(productId) {
  const groups = catalogState.catalog.optionGroups.filter(
    (group) => group.product_id === productId
  );

  const groupIds = new Set(groups.map((group) => group.id));

  const options = catalogState.catalog.options.filter(
    (option) => groupIds.has(option.option_group_id)
  );

  const extraLinks = catalogState.catalog.productExtras.filter(
    (link) => link.product_id === productId
  );

  const removableLinks = catalogState.catalog.productRemovables.filter(
    (link) => link.product_id === productId
  );

  return {
    groups: groups.length,
    options: options.length,
    extras: extraLinks.length,
    removables: removableLinks.length
  };
}

function renderProductOptionsSummary(productId) {
  const container = $("#productOptionsSummary");
  if (!container) return;

  if (!productId) {
    container.innerHTML = `
      <span><strong>0</strong> grupos</span>
      <span><strong>0</strong> opciones</span>
      <span><strong>0</strong> extras</span>
      <span><strong>0</strong> removibles</span>
    `;
    return;
  }

  const stats = productOptionStats(productId);

  container.innerHTML = `
    <span><strong>${stats.groups}</strong> grupos</span>
    <span><strong>${stats.options}</strong> opciones</span>
    <span><strong>${stats.extras}</strong> extras</span>
    <span><strong>${stats.removables}</strong> removibles</span>
  `;
}

function showProductEditor(product = null, creating = false) {
  const empty = $("#catalogEditorEmpty");
  const form = $("#productEditorForm");
  if (!form) return;

  catalogState.creating = Boolean(creating);
  catalogState.selectedProductId = product?.id || null;

  if (empty) empty.hidden = true;
  form.hidden = false;

  $("#productOriginalId").value = product?.id || "";
  $("#productNameEs").value = product?.name_es || "";
  $("#productNameEn").value = product?.name_en || "";
  $("#productPrice").value = Number(product?.base_price || 0).toFixed(2);
  $("#productDescriptionEs").value = product?.description_es || "";
  $("#productDescriptionEn").value = product?.description_en || "";
  $("#productImageUrl").value = product?.image_url || "";
  $("#productVisible").checked = product ? product.visible !== false : true;
  $("#productActive").checked = product ? product.active !== false : true;
  $("#productTaxable").checked = product ? product.taxable !== false : true;
  $("#productFeatured").checked = Boolean(product?.featured);
  $("#productSortOrder").value = Number(product?.sort_order || 0);

  const defaultCategory =
    product?.category_id ||
    catalogState.categoryId !== "all" && catalogState.categoryId ||
    catalogState.catalog.categories.find((category) => category.active)?.id ||
    catalogState.catalog.categories[0]?.id ||
    "";

  renderProductCategorySelect(defaultCategory);

  $("#productEditorEyebrow").textContent = creating ? "Nuevo producto" : "Editar producto";
  $("#productEditorTitle").textContent = product?.name_es || "Nuevo producto";

  const badge = $("#productIdBadge");
  if (badge) {
    badge.textContent = product?.id || "El ID se creará automáticamente";
  }

  const deleteButton = $("#deleteProductBtn");
  if (deleteButton) deleteButton.hidden = creating || !product?.id;

  renderProductOptionsSummary(product?.id || "");
  updateProductImagePreview();
  catalogSetDirty(false);
  renderCatalogProductList();
}

function hideProductEditor() {
  const empty = $("#catalogEditorEmpty");
  const form = $("#productEditorForm");

  catalogState.selectedProductId = null;
  catalogState.creating = false;

  if (empty) empty.hidden = false;
  if (form) form.hidden = true;

  catalogSetDirty(false);
  renderCatalogProductList();
}

function getProductEditorPayload() {
  const nameEs = String($("#productNameEs")?.value || "").trim();
  const categoryId = String($("#productCategory")?.value || "").trim();
  const price = Number($("#productPrice")?.value || 0);

  if (!nameEs) {
    throw new Error("Escribe el nombre del producto en español.");
  }

  if (!categoryId) {
    throw new Error("Selecciona una categoría.");
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Escribe un precio válido.");
  }

  const payload = {
    categoryId,
    nameEs,
    nameEn: String($("#productNameEn")?.value || "").trim() || nameEs,
    descriptionEs: String($("#productDescriptionEs")?.value || "").trim(),
    descriptionEn: String($("#productDescriptionEn")?.value || "").trim(),
    basePrice: price,
    imageUrl: String($("#productImageUrl")?.value || "").trim(),
    visible: Boolean($("#productVisible")?.checked),
    active: Boolean($("#productActive")?.checked),
    taxable: Boolean($("#productTaxable")?.checked),
    featured: Boolean($("#productFeatured")?.checked),
    sortOrder: Number($("#productSortOrder")?.value || 0)
  };

  const originalId = String($("#productOriginalId")?.value || "").trim();
  if (originalId) payload.id = originalId;

  return payload;
}

async function loadCatalog(options = {}) {
  const keepSelection = options.keepSelection !== false;
  const previousSelection = keepSelection ? catalogState.selectedProductId : null;

  catalogSetBusy(true);

  try {
    const result = await callAdminCatalog(
      "list_catalog",
      getAdminPinOrThrow()
    );

    catalogState.catalog = {
      categories: result.catalog?.categories || [],
      products: result.catalog?.products || [],
      optionGroups: result.catalog?.optionGroups || [],
      options: result.catalog?.options || [],
      extras: result.catalog?.extras || [],
      productExtras: result.catalog?.productExtras || [],
      removables: result.catalog?.removables || [],
      productRemovables: result.catalog?.productRemovables || [],
      inventory: result.catalog?.inventory || []
    };

    renderCatalogCategoryFilters();
    renderCatalogProductList();

    if (previousSelection) {
      const selected = catalogState.catalog.products.find(
        (product) => product.id === previousSelection
      );

      if (selected) showProductEditor(selected, false);
      else hideProductEditor();
    }

    return catalogState.catalog;
  } catch (error) {
    console.error("No se pudo cargar el catálogo:", error);
    showCatalogMessage(
      `No se pudo cargar el menú. ${error?.message || error}`,
      "error"
    );
    throw error;
  } finally {
    catalogSetBusy(false);
  }
}

async function openMenuManager() {
  const panel = $("#adminPanel");
  const manager = $("#menuManager");

  if (!manager) return;

  if (panel) panel.hidden = true;
  manager.hidden = false;
  document.body.classList.add("menu-manager-open");
  window.scrollTo(0, 0);

  try {
    await loadCatalog({ keepSelection: false });
  } catch (_) {
    // El mensaje ya se muestra en la interfaz.
  }
}

function closeMenuManager() {
  if (
    catalogState.dirty &&
    !confirm("Hay cambios sin guardar. ¿Quieres salir y descartarlos?")
  ) {
    return;
  }

  const panel = $("#adminPanel");
  const manager = $("#menuManager");

  if (manager) manager.hidden = true;
  if (panel) panel.hidden = false;

  document.body.classList.remove("menu-manager-open");
  hideProductEditor();
  window.scrollTo(0, 0);
}

async function saveCurrentProduct(event) {
  if (event) event.preventDefault();

  catalogSetBusy(true);

  try {
    const product = getProductEditorPayload();
    const action = catalogState.creating ? "create_product" : "update_product";

    const result = await callAdminCatalog(
      action,
      getAdminPinOrThrow(),
      { product }
    );

    catalogState.selectedProductId = result.product?.id || product.id || null;
    catalogState.creating = false;
    catalogSetDirty(false);

    await loadCatalog({ keepSelection: true });
    showCatalogMessage("Producto guardado correctamente.", "success");
  } catch (error) {
    console.error("No se pudo guardar el producto:", error);
    showCatalogMessage(
      `No se pudo guardar. ${error?.message || error}`,
      "error"
    );
  } finally {
    catalogSetBusy(false);
  }
}

async function deleteCurrentProduct() {
  const productId = String($("#productOriginalId")?.value || "").trim();
  if (!productId) return;

  const product = catalogState.catalog.products.find(
    (candidate) => candidate.id === productId
  );

  if (
    !confirm(
      `¿Eliminar definitivamente "${product?.name_es || productId}"?\n\nSi solo quieres retirarlo temporalmente, usa el interruptor "Visible en el menú".`
    )
  ) {
    return;
  }

  catalogSetBusy(true);

  try {
    await callAdminCatalog(
      "delete_product",
      getAdminPinOrThrow(),
      { productId }
    );

    hideProductEditor();
    await loadCatalog({ keepSelection: false });
    showCatalogMessage("Producto eliminado.", "success");
  } catch (error) {
    console.error("No se pudo eliminar el producto:", error);
    showCatalogMessage(
      `No se pudo eliminar. ${error?.message || error}`,
      "error"
    );
  } finally {
    catalogSetBusy(false);
  }
}

async function toggleCatalogProductVisibility(productId) {
  const product = catalogState.catalog.products.find(
    (candidate) => candidate.id === productId
  );

  if (!product) return;

  catalogSetBusy(true);

  try {
    await callAdminCatalog(
      "set_product_visibility",
      getAdminPinOrThrow(),
      {
        productId,
        visible: !product.visible
      }
    );

    await loadCatalog({ keepSelection: true });
    showCatalogMessage(
      product.visible
        ? "Producto ocultado del catálogo."
        : "Producto visible nuevamente.",
      "success"
    );
  } catch (error) {
    console.error("No se pudo cambiar la visibilidad:", error);
    showCatalogMessage(
      `No se pudo cambiar la visibilidad. ${error?.message || error}`,
      "error"
    );
  } finally {
    catalogSetBusy(false);
  }
}

function openCategoryEditor() {
  const modal = $("#categoryEditorModal");
  const select = $("#categoryEditorSelect");
  if (!modal || !select) return;

  select.innerHTML = catalogState.catalog.categories.map((category) => `
    <option value="${escapeHtml(category.id)}">${escapeHtml(category.name_es)}</option>
  `).join("");

  modal.hidden = false;
  document.body.classList.add("catalog-modal-open");
  fillCategoryEditor(select.value);
}

function closeCategoryEditor() {
  const modal = $("#categoryEditorModal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("catalog-modal-open");
}

function fillCategoryEditor(categoryId) {
  const category = catalogState.catalog.categories.find(
    (candidate) => candidate.id === categoryId
  );

  if (!category) return;

  $("#categoryNameEs").value = category.name_es || "";
  $("#categoryNameEn").value = category.name_en || "";
  $("#categorySortOrder").value = Number(category.sort_order || 0);
  $("#categoryActive").checked = category.active !== false;
}

async function saveCurrentCategory() {
  const categoryId = String($("#categoryEditorSelect")?.value || "").trim();
  if (!categoryId) return;

  catalogSetBusy(true);

  try {
    await callAdminCatalog(
      "update_category",
      getAdminPinOrThrow(),
      {
        category: {
          id: categoryId,
          nameEs: String($("#categoryNameEs")?.value || "").trim(),
          nameEn: String($("#categoryNameEn")?.value || "").trim(),
          sortOrder: Number($("#categorySortOrder")?.value || 0),
          active: Boolean($("#categoryActive")?.checked)
        }
      }
    );

    await loadCatalog({ keepSelection: true });
    closeCategoryEditor();
    showCatalogMessage("Categoría guardada correctamente.", "success");
  } catch (error) {
    console.error("No se pudo guardar la categoría:", error);
    showCatalogMessage(
      `No se pudo guardar la categoría. ${error?.message || error}`,
      "error"
    );
  } finally {
    catalogSetBusy(false);
  }
}

function initCatalogManager() {
  const openButton = $("#openMenuManagerBtn");
  const closeButton = $("#closeMenuManagerBtn");
  const refreshButton = $("#refreshCatalogBtn");
  const newButtons = [$("#newProductBtn"), $("#emptyNewProductBtn")].filter(Boolean);
  const search = $("#catalogSearch");
  const form = $("#productEditorForm");
  const imageInput = $("#productImageUrl");
  const cancelButton = $("#cancelProductChangesBtn");
  const deleteButton = $("#deleteProductBtn");
  const manageCategoriesButton = $("#manageCategoriesBtn");
  const categorySelect = $("#categoryEditorSelect");
  const saveCategoryButton = $("#saveCategoryBtn");

  if (openButton) openButton.addEventListener("click", openMenuManager);
  if (closeButton) closeButton.addEventListener("click", closeMenuManager);

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      if (
        catalogState.dirty &&
        !confirm("Hay cambios sin guardar. ¿Quieres actualizar y descartarlos?")
      ) {
        return;
      }

      loadCatalog({ keepSelection: true }).catch(() => {});
    });
  }

  newButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (
        catalogState.dirty &&
        !confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")
      ) {
        return;
      }

      showProductEditor(null, true);
    });
  });

  if (search) {
    search.addEventListener("input", (event) => {
      catalogState.query = event.target.value;
      renderCatalogProductList();
    });
  }

  if (form) {
    form.addEventListener("submit", saveCurrentProduct);

    form.addEventListener("input", () => {
      catalogSetDirty(true);

      const name = String($("#productNameEs")?.value || "").trim();
      $("#productEditorTitle").textContent = name || "Nuevo producto";
    });

    form.addEventListener("change", () => catalogSetDirty(true));
  }

  if (imageInput) {
    imageInput.addEventListener("input", updateProductImagePreview);
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      if (
        catalogState.dirty &&
        !confirm("¿Descartar los cambios de este producto?")
      ) {
        return;
      }

      if (catalogState.creating) {
        hideProductEditor();
        return;
      }

      const product = catalogState.catalog.products.find(
        (candidate) => candidate.id === catalogState.selectedProductId
      );

      if (product) showProductEditor(product, false);
    });
  }

  if (deleteButton) deleteButton.addEventListener("click", deleteCurrentProduct);
  if (manageCategoriesButton) manageCategoriesButton.addEventListener("click", openCategoryEditor);

  if (categorySelect) {
    categorySelect.addEventListener("change", (event) => {
      fillCategoryEditor(event.target.value);
    });
  }

  if (saveCategoryButton) {
    saveCategoryButton.addEventListener("click", saveCurrentCategory);
  }

  document.addEventListener("click", (event) => {
    const categoryButton = event.target.closest("[data-catalog-category]");
    if (categoryButton) {
      catalogState.categoryId = categoryButton.dataset.catalogCategory || "all";
      renderCatalogCategoryFilters();
      renderCatalogProductList();
      return;
    }

    const productButton = event.target.closest("[data-edit-catalog-product]");
    if (productButton) {
      if (
        catalogState.dirty &&
        !confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")
      ) {
        return;
      }

      const productId = productButton.dataset.editCatalogProduct;
      const product = catalogState.catalog.products.find(
        (candidate) => candidate.id === productId
      );

      if (product) showProductEditor(product, false);
      return;
    }

    const visibilityButton = event.target.closest("[data-toggle-catalog-visibility]");
    if (visibilityButton) {
      toggleCatalogProductVisibility(
        visibilityButton.dataset.toggleCatalogVisibility
      );
      return;
    }

    if (event.target.closest("[data-close-category-modal]")) {
      closeCategoryEditor();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!catalogState.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}


function showAdminPanel() {
  const login = $("#adminLogin");
  const panel = $("#adminPanel");
  const manager = $("#menuManager");
  if (login) {
    login.hidden = true;
    login.style.display = "none";
  }
  if (panel) {
    panel.hidden = false;
    panel.style.display = "";
  }
  if (manager) manager.hidden = true;
  document.body.classList.remove("menu-manager-open");
  unlockSound();
  setTimeout(() => {
    unlockSound();
    if (newOrders().length) startAlarm();
  }, 150);
  renderAll();
  syncOrdersFromBackend();
  syncAvailabilityFromBackend();
}

function initLogin() {
  const form = $("#pinForm");
  const input = $("#pinInput");
  const loginButton = $("#loginButton");
  const error = $("#pinError");

  clearAdminSession();

  if (!form || !input) {
    console.error("Falta el formulario de acceso del administrador.");
    return;
  }

  async function tryLogin(event) {
    if (event) event.preventDefault();
    unlockSound();

    const value = String(input.value || "").trim();

    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "Comprobando...";
    }

    input.disabled = true;

    try {
      const validatedPin = await validateAdminPin(value);
      adminPinInMemory = validatedPin;
      input.value = "";

      showAdminPanel();
      beep();
      return true;
    } catch (loginError) {
      console.error("Acceso administrativo rechazado:", loginError);

      if (error) {
        error.hidden = false;
        error.textContent =
          loginError?.status === 401
            ? "PIN incorrecto."
            : `No se pudo validar el PIN. ${loginError?.message || loginError}`;
      }

      input.focus();
      input.select();
      return false;
    } finally {
      input.disabled = false;

      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Entrar";
      }
    }
  }

  form.addEventListener("submit", tryLogin);

  if (loginButton) {
    loginButton.addEventListener("click", tryLogin);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") tryLogin(event);
  });

  input.focus();
}

function init() {
  applyAdminTheme();
  initLogin();
  initCatalogManager();

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
        localStorage.setItem(STORAGE_ORDERS, "[]");
        localStorage.setItem(STORAGE_KITCHEN_HIDDEN, "[]");
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

init();
