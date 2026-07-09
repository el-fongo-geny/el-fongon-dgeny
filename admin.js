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

const pendingAvailabilityWrites = new Map();
const DAILY_MISSING_PHONE = "16507224407";

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
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Backend error ${response.status}`);
  }

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
      const availability = mergePendingAvailability(await db.fetchAvailability());
      writeLocalAvailability(availability);
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
      writeLocalAvailability(mergePendingAvailability(data.availability));
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
    body: JSON.stringify({
      status,
      ...extra
    })
  });
}

async function deleteOrderBackend(orderId) {
  const db = window.FOGON_DB;

  if (db?.isReady()) {
    await db.deleteOrder(orderId);
    return;
  }

  if (!BACKEND_URL) return;

  await backendRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "DELETE"
  });
}

function getAvailability() {
  return safeParse(STORAGE_AVAILABILITY, {});
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function mergePendingAvailability(availability) {
  const merged = {
    ...(availability || {})
  };

  pendingAvailabilityWrites.forEach((value, key) => {
    merged[key] = value;
  });

  return merged;
}

function writeLocalAvailability(availability) {
  localStorage.setItem(STORAGE_AVAILABILITY, JSON.stringify(availability || {}));
}

function availabilityValue(key, legacyKey = null) {
  const availability = getAvailability();

  if (hasOwn(availability, key)) {
    return availability[key] !== false;
  }

  if (legacyKey && hasOwn(availability, legacyKey)) {
    return availability[legacyKey] !== false;
  }

  return true;
}

function productAvailabilityKey(itemOrId) {
  const id = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
  return `product:${id}`;
}

function optionAvailabilityKey(group, option) {
  return `option:${group.id}:${option.id}`;
}

function extraAvailabilityKey(extra) {
  return `extra:${extra.id}`;
}

function removableAvailabilityKey(remove) {
  return `remove:${remove.id}`;
}

async function setAvailability(key, available, legacyKey = null) {
  const before = getAvailability();

  const next = {
    ...before,
    [key]: Boolean(available)
  };

  pendingAvailabilityWrites.set(key, Boolean(available));
  writeLocalAvailability(next);
  renderAvailability();

  const db = window.FOGON_DB;

  try {
    if (db?.isReady()) {
      await db.setAvailability(key, available);
    } else if (BACKEND_URL) {
      await backendRequest(`/api/availability/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          available
        })
      });
    }

    pendingAvailabilityWrites.delete(key);

    if (legacyKey && legacyKey !== key && hasOwn(before, legacyKey)) {
      const cleaned = getAvailability();
      delete cleaned[legacyKey];
      writeLocalAvailability(cleaned);
    }

    await syncAvailabilityFromBackend();
  } catch (error) {
    pendingAvailabilityWrites.delete(key);
    writeLocalAvailability(before);
    renderAvailability();

    console.warn("No se pudo guardar disponibilidad:", error);

    alert("No se pudo guardar el cambio de disponibilidad. Revisa Supabase/RLS y vuelve a intentarlo.");
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

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }

    const resumeResult = audioCtx.state === "suspended"
      ? audioCtx.resume()
      : Promise.resolve();

    Promise.resolve(resumeResult)
      .then(() => {
        soundUnlocked = audioCtx.state === "running";
        setSoundBanner();
      })
      .catch(() => {
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

  if (!soundUnlocked && banner) {
    banner.hidden = false;
  }

  if (alarmTimer) return;

  beep();

  alarmTimer = setInterval(() => {
    if (newOrders().length) {
      beep();
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
  const signature = pending.map((order) => order.id).join("|");

  if (pending.length) {
    if (signature !== lastNewOrderSignature) {
      beep();
    }

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
      ? {
          ...order,
          status: "accepted",
          acceptedAt
        }
      : order
  ));

  saveOrders(orders);

  try {
    await updateOrderStatusBackend(orderId, "accepted", {
      acceptedAt
    });

    await syncOrdersFromBackend();
  } catch (error) {
    console.warn("No se pudo actualizar pedido en Supabase:", error);
  }
}

async function markReady(orderId) {
  const readyAt = new Date().toISOString();

  const orders = getOrders().map((order) => (
    order.id === orderId
      ? {
          ...order,
          status: "ready",
          readyAt
        }
      : order
  ));

  saveOrders(orders);

  try {
    await updateOrderStatusBackend(orderId, "ready", {
      readyAt
    });

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

function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.length === 10) {
    return `1${digits}`;
  }

  return digits;
}

function readyMessage(order) {
  const name = order.customer?.name || "";

  if (order.language === "en") {
    return `Hi${name ? ` ${name}` : ""}, your order ${order.id} from El Fogon D' Geny is ready. Please pick it up at the truck window. Thank you.`;
  }

  return `Hola${name ? ` ${name}` : ""}, tu pedido ${order.id} de El Fogon D' Geny está listo. Pasa por la ventanilla del camión. Gracias.`;
}

async function sendReadyNotification(orderId) {
  const orders = getOrders();
  const order = orders.find((candidate) => candidate.id === orderId);

  if (!order) return;

  if (BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/orders/${encodeURIComponent(order.id)}/ready`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(order)
      });

      if (!response.ok) {
        throw new Error(`Backend error ${response.status}`);
      }

      const result = await response.json();

      const updatedOrders = getOrders().map((candidate) => (
        candidate.id === orderId
          ? {
              ...candidate,
              status: "ready",
              readyAt: new Date().toISOString(),
              whatsappSent: Boolean(result.whatsappSent),
              cloverOrderId: result.cloverOrderId || candidate.cloverOrderId || null
            }
          : candidate
      ));

      saveOrders(updatedOrders);

      alert("Cliente notificado y Clover sincronizado si las credenciales están configuradas.");
      return;
    } catch (error) {
      console.error(error);
      alert("No se pudo contactar el backend. Revisa la URL en backend-config.js o el servidor.");
      return;
    }
  }

  const phone = normalizePhoneForWhatsApp(order.customer?.phone);

  if (!phone) {
    alert("Este pedido no tiene teléfono válido para WhatsApp.");
    return;
  }

  markReady(orderId);

  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(readyMessage(order))}`, "_blank");
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

  ordersList.innerHTML = orders.length
    ? orders.map((order) => {
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
            <p><strong>Pago:</strong> ${escapeHtml(paymentLabel(order.paymentMethod))}</p>

            <div class="order-items">
              ${(order.items || []).map((item) => itemDetailsHtml(item)).join("")}
            </div>

            <div class="order-total">
              <span>Total</span>
              <strong>${money(order.totals?.total)}</strong>
            </div>

            ${isNew ? `
              <button class="primary-btn full accept-order" data-accept-order="${escapeHtml(order.id)}" type="button">
                Aceptar pedido y parar sonido
              </button>
            ` : `
              <p class="accepted-note">
                ${isReady ? "Pedido listo" : "Pedido aceptado"}${order.acceptedAt ? ` · ${new Date(order.acceptedAt).toLocaleTimeString()}` : ""}
              </p>
            `}

            <div class="order-actions-row">
              ${!isNew ? `
                <button class="secondary-btn" data-ready-order="${escapeHtml(order.id)}" type="button">
                  Pedido listo / WhatsApp
                </button>
              ` : ""}

              <button class="secondary-btn danger-btn" data-deliver-order="${escapeHtml(order.id)}" type="button">
                Entregado / quitar para todos
              </button>
            </div>
          </article>
        `;
      }).join("")
    : `<p class="empty-state">No hay pedidos todavía.</p>`;

  updateAlarm();
}

function renderKitchen() {
  const orders = getOrders();

  cleanKitchenHiddenIds(orders);

  const visibleOrders = kitchenOrders(orders);

  updateCounters();

  const kitchenList = $("#kitchenList");

  if (!kitchenList) return;

  kitchenList.innerHTML = visibleOrders.length
    ? visibleOrders.map((order) => `
        <article class="kitchen-order-card">
          <div class="kitchen-order-head">
            <strong>${escapeHtml(order.id)}</strong>
            <span>${statusLabel(order)}</span>
          </div>

          <div class="kitchen-items">
            ${(order.items || []).map((item) => itemDetailsHtml(item, true)).join("")}
          </div>

          <button class="secondary-btn full" data-kitchen-done="${escapeHtml(order.id)}" type="button">
            Terminado en cocina
          </button>
        </article>
      `).join("")
    : `<p class="empty-state">No hay comandas pendientes para cocina.</p>`;
}

function collectOptionAvailabilityRows() {
  const rowsByKey = new Map();

  function addRow(row) {
    if (!rowsByKey.has(row.key)) {
      rowsByKey.set(row.key, {
        ...row,
        usedBy: new Set(row.usedBy || [])
      });

      return;
    }

    const existing = rowsByKey.get(row.key);

    (row.usedBy || []).forEach((name) => {
      existing.usedBy.add(name);
    });
  }

  MENU_ITEMS.forEach((item) => {
    (item.optionGroups || []).forEach((group) => {
      (group.options || []).forEach((option) => {
        addRow({
          key: optionAvailabilityKey(group, option),
          kind: "option",
          es: option.es,
          en: option.en || option.es,
          detailEs: `Subopción · ${group.es}`,
          detailEn: `Option · ${group.en || group.es}`,
          usedBy: [item.es]
        });
      });
    });

    (item.extras || []).forEach((extra) => {
      addRow({
        key: extraAvailabilityKey(extra),
        kind: "extra",
        es: extra.es,
        en: extra.en || extra.es,
        detailEs: "Extra",
        detailEn: "Extra",
        usedBy: [item.es]
      });
    });

    (item.removables || []).forEach((remove) => {
      addRow({
        key: removableAvailabilityKey(remove),
        kind: "remove",
        es: remove.es,
        en: remove.en || remove.es,
        detailEs: "Opción para quitar ingrediente",
        detailEn: "Remove ingredient option",
        usedBy: [item.es]
      });
    });
  });

  return Array.from(rowsByKey.values())
    .map((row) => ({
      ...row,
      usedByList: Array.from(row.usedBy).sort()
    }))
    .sort((a, b) => a.es.localeCompare(b.es, "es"));
}

function rowMatchesQuery(row, query) {
  if (!query) return true;

  const haystack = [
    row.es,
    row.en,
    row.detailEs,
    row.detailEn,
    ...(row.usedByList || [])
  ].join(" ").toLowerCase();

  return haystack.includes(query);
}

function availabilityRowHtml(row) {
  const checked = availabilityValue(row.key, row.legacyKey);

  const usedBy = row.usedByList?.length
    ? `Usado en: ${row.usedByList.slice(0, 5).join(", ")}${row.usedByList.length > 5 ? "…" : ""}`
    : row.detailEn || "";

  const isPending = pendingAvailabilityWrites.has(row.key);

  return `
    <label class="availability-row ${row.kind === "product" ? "is-product" : "is-suboption"} ${isPending ? "is-pending" : ""}">
      <span>
        ${escapeHtml(row.es)}
        <small>${escapeHtml(row.detailEs || row.en || "")}</small>
        ${row.kind !== "product" ? `<small>${escapeHtml(usedBy)}</small>` : ""}
      </span>

      <input
        type="checkbox"
        data-availability-key="${escapeHtml(row.key)}"
        data-legacy-key="${escapeHtml(row.legacyKey || "")}"
        ${checked ? "checked" : ""}
        ${isPending ? "disabled" : ""}
      >
    </label>
  `;
}

function renderAvailability() {
  const query = availabilityQuery.trim().toLowerCase();
  const availabilityList = $("#availabilityList");

  if (!availabilityList) return;

  const allOptionRows = collectOptionAvailabilityRows();

  const optionRows = allOptionRows.filter((row) => rowMatchesQuery(row, query));

  const productRows = MENU_ITEMS.map((item) => ({
    key: productAvailabilityKey(item),
    legacyKey: item.id,
    kind: "product",
    es: item.es,
    en: item.en || item.es,
    detailEs: "Producto completo",
    detailEn: "Full product",
    usedByList: []
  })).filter((row) => rowMatchesQuery(row, query));

  const sections = [];

  if (optionRows.length) {
    sections.push(`
      <section class="availability-section availability-section-options">
        <h3>Subopciones, proteínas y extras <span>${optionRows.length}</span></h3>

        <p class="availability-note">
          Aquí puedes apagar opciones internas como “Pollo guisado”, “Bistec”, “Camarón”, “Aguacate extra”, acompañamientos y opciones para quitar ingredientes.
          Si apagas una opción, desaparece del modal del cliente en todos los productos donde se use.
        </p>

        ${optionRows.map(availabilityRowHtml).join("")}
      </section>
    `);
  }

  if (productRows.length) {
    sections.push(`
      <section class="availability-section availability-section-products">
        <h3>Productos completos <span>${productRows.length}</span></h3>

        <p class="availability-note">
          Aquí apagas un plato completo cuando no esté disponible.
        </p>

        ${productRows.map(availabilityRowHtml).join("")}
      </section>
    `);
  }

  if (!sections.length && allOptionRows.length) {
    availabilityList.innerHTML = `<p class="empty-state">No hay coincidencias con esa búsqueda. Borra el texto del buscador para ver productos y subopciones.</p>`;
    return;
  }

  availabilityList.innerHTML = sections.length
    ? sections.join("")
    : `<p class="empty-state">No se encontraron subopciones en menu-data.js. Revisa que admin.html cargue menu-data.js antes de admin.js.</p>`;
}

function getAllAvailabilityRowsForReport() {
  const productRows = MENU_ITEMS.map((item) => ({
    key: productAvailabilityKey(item),
    legacyKey: item.id,
    kind: "product",
    es: item.es,
    en: item.en || item.es,
    detailEs: "Producto completo",
    usedByList: []
  }));

  const optionRows = collectOptionAvailabilityRows();

  return [...productRows, ...optionRows];
}

function getMissingAvailabilityRows() {
  const availability = getAvailability();

  return getAllAvailabilityRowsForReport().filter((row) => {
    if (hasOwn(availability, row.key) && availability[row.key] === false) {
      return true;
    }

    if (row.legacyKey && hasOwn(availability, row.legacyKey) && availability[row.legacyKey] === false) {
      return true;
    }

    return false;
  });
}

function buildDailyMissingMessage() {
  const missing = getMissingAvailabilityRows();
  const now = new Date();

  if (!missing.length) {
    return [
      "El Fogon D' Geny - Recuento de faltantes",
      `Fecha: ${now.toLocaleDateString()}`,
      "",
      "No hay productos ni subopciones marcadas como agotadas."
    ].join("\n");
  }

  const products = missing.filter((row) => row.kind === "product");
  const suboptions = missing.filter((row) => row.kind !== "product");

  const lines = [
    "El Fogon D' Geny - Recuento de faltantes",
    `Fecha: ${now.toLocaleDateString()}`,
    "",
    "Productos completos agotados:"
  ];

  if (products.length) {
    products.forEach((row) => {
      lines.push(`- ${row.es}`);
    });
  } else {
    lines.push("- Ninguno");
  }

  lines.push("");
  lines.push("Subopciones / proteínas / extras agotados:");

  if (suboptions.length) {
    suboptions.forEach((row) => {
      const usedBy = row.usedByList?.length
        ? ` — usado en: ${row.usedByList.slice(0, 4).join(", ")}${row.usedByList.length > 4 ? "..." : ""}`
        : "";

      lines.push(`- ${row.es}${usedBy}`);
    });
  } else {
    lines.push("- Ninguna");
  }

  return lines.join("\n");
}

function sendDailyMissingReport() {
  const message = buildDailyMissingMessage();
  const url = `https://wa.me/${DAILY_MISSING_PHONE}?text=${encodeURIComponent(message)}`;

  window.open(url, "_blank");
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

    if (newOrders().length) {
      startAlarm();
    }
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

  if (loginButton) {
    loginButton.addEventListener("click", tryLogin);
  }

  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        tryLogin(event);
      }
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
  if (adminThemeBtn) {
    adminThemeBtn.addEventListener("click", toggleAdminTheme);
  }

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

      if (newOrders().length) {
        beep();
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
    const input = event.target.closest("[data-availability-key]");

    if (input) {
      setAvailability(input.dataset.availabilityKey, input.checked, input.dataset.legacyKey || null);
    }
  });

  document.addEventListener("click", (event) => {
    const dailyMissingButton = event.target.closest("#sendDailyMissingBtn");
    if (dailyMissingButton) {
      event.preventDefault();
      sendDailyMissingReport();
      return;
    }

    const tabButton = event.target.closest("[data-admin-tab]");
    if (tabButton) {
      switchTab(tabButton.dataset.adminTab);
      return;
    }

    const acceptButton = event.target.closest("[data-accept-order]");
    if (acceptButton) {
      acceptOrder(acceptButton.dataset.acceptOrder);
      return;
    }

    const readyButton = event.target.closest("[data-ready-order]");
    if (readyButton) {
      sendReadyNotification(readyButton.dataset.readyOrder);
      return;
    }

    const kitchenDoneButton = event.target.closest("[data-kitchen-done]");
    if (kitchenDoneButton) {
      hideKitchenOrder(kitchenDoneButton.dataset.kitchenDone);
      return;
    }

    const deliverButton = event.target.closest("[data-deliver-order]");
    if (deliverButton) {
      removeOrderEverywhere(deliverButton.dataset.deliverOrder);
      return;
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_ORDERS || event.key === STORAGE_KITCHEN_HIDDEN || event.key === null) {
      renderAll();
    }

    if (event.key === STORAGE_AVAILABILITY || event.key === null) {
      renderAvailability();
    }
  });

  if (window.FOGON_DB?.isReady()) {
    window.FOGON_DB.subscribeOrders(() => syncOrdersFromBackend());
    window.FOGON_DB.subscribeAvailability(() => syncAvailabilityFromBackend());
  }

  setInterval(() => {
    if (window.FOGON_DB?.isReady() || BACKEND_URL) {
      syncOrdersFromBackend();
    } else {
      renderOrders();
      renderKitchen();
    }
  }, 2500);

  setInterval(() => {
    if (window.FOGON_DB?.isReady() || BACKEND_URL) {
      syncAvailabilityFromBackend();
    }
  }, 6000);
}

init();
