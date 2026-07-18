const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const STORAGE_ORDERS = "fogon_orders";
const STORAGE_AVAILABILITY = "fogon_availability";
const STORAGE_KITCHEN_HIDDEN = "fogon_kitchen_hidden";
const STORAGE_ADMIN_THEME = "fogon_admin_theme";
const ADMIN_PIN = "5425";
const BACKEND_URL = (window.FOGON_BACKEND_URL || "").replace(/\/$/, "");

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
  const anonKey = String(cfg.anonKey || "");

  if (!supabaseUrl) {
    alert("Falta la URL de Supabase en supabase-config.js.");
    return;
  }

  const endpoint = `${supabaseUrl}/functions/v1/sms-gateway/api/order-ready`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(anonKey ? {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`
        } : {})
      },
      body: JSON.stringify({
        orderId: order.databaseId || order.id,
        publicId: Number(order.id) || null,
        adminPin: "5425"
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
      throw new Error(reason || "sms-gateway no confirmó la operación.");
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
        ? "Pedido listo. El SMS ya estaba en la cola y no se duplicó."
        : "Pedido listo. SMS añadido a la cola; el Android lo enviará automáticamente.");
      return;
    }

    const reasons = {
      invalid_phone: "el teléfono del cliente no es válido",
      empty_message: "el mensaje quedó vacío",
      queue_insert_failed: result?.sms?.detail || "no se pudo insertar en sms_queue"
    };
    const reason = reasons[result?.sms?.reason] || result?.sms?.reason || "causa desconocida";
    alert(`Pedido marcado como listo, pero el SMS no entró en la cola: ${reason}.`);
  } catch (error) {
    console.error("Error al llamar sms-gateway:", error);
    alert(`No se pudo contactar sms-gateway para enviar el SMS. ${error?.message || error}`);
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
  return `
    <div class="order-item-line">
      <strong>${escapeHtml(item.quantity)}x ${escapeHtml(item.name)}</strong>
      ${(item.selections || []).map((selection) => `<p>${escapeHtml(selection.group)}: ${escapeHtml(selection.name)}</p>`).join("")}
      ${(item.extras || []).map((extra) => `<p>Extra: ${escapeHtml(extra.name)} +${money(extra.price)}</p>`).join("")}
      ${(item.removables || []).map((remove) => `<p>${escapeHtml(remove)}</p>`).join("")}
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
  const items = MENU_ITEMS.filter((item) => {
    const haystack = `${item.es} ${item.en}`.toLowerCase();
    return haystack.includes(query);
  });
  const availabilityList = $("#availabilityList");
  if (!availabilityList) return;
  availabilityList.innerHTML = items.map((item) => {
    const available = availability[item.id] !== false;
    return `
      <label class="availability-row">
        <span>${escapeHtml(item.es)}<small>${escapeHtml(item.en)}</small></span>
        <input type="checkbox" data-availability="${escapeHtml(item.id)}" ${available ? "checked" : ""}>
      </label>
    `;
  }).join("");
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
  if (!form) {
    showAdminPanel();
    return;
  }

  function tryLogin(event) {
    if (event) event.preventDefault();
    unlockSound();
    const value = String(input?.value || "").trim();
    if (value !== ADMIN_PIN) {
      if (error) error.hidden = false;
      if (input) {
        input.focus();
        input.select();
      }
      return false;
    }
    if (error) error.hidden = true;
    sessionStorage.setItem("fogon_admin_unlocked", "true");
    showAdminPanel();
    beep();
    return true;
  }

  if (sessionStorage.getItem("fogon_admin_unlocked") === "true") {
    showAdminPanel();
    return;
  }

  form.addEventListener("submit", tryLogin);
  if (loginButton) loginButton.addEventListener("click", tryLogin);
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") tryLogin(event);
    });
    input.focus();
  }
}

function init() {
  applyAdminTheme();
  initLogin();

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
    if (event.key === STORAGE_AVAILABILITY || event.key === null) renderAvailability();
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
