window.FOGON_MENU_BUILD = "97-counter-mode-authoritative";

const state = {
  lang: localStorage.getItem("fogon_lang") || "",
  category: Array.isArray(CATEGORIES) && CATEGORIES.length ? CATEGORIES[0].id : "",
  cart: [],
  currentProduct: null,
  pendingOrder: null,
  orderType: "",
  activeKioskPayment: null,
  theme: localStorage.getItem("fogon_theme") || "light",
  cartFabCompact: false
};

let lastScrollY = window.scrollY || 0;
let scrollRevealLockUntil = 0;

const STORAGE_ORDERS = "fogon_orders";
const STORAGE_ORDER_COUNTER = "fogon_order_counter";
const BACKEND_URL = (window.FOGON_BACKEND_URL || "").replace(/\/$/, "");
const ORDER_MODE_MANUAL_KEY = "system:orders-manual";
const ORDER_MODE_OPEN_KEY = "system:orders-open";
let orderSubmissionInProgress = false;
const CALIFORNIA_TIME_ZONE = "America/Los_Angeles";
const DEFAULT_WEEKLY_SCHEDULE = {
  "0": { open: true, start: "11:00", end: "20:30" },
  "1": { open: true, start: "11:00", end: "20:30" },
  "2": { open: false, start: "11:00", end: "20:30" },
  "3": { open: true, start: "11:00", end: "20:30" },
  "4": { open: true, start: "11:00", end: "20:30" },
  "5": { open: true, start: "11:00", end: "20:30" },
  "6": { open: true, start: "11:00", end: "20:30" }
};
let publicWeeklySchedule = { ...DEFAULT_WEEKLY_SCHEDULE };

function uniqueCartLineId(productId) {
  if (window.crypto?.randomUUID) return `${productId}-${window.crypto.randomUUID()}`;
  return `${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


function californiaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALIFORNIA_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const shortDay = parts.find((part) => part.type === "weekday")?.value || "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);

  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(shortDay),
    minutes: hour * 60 + minute
  };
}

function timeStringToMinutes(value, fallback = 0) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}

function normalizeWeeklySchedule(schedule) {
  const source = schedule && typeof schedule === "object" ? schedule : {};

  return Object.fromEntries(
    Object.entries(DEFAULT_WEEKLY_SCHEDULE).map(([day, fallback]) => {
      const candidate = source[day] && typeof source[day] === "object"
        ? source[day]
        : {};

      return [
        day,
        {
          open: candidate.open !== false,
          start: /^\d{2}:\d{2}$/.test(String(candidate.start || ""))
            ? String(candidate.start)
            : fallback.start,
          end: /^\d{2}:\d{2}$/.test(String(candidate.end || ""))
            ? String(candidate.end)
            : fallback.end
        }
      ];
    })
  );
}

function currentScheduleDay(date = new Date()) {
  const now = californiaDateParts(date);
  const day = publicWeeklySchedule[String(now.weekday)]
    || DEFAULT_WEEKLY_SCHEDULE[String(now.weekday)];

  return {
    ...day,
    weekday: now.weekday,
    minutes: now.minutes
  };
}

function scheduleDayIsOpen(day) {
  if (!day?.open) return false;

  const start = timeStringToMinutes(day.start, 11 * 60);
  const end = timeStringToMinutes(day.end, 20 * 60 + 30);
  const now = day.minutes;

  if (start === end) return true;
  if (end > start) return now >= start && now < end;

  // Horarios que cruzan medianoche.
  return now >= start || now < end;
}

function californiaMinutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALIFORNIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function californiaWeekdayNow(date = new Date()) {
  const shortDay = new Intl.DateTimeFormat("en-US", {
    timeZone: CALIFORNIA_TIME_ZONE,
    weekday: "short"
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(shortDay);
}

function currentOrderingState() {
  const availability = getAvailability();
  const manual = availability[ORDER_MODE_MANUAL_KEY] === true;
  const forcedOpen = availability[ORDER_MODE_OPEN_KEY] === true;
  const scheduleDay = currentScheduleDay();
  const automaticOpen = scheduleDayIsOpen(scheduleDay);

  return {
    mode: manual ? (forcedOpen ? "open" : "closed") : "auto",
    open: manual ? forcedOpen : automaticOpen,
    weeklyClosed: !manual && scheduleDay.open === false,
    scheduleDay
  };
}

function orderingClosedMessage() {
  const status = currentOrderingState();
  const day = status.scheduleDay;

  if (status.weeklyClosed) {
    return state.lang === "en"
      ? "Online ordering is closed all day today."
      : "Los pedidos en línea están cerrados durante todo el día de hoy.";
  }

  if (status.mode === "closed") {
    return state.lang === "en"
      ? "Online ordering was manually closed by the restaurant."
      : "Los pedidos en línea fueron cerrados manualmente por el restaurante.";
  }

  return state.lang === "en"
    ? `Online ordering is currently closed. Today's hours are ${day.start}–${day.end}, California time.`
    : `Los pedidos en línea están cerrados ahora mismo. El horario de hoy es de ${day.start} a ${day.end}, hora de California.`;
}

function updateOrderingUi() {
  const status = currentOrderingState();
  const submit = document.querySelector('#checkoutForm button[type="submit"]');
  if (submit) {
    submit.disabled = !status.open;
    submit.setAttribute("aria-disabled", String(!status.open));
    submit.title = status.open ? "" : orderingClosedMessage();
  }
  const notice = document.getElementById("orderingStatusNotice");
  if (notice) {
    notice.hidden = status.open;
    notice.textContent = orderingClosedMessage();
  }
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const text = (key) => UI_TEXT[state.lang || "es"][key] || key;
const itemName = (item) => item[state.lang] || item.es;
const itemDescription = (item) => item.description?.[state.lang] || item.description?.es || "";
let lastAvailabilitySnapshot = localStorage.getItem("fogon_availability") || "{}";

let publicCatalogSnapshot = "";

function publicCatalogFunctionConfig() {
  const cfg = window.FOGON_SUPABASE || {};
  const supabaseUrl = String(cfg.url || "").replace(/\/$/, "");
  const anonKey = String(cfg.anonKey || "").trim();

  if (!supabaseUrl || !anonKey) {
    throw new Error("Faltan la URL o la anon key de Supabase.");
  }

  return { supabaseUrl, anonKey };
}

function publicCatalogHeaders(anonKey) {
  const headers = {
    "Content-Type": "application/json",
    "apikey": anonKey
  };

  const looksLikeJwt =
    anonKey.startsWith("eyJ") &&
    anonKey.split(".").length === 3;

  if (looksLikeJwt) {
    headers.Authorization = `Bearer ${anonKey}`;
  }

  return headers;
}

function rowHas(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function rowBoolean(row, key, fallback = true) {
  if (!rowHas(row, key) || row[key] == null) return fallback;
  return row[key] !== false;
}

function rowNumber(row, keys, fallback = 0) {
  for (const key of keys) {
    if (!rowHas(row, key)) continue;
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number(fallback || 0);
}

function rowText(row, keys, fallback = "") {
  for (const key of keys) {
    if (!rowHas(row, key)) continue;
    const value = row[key];
    if (value == null) return "";
    return String(value);
  }
  return String(fallback || "");
}

function normalizeCatalogArray(value) {
  return Array.isArray(value) ? value : [];
}

function catalogSortValue(row) {
  return rowNumber(row, ["sort_order", "sortOrder"], 0);
}

function mapCatalogOption(row) {
  return {
    id: String(row.id || ""),
    es: rowText(row, ["name_es", "es"], String(row.id || "")),
    en: rowText(row, ["name_en", "en"], rowText(row, ["name_es", "es"], String(row.id || ""))),
    price: rowNumber(row, ["price_delta", "price", "additional_price", "base_price"], 0),
    sortOrder: catalogSortValue(row)
  };
}

function mapCatalogExtra(row) {
  return {
    id: String(row.id || ""),
    es: rowText(row, ["name_es", "es"], String(row.id || "")),
    en: rowText(row, ["name_en", "en"], rowText(row, ["name_es", "es"], String(row.id || ""))),
    price: rowNumber(row, ["price", "price_delta", "additional_price", "base_price"], 0),
    sortOrder: catalogSortValue(row)
  };
}

function mapCatalogRemovable(row) {
  return {
    id: String(row.id || ""),
    es: rowText(row, ["name_es", "es"], String(row.id || "")),
    en: rowText(row, ["name_en", "en"], rowText(row, ["name_es", "es"], String(row.id || ""))),
    sortOrder: catalogSortValue(row)
  };
}

function buildMenuFromPublicCatalog(catalog) {
  const categoryRows = normalizeCatalogArray(catalog?.categories)
    .filter((row) => row && row.id && rowBoolean(row, "active", true))
    .sort((a, b) => catalogSortValue(a) - catalogSortValue(b));

  const productRows = normalizeCatalogArray(catalog?.products)
    .filter((row) => row && row.id && rowBoolean(row, "active", true) && rowBoolean(row, "visible", true));

  if (!categoryRows.length || !productRows.length) {
    throw new Error("Supabase devolvió un catálogo vacío.");
  }

  const fallbackProducts = new Map(
    normalizeCatalogArray(MENU_ITEMS).map((item) => [String(item.id), item])
  );

  const groupRows = normalizeCatalogArray(catalog?.optionGroups)
    .filter((row) => row && row.id && row.product_id && rowBoolean(row, "active", true));

  const optionRows = normalizeCatalogArray(catalog?.options)
    .filter((row) => row && row.id && row.option_group_id && rowBoolean(row, "active", true));

  const extraRows = normalizeCatalogArray(catalog?.extras)
    .filter((row) => row && row.id && rowBoolean(row, "active", true));

  const productExtraRows = normalizeCatalogArray(catalog?.productExtras)
    .filter((row) => row && row.product_id && row.extra_id);

  const removableRows = normalizeCatalogArray(catalog?.removables)
    .filter((row) => row && row.id && rowBoolean(row, "active", true));

  const productRemovableRows = normalizeCatalogArray(catalog?.productRemovables)
    .filter((row) => row && row.product_id && row.removable_id);

  const optionsByGroup = new Map();
  optionRows.forEach((row) => {
    const groupId = String(row.option_group_id);
    if (!optionsByGroup.has(groupId)) optionsByGroup.set(groupId, []);
    optionsByGroup.get(groupId).push(row);
  });

  const groupsByProduct = new Map();
  groupRows.forEach((row) => {
    const productId = String(row.product_id);
    if (!groupsByProduct.has(productId)) groupsByProduct.set(productId, []);
    groupsByProduct.get(productId).push(row);
  });

  const extrasById = new Map(extraRows.map((row) => [String(row.id), row]));
  const removablesById = new Map(removableRows.map((row) => [String(row.id), row]));

  const categoryOrder = new Map(
    categoryRows.map((row, index) => [String(row.id), index])
  );

  const categories = categoryRows.map((row) => ({
    id: String(row.id),
    es: rowText(row, ["name_es", "es"], String(row.id)),
    en: rowText(row, ["name_en", "en"], rowText(row, ["name_es", "es"], String(row.id)))
  }));

  const products = productRows
    .map((row) => {
      const productId = String(row.id);
      const fallback = fallbackProducts.get(productId) || {};

      const databaseGroups = (groupsByProduct.get(productId) || [])
        .sort((a, b) => catalogSortValue(a) - catalogSortValue(b))
        .map((groupRow) => {
          const groupId = String(groupRow.id);
          const options = (optionsByGroup.get(groupId) || [])
            .sort((a, b) => catalogSortValue(a) - catalogSortValue(b))
            .map(mapCatalogOption);

          return {
            id: groupId,
            es: rowText(groupRow, ["name_es", "es"], groupId),
            en: rowText(groupRow, ["name_en", "en"], rowText(groupRow, ["name_es", "es"], groupId)),
            required: rowBoolean(groupRow, "required", false),
            type: /multi|checkbox/i.test(rowText(groupRow, ["type", "selection_type"], "single"))
              ? "multi"
              : "single",
            options
          };
        });

      const databaseExtras = productExtraRows
        .filter((link) => String(link.product_id) === productId)
        .sort((a, b) => catalogSortValue(a) - catalogSortValue(b))
        .map((link) => extrasById.get(String(link.extra_id)))
        .filter(Boolean)
        .map(mapCatalogExtra);

      const databaseRemovables = productRemovableRows
        .filter((link) => String(link.product_id) === productId)
        .sort((a, b) => catalogSortValue(a) - catalogSortValue(b))
        .map((link) => removablesById.get(String(link.removable_id)))
        .filter(Boolean)
        .map(mapCatalogRemovable);

      const image = rowHas(row, "image_url")
        ? String(row.image_url || "")
        : String(fallback.image || "");

      return {
        id: productId,
        category: String(row.category_id || fallback.category || ""),
        es: rowText(row, ["name_es", "es"], fallback.es || productId),
        en: rowText(row, ["name_en", "en"], fallback.en || fallback.es || productId),
        description: {
          es: rowText(row, ["description_es"], fallback.description?.es || ""),
          en: rowText(row, ["description_en"], fallback.description?.en || fallback.description?.es || "")
        },
        price: rowNumber(row, ["base_price", "price"], fallback.price || 0),
        image,
        taxable: rowHas(row, "taxable") ? row.taxable !== false : fallback.taxable !== false,
        optionGroups: databaseGroups.length ? databaseGroups : normalizeCatalogArray(fallback.optionGroups),
        extras: databaseExtras.length ? databaseExtras : normalizeCatalogArray(fallback.extras),
        removables: databaseRemovables.length ? databaseRemovables : normalizeCatalogArray(fallback.removables),
        sortOrder: catalogSortValue(row)
      };
    })
    .filter((item) => item.category && categoryOrder.has(item.category))
    .sort((a, b) => {
      const categoryDifference =
        Number(categoryOrder.get(a.category) || 0) -
        Number(categoryOrder.get(b.category) || 0);
      return categoryDifference || Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });

  if (!products.length) {
    throw new Error("Supabase no devolvió productos públicos utilizables.");
  }

  CATEGORIES.splice(0, CATEGORIES.length, ...categories);
  MENU_ITEMS.splice(0, MENU_ITEMS.length, ...products);

  if (!CATEGORIES.some((category) => category.id === state.category)) {
    state.category = CATEGORIES[0]?.id || "";
  }
}

async function fetchPublicCatalog() {
  const { supabaseUrl, anonKey } = publicCatalogFunctionConfig();
  const response = await fetch(`${supabaseUrl}/functions/v1/public-catalog`, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: publicCatalogHeaders(anonKey)
  });

  const rawText = await response.text();
  let result = {};

  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    result = { detail: rawText };
  }

  if (!response.ok || !result?.ok || !result?.catalog) {
    const reason = [
      `HTTP ${response.status}`,
      result?.error,
      result?.detail
    ].filter(Boolean).join(" · ");
    throw new Error(reason || "No se pudo cargar el catálogo público.");
  }

  return result.catalog;
}

async function loadPublicCatalog({ render = false, force = false } = {}) {
  try {
    const catalog = await fetchPublicCatalog();
    const nextSnapshot = JSON.stringify(catalog);

    if (!force && nextSnapshot === publicCatalogSnapshot) {
      return false;
    }

    buildMenuFromPublicCatalog(catalog);
    publicCatalogSnapshot = nextSnapshot;

    if (render) {
      renderCategories();
      renderMenu();
      renderCart();
    }

    return true;
  } catch (error) {
    console.warn(
      "No se pudo cargar el catálogo público desde Supabase. Se mantiene menu-data.js como respaldo:",
      error
    );
    return false;
  }
}



const DEFAULT_PUBLIC_SETTINGS = {
  menu_title: "Haz tu pedido desde aquí",
  menu_subtitle: "Elige tus platos, personalízalos, añádelos al carrito y completa tu pedido con tu nombre y teléfono.",
  footer_title: "Comida dominicana y latina en San Jose, California",
  footer_paragraph_1: "El Fogon D' Geny prepara autentica comida dominicana, latina y caribeña en el centro de San Jose.",
  footer_paragraph_2: "Si buscas comida dominicana sabrosa, comida latina o un restaurante dominicano en San Jose, visita El Fogon D' Geny.",
  address: "796 S 1st St, San Jose, CA 95113",
  maps_label: "Ver ubicación en Google Maps",
  maps_url: "https://www.google.com/maps/search/?api=1&query=El+Fogon+D%27+Geny+796+S+1st+St+San+Jose+CA+95113",
  tax_enabled: false,
  tax_rate: 10,
  tax_only_taxable: true,
  checkout_mode: "pay_at_counter"
};

let publicBusinessSettings = { ...DEFAULT_PUBLIC_SETTINGS };

function applyPublicBusinessSettings(settings = {}) {
  publicBusinessSettings = { ...DEFAULT_PUBLIC_SETTINGS, ...(settings || {}) };
  publicWeeklySchedule = normalizeWeeklySchedule(
    publicBusinessSettings.weekly_schedule
  );

  const heroTitle = document.querySelector('[data-i18n="heroTitle"]');
  const heroSubtitle = document.querySelector('[data-i18n="heroSubtitle"]');
  if (heroTitle && publicBusinessSettings.menu_title) {
    heroTitle.textContent = publicBusinessSettings.menu_title;
  }
  if (heroSubtitle && publicBusinessSettings.menu_subtitle) {
    heroSubtitle.textContent = publicBusinessSettings.menu_subtitle;
  }

  document.querySelectorAll("[data-business-setting]").forEach((node) => {
    const key = node.dataset.businessSetting;
    const value = publicBusinessSettings[key];
    if (value) node.textContent = value;
  });

  const mapsLink = document.getElementById("businessMapsLink");
  if (mapsLink && publicBusinessSettings.maps_url) {
    mapsLink.href = publicBusinessSettings.maps_url;
  }
}

async function loadPublicBusinessSettings() {
  try {
    const db = window.FOGON_DB;
    if (!db?.isReady?.() || typeof db.fetchMenuSettings !== "function") {
      applyPublicBusinessSettings();
      return publicBusinessSettings;
    }

    const settings = await db.fetchMenuSettings();
    applyPublicBusinessSettings(settings);
    renderCart();
    return publicBusinessSettings;
  } catch (error) {
    console.warn("No se pudieron cargar los datos públicos del negocio:", error);
    applyPublicBusinessSettings();
    return publicBusinessSettings;
  }
}

function getAvailability() {
  try {
    return JSON.parse(localStorage.getItem("fogon_availability") || "{}");
  } catch (_) {
    return {};
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function availabilityValue(key, legacyKey = null) {
  const availability = getAvailability();
  if (hasOwn(availability, key)) return availability[key] !== false;
  if (legacyKey && hasOwn(availability, legacyKey)) return availability[legacyKey] !== false;
  return true;
}


const INVENTORY_DEPENDENCY_BY_OPTION_ID = {
  "pollo-guisado": "inventory:1:pollo-guisar",
  "pollo": "inventory:1:pollo-guisar",
  "pollo-frito": "inventory:2:pollo-pica-pollo",
  "res-guisada": "inventory:12:res",
  "res": "inventory:12:res",
  "carne": "inventory:12:res",
  "bistec": "inventory:4:bistec",
  "puerco-guisado": "inventory:13:cerdo",
  "cerdo": "inventory:13:cerdo",
  "chuleta-plancha": "inventory:5:chuleta",
  "pechuga-plancha": "inventory:15:pechuga-de-pollo",
  "camaron": "inventory:11:camarones",
  "camarones": "inventory:11:camarones",
  "chicharron": "inventory:14:chicharron",
  "tilapia": "inventory:9:tilapia",
  "chillo": "inventory:10:chillo",
  "papas-fritas": "inventory:28:papas-fritas",
  "platanos-maduros": "inventory:22:platano-maduro",
  "platanos-fritos": "inventory:22:platano-maduro",
  "tostones": "inventory:21:platano-verde",
  "salami": "inventory:16:salami",
  "bacon": "inventory:17:bacon",
  "tocino": "inventory:44:tocino",
  "longaniza": "inventory:18:longaniza",
  "jamon": "inventory:42:jamon",
  "huevo": "inventory:43:huevo",
  "aguacate-extra": "inventory:50:aguacate",
  "queso": "inventory:30:queso-dominicano",
  "jamon-queso": "inventory:42:jamon"
};

function inventoryDependencyAvailable(optionId) {
  const key = INVENTORY_DEPENDENCY_BY_OPTION_ID[String(optionId || "")];
  return !key || availabilityValue(key);
}

function showAddedToCartNotice() {
  let notice = document.getElementById("addedToCartNotice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "addedToCartNotice";
    notice.className = "added-to-cart-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    document.body.appendChild(notice);
  }
  notice.textContent = text("addedToCart");
  notice.classList.add("is-visible");
  clearTimeout(showAddedToCartNotice.timer);
  showAddedToCartNotice.timer = setTimeout(() => {
    notice.classList.remove("is-visible");
  }, 1500);
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

function isProductAvailable(item) {
  if (!item) return false;
  const productEnabled = availabilityValue(productAvailabilityKey(item), item.id);
  if (!productEnabled) return false;

  return (item.optionGroups || []).every((group) => {
    if (!group.required) return true;
    return (group.options || []).some((option) => availabilityValue(optionAvailabilityKey(group, option)));
  });
}

function isOptionAvailable(group, option) {
  return availabilityValue(optionAvailabilityKey(group, option)) &&
    inventoryDependencyAvailable(option?.id);
}

function isExtraAvailable(extra) {
  return availabilityValue(extraAvailabilityKey(extra)) &&
    inventoryDependencyAvailable(extra?.id);
}

function isRemovableAvailable(remove) {
  return availabilityValue(removableAvailabilityKey(remove));
}

async function syncAvailabilityFromBackend() {
  const db = window.FOGON_DB;

  if (db?.isReady()) {
    try {
      const availability = await db.fetchAvailability();
      localStorage.setItem("fogon_availability", JSON.stringify(availability));
      refreshAvailabilityIfChanged(false);
    } catch (error) {
      console.warn("No se pudo actualizar disponibilidad desde Supabase:", error);
    }
    return;
  }

  if (!BACKEND_URL) return;
  try {
    const response = await fetch(`${BACKEND_URL}/api/availability`);
    if (!response.ok) throw new Error(`Backend error ${response.status}`);
    const data = await response.json();
    if (data?.availability) {
      localStorage.setItem("fogon_availability", JSON.stringify(data.availability));
      refreshAvailabilityIfChanged(false);
    }
  } catch (error) {
    console.warn("No se pudo actualizar disponibilidad desde el backend:", error);
  }
}

function refreshAvailabilityIfChanged(force = false) {
  const nextSnapshot = localStorage.getItem("fogon_availability") || "{}";
  if (nextSnapshot === lastAvailabilitySnapshot) {
    updateOrderingUi();
    return false;
  }

  lastAvailabilitySnapshot = nextSnapshot;
  renderMenu();
  updateOrderingUi();
  return true;
}


const LANGUAGE_GATE_INTERVAL_MS = 10 * 60 * 1000;
const LANGUAGE_GATE_SELECTED_AT_KEY = "fogon_language_selected_at";
let languageGateTimer = null;

function languageSelectionTimestamp() {
  const value = Number(localStorage.getItem(LANGUAGE_GATE_SELECTED_AT_KEY) || 0);
  return Number.isFinite(value) ? value : 0;
}

function markLanguageSelectedNow() {
  const selectedAt = Date.now();
  localStorage.setItem(LANGUAGE_GATE_SELECTED_AT_KEY, String(selectedAt));
  return selectedAt;
}

function showLanguageGate() {
  const gate = $("#languageGate");
  if (!gate) return;

  gate.classList.remove("hidden");
  gate.setAttribute("aria-hidden", "false");
  document.body.classList.add("language-gate-open");

  bindLanguageButtons();
  const firstButton = gate.querySelector("[data-set-lang]");
  requestAnimationFrame(() => firstButton?.focus());
}

function hideLanguageGate() {
  const gate = $("#languageGate");
  if (!gate) return;

  gate.classList.add("hidden");
  gate.setAttribute("aria-hidden", "true");
  document.body.classList.remove("language-gate-open");
}

function scheduleLanguageGate() {
  if (languageGateTimer) {
    clearTimeout(languageGateTimer);
    languageGateTimer = null;
  }

  const selectedAt = languageSelectionTimestamp();
  const elapsed = selectedAt ? Date.now() - selectedAt : LANGUAGE_GATE_INTERVAL_MS;
  const remaining = Math.max(0, LANGUAGE_GATE_INTERVAL_MS - elapsed);

  languageGateTimer = setTimeout(() => {
    languageGateTimer = null;
    showLanguageGate();
  }, remaining);
}

function initializeLanguageGateTimer() {
  const selectedAt = languageSelectionTimestamp();

  if (!state.lang || !selectedAt || Date.now() - selectedAt >= LANGUAGE_GATE_INTERVAL_MS) {
    showLanguageGate();
    return;
  }

  hideLanguageGate();
  scheduleLanguageGate();
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem("fogon_lang", lang);
  markLanguageSelectedNow();
  hideLanguageGate();
  scheduleLanguageGate();
  document.documentElement.lang = lang;
  applyText();
  renderCategories();
  renderMenu();
  renderCart();
  syncAvailabilityFromBackend();
}

function applyText() {
  $$("[data-i18n]").forEach((node) => {
    node.textContent = text(node.dataset.i18n);
  });
  $$(".lang-switch button").forEach((button) => {
    button.classList.toggle("active", button.dataset.setLang === state.lang);
  });
  const heroTitle = document.querySelector('[data-i18n="heroTitle"]');
  const heroSubtitle = document.querySelector('[data-i18n="heroSubtitle"]');

  if (heroTitle) {
    heroTitle.textContent = publicBusinessSettings.menu_title ||
      (state.lang === "en" ? "Order your favorites" : "Haz tu pedido desde aquí");
  }

  if (heroSubtitle) {
    heroSubtitle.textContent = publicBusinessSettings.menu_subtitle ||
      (state.lang === "en"
        ? "Choose your dishes, customize them, add them to the cart and complete your order with your name and phone number."
        : "Elige tus platos, personalízalos, añádelos al carrito y completa tu pedido con tu nombre y teléfono.");
  }

  const trustLabels = state.lang === "en"
    ? ["Made to order", "Direct ordering", "Easy pickup"]
    : ["Preparado al momento", "Pedido directo", "Recogida sencilla"];

  document.querySelectorAll(".hero-trust-row span").forEach((step, index) => {
    step.textContent = trustLabels[index] || "";
  });

  updateThemeButton();
}

function applyTheme() {
  document.body.classList.toggle("dark-mode", state.theme === "dark");
  localStorage.setItem("fogon_theme", state.theme);
  updateThemeButton();
}

function updateThemeButton() {
  const button = $("#themeToggleBtn");
  if (!button) return;
  const isDark = state.theme === "dark";
  button.textContent = isDark ? text("lightMode") : text("darkMode");
  button.setAttribute("aria-pressed", String(isDark));
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();
}

function renderCategories() {
  const tabs = $("#categoryTabs");
  tabs.innerHTML = CATEGORIES.map((category) => `
    <button class="${category.id === state.category ? "active" : ""}" data-category="${category.id}">
      ${category[state.lang] || category.es}
    </button>
  `).join("");
}


const loadedImageUrls = new Set();

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function handleProductImageLoad(image) {
  if (!image) return;
  loadedImageUrls.add(String(image.currentSrc || image.src || ""));
  image.classList.add("is-loaded");
  const frame = image.closest(".product-image");
  if (frame) {
    frame.classList.add("has-loaded-image");
    frame.classList.remove("is-loading", "missing-image");
  }
}

function handleProductImageError(image) {
  if (!image) return;
  const frame = image.closest(".product-image");
  if (frame) {
    frame.classList.remove("is-loading", "has-loaded-image");
    frame.classList.add("missing-image");
  }
  image.hidden = true;
}

function hydrateRenderedProductImages(root = document) {
  root.querySelectorAll(".product-image img").forEach((image) => {
    const currentUrl = String(image.currentSrc || image.src || "");
    if (image.complete && image.naturalWidth > 0) {
      handleProductImageLoad(image);
      return;
    }
    if (loadedImageUrls.has(currentUrl)) {
      image.classList.add("is-loaded");
      image.closest(".product-image")?.classList.add("has-loaded-image");
    }
  });
}

function productCardHtml(item, imageIndex) {
  const unavailable = !isProductAvailable(item);
  const priorityImage = imageIndex < 6;
  return `
    <article class="product-card ${unavailable ? "is-unavailable" : ""}">
      <button class="product-trigger" type="button" data-product-id="${escapeAttribute(item.id)}" ${unavailable ? "disabled" : ""}>
        <div class="product-image ${item.image ? "is-loading" : "missing-image"}">
          ${item.image ? `<img src="${escapeAttribute(item.image)}" alt="${escapeAttribute(itemName(item))}" loading="${priorityImage ? "eager" : "lazy"}" fetchpriority="${priorityImage ? "high" : "auto"}" decoding="async" width="640" height="557" onload="handleProductImageLoad(this)" onerror="handleProductImageError(this)">` : ""}
          <span class="product-image-placeholder" aria-hidden="true">
            <span class="product-image-placeholder-icon">FG</span>
          </span>
        </div>
        <div class="product-info">
          <div>
            <h2>${itemName(item)}</h2>
            <p>${itemDescription(item)}</p>
          </div>
          <div class="price-row">
            <strong>${money(item.price)}</strong>
            ${unavailable ? `<span>${text("unavailable")}</span>` : ""}
          </div>
        </div>
      </button>
    </article>
  `;
}

function renderMenu() {
  const grid = $("#menuGrid");
  let imageIndex = 0;
  grid.innerHTML = CATEGORIES.map((category) => {
    const items = MENU_ITEMS.filter((item) => item.category === category.id && item.visible !== false);
    if (!items.length) return "";
    return `
      <section class="category-section" id="cat-${category.id}" data-category-section="${category.id}">
        <div class="category-title">
          <h2>${category[state.lang] || category.es}</h2>
          <span>${items.length}</span>
        </div>
        <div class="category-products">
          ${items.map((item) => productCardHtml(item, imageIndex++)).join("")}
        </div>
      </section>
    `;
  }).join("");
  hydrateRenderedProductImages(grid);
  setupCategoryObserver();
}

let categoryObserver = null;
function setupCategoryObserver() {
  if (categoryObserver) categoryObserver.disconnect();
  const sections = Array.from(document.querySelectorAll("[data-category-section]"));
  if (!("IntersectionObserver" in window) || !sections.length) return;
  categoryObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const nextCategory = visible.target.dataset.categorySection;
    if (nextCategory && nextCategory !== state.category) {
      state.category = nextCategory;
      document.querySelectorAll("[data-category]").forEach((button) => {
        button.classList.toggle("active", button.dataset.category === nextCategory);
      });
    }
  }, { root: null, rootMargin: "-72px 0px -68% 0px", threshold: [0.12, 0.25, 0.5] });
  sections.forEach((section) => categoryObserver.observe(section));
}

function scrollToCategory(categoryId) {
  state.category = categoryId;
  scrollRevealLockUntil = Date.now() + 900;
  document.body.classList.remove("is-scrolling-down");
  document.body.classList.add("is-scrolling-up");
  renderCategories();
  const section = document.getElementById(`cat-${categoryId}`);
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function optionLabel(option) {
  const price = Number(option.price || 0);
  const suffix = price === 0 ? "" : ` (${price > 0 ? "+" : ""}${money(price)})`;
  return `${option[state.lang] || option.es}${suffix}`;
}

function openProduct(itemId) {
  const item = MENU_ITEMS.find((product) => String(product.id) === String(itemId));
  if (!item || !isProductAvailable(item)) return;

  state.currentProduct = item;
  const modal = $("#productModal");
  const groups = (item.optionGroups || []).map((group) => ({
    ...group,
    options: (group.options || []).filter((option) => isOptionAvailable(group, option))
  })).filter((group) => group.options.length || group.required);
  const extras = (item.extras || []).filter((extra) => isExtraAvailable(extra));
  const removables = (item.removables || []).filter((remove) => isRemovableAvailable(remove));

  const optionGroupHtml = groups.map((group, groupIndex) => `
    <fieldset class="modifier-group" data-required="${group.required ? "true" : "false"}">
      <legend>
        <span class="modifier-title">${escapeHtml(group[state.lang] || group.es)}</span>
        <span class="modifier-badge ${group.required ? "is-required" : ""}">
          ${group.required ? text("required") : text("optional")}
        </span>
      </legend>
      <p class="modifier-help">
        ${group.type === "multi"
          ? (state.lang === "en" ? "Choose one or more options." : "Puedes elegir una o varias opciones.")
          : (state.lang === "en" ? "Choose one option." : "Elige una opción.")}
      </p>
      <div class="modifier-options">
        ${group.options.length ? group.options.map((option, optionIndex) => `
          <label class="modifier-option">
            <input
              type="${group.type === "multi" ? "checkbox" : "radio"}"
              name="${escapeAttribute(group.id)}"
              value="${escapeAttribute(option.id)}"
              ${group.required ? "required" : ""}
            >
            <span class="modifier-control" aria-hidden="true"></span>
            <span class="modifier-option-copy">
              <strong>${escapeHtml(option[state.lang] || option.es)}</strong>
              ${Number(option.price || 0) !== 0
                ? `<small>${Number(option.price) > 0 ? "+" : ""}${money(option.price)}</small>`
                : `<small>${state.lang === "en" ? "Included" : "Incluido"}</small>`}
            </span>
          </label>
        `).join("") : `<p class="choice-empty">${state.lang === "en" ? "Not available right now." : "No disponible por ahora."}</p>`}
      </div>
    </fieldset>
  `).join("");

  const extrasHtml = extras.length ? `
    <fieldset class="modifier-group">
      <legend>
        <span class="modifier-title">${state.lang === "en" ? "Extras" : "Extras"}</span>
        <span class="modifier-badge">${text("optional")}</span>
      </legend>
      <p class="modifier-help">${state.lang === "en" ? "Add something extra to your order." : "Añade algo extra a tu pedido."}</p>
      <div class="modifier-options">
        ${extras.map((extra) => `
          <label class="modifier-option">
            <input type="checkbox" name="extras" value="${escapeAttribute(extra.id)}">
            <span class="modifier-control" aria-hidden="true"></span>
            <span class="modifier-option-copy">
              <strong>${escapeHtml(extra[state.lang] || extra.es)}</strong>
              <small>${Number(extra.price || 0) > 0 ? "+" : ""}${money(extra.price || 0)}</small>
            </span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  ` : "";

  const removablesHtml = removables.length ? `
    <fieldset class="modifier-group">
      <legend>
        <span class="modifier-title">${state.lang === "en" ? "Remove ingredients" : "Quitar ingredientes"}</span>
        <span class="modifier-badge">${text("optional")}</span>
      </legend>
      <div class="modifier-options">
        ${removables.map((remove) => `
          <label class="modifier-option">
            <input type="checkbox" name="removables" value="${escapeAttribute(remove.id)}">
            <span class="modifier-control" aria-hidden="true"></span>
            <span class="modifier-option-copy">
              <strong>${escapeHtml(remove[state.lang] || remove.es)}</strong>
            </span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  ` : "";

  modal.innerHTML = `
    <div class="modal-sheet product-detail-sheet">
      <button class="icon-btn modal-close" type="button" aria-label="${state.lang === "en" ? "Close" : "Cerrar"}">×</button>

      <div class="product-detail-hero">
        <div class="product-detail-image product-image ${item.image ? "is-loading" : "missing-image"}">
          ${item.image ? `<img
            src="${escapeAttribute(item.image)}"
            alt="${escapeAttribute(itemName(item))}"
            loading="eager"
            fetchpriority="high"
            decoding="async"
            width="640"
            height="557"
            onload="handleProductImageLoad(this)"
            onerror="handleProductImageError(this)"
          >` : ""}
          <span class="product-image-placeholder" aria-hidden="true">
            <span class="product-image-placeholder-icon">FG</span>
          </span>
        </div>

        <div class="product-detail-summary">
          <p class="product-detail-kicker">${state.lang === "en" ? "Customize your dish" : "Personaliza tu plato"}</p>
          <h2>${escapeHtml(itemName(item))}</h2>
          <p>${escapeHtml(itemDescription(item))}</p>
          <strong class="product-detail-price">${money(item.price)}</strong>
        </div>
      </div>

      <form id="productForm" class="product-form product-detail-form">
        <div class="modifier-groups">
          ${optionGroupHtml}
          ${extrasHtml}
          ${removablesHtml}
        </div>

        <label class="notes-label product-notes">
          <span>${text("notes")}</span>
          <small>${state.lang === "en" ? "Optional. Tell us anything the kitchen should know." : "Opcional. Dinos lo que debe saber la cocina."}</small>
          <textarea name="notes" rows="3" placeholder="${state.lang === "en" ? "Example: sauce on the side" : "Ejemplo: salsa aparte"}"></textarea>
        </label>

        <div class="product-submit-spacer" aria-hidden="true"></div>
        <div class="product-submit-bar">
          <div class="product-submit-price">
            <small>${state.lang === "en" ? "Precio" : "Precio"}</small>
            <strong>${money(item.price)}</strong>
          </div>
          <button class="primary-btn product-submit-button" type="submit">
            ${text("addToCart")}
          </button>
        </div>
      </form>
    </div>
  `;

  hydrateRenderedProductImages(modal);
  $("#modalBackdrop").hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}
function closeProduct() {
  $("#productModal").setAttribute("aria-hidden", "true");
  $("#modalBackdrop").hidden = true;
  document.body.classList.remove("modal-open");
  state.currentProduct = null;
}

function findOption(group, optionId) {
  return group.options.find((option) => option.id === optionId);
}

function buildCartItem(form) {
  const item = state.currentProduct;
  let lineTotal = Number(item.price);
  const selections = [];

  (item.optionGroups || []).forEach((group) => {
    const checked = Array.from(form.querySelectorAll(`[name="${group.id}"]:checked`));
    checked.forEach((input) => {
      const option = findOption(group, input.value);
      if (!option) return;
      lineTotal += Number(option.price || 0);
      selections.push({
        group: group[state.lang] || group.es,
        name: option[state.lang] || option.es,
        groupEs: group.es,
        nameEs: option.es,
        price: Number(option.price || 0)
      });
    });
  });

  const extras = [];
  Array.from(form.querySelectorAll(`[name="extras"]:checked`)).forEach((input) => {
    const extra = (item.extras || []).find((candidate) => candidate.id === input.value);
    if (!extra) return;
    lineTotal += Number(extra.price || 0);
    extras.push({
      name: extra[state.lang] || extra.es,
      nameEs: extra.es,
      price: Number(extra.price || 0)
    });
  });

  const removables = [];
  Array.from(form.querySelectorAll(`[name="removables"]:checked`)).forEach((input) => {
    const remove = (item.removables || []).find((candidate) => candidate.id === input.value);
    if (remove) {
      removables.push({
        name: remove[state.lang] || remove.es,
        nameEs: remove.es
      });
    }
  });

  return {
    id: uniqueCartLineId(item.id),
    productId: item.id,
    name: itemName(item),
    nameEs: item.es,
    nameEn: item.en,
    basePrice: Number(item.price),
    taxable: item.taxable !== false,
    taxRate: Number(publicBusinessSettings.tax_rate || 10),
    selections,
    extras,
    removables,
    notes: form.notes.value.trim(),
    quantity: 1,
    lineTotal
  };
}

function cartLineConfigurationKey(item) {
  const normalized = {
    productId: String(item?.productId || ""),
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
      typeof remove === "string"
        ? remove
        : String(remove.nameEs || remove.name || "")
    ),
    notes: String(item?.notes || "").trim()
  };

  return JSON.stringify(normalized);
}

function changeCartQuantity(lineId, delta) {
  const id = String(lineId || "");
  const amount = Number(delta || 0);

  state.cart = state.cart
    .map((item) => {
      if (String(item.id) !== id) return item;
      const nextQuantity = Math.max(0, Number(item.quantity || 1) + amount);
      return { ...item, quantity: nextQuantity };
    })
    .filter((item) => Number(item.quantity || 0) > 0);

  renderCart();
}

function addToCart(cartItem) {
  const incomingKey = cartLineConfigurationKey(cartItem);
  const existing = state.cart.find(
    (item) => cartLineConfigurationKey(item) === incomingKey
  );

  if (existing) {
    existing.quantity = Number(existing.quantity || 1) + Number(cartItem.quantity || 1);
  } else {
    state.cart.push(cartItem);
  }

  // Cierra el producto inmediatamente después de agregarlo.
  // Así, incluso si una actualización visual falla, el modal no queda abierto.
  closeProduct();

  renderCart();
  showAddedToCartNotice();
}

function getTotals() {
  const subtotal = state.cart.reduce(
    (sum, item) => sum + Number(item.lineTotal || 0) * Number(item.quantity || 1),
    0
  );

  const taxEnabled = publicBusinessSettings.tax_enabled === true;
  const taxRate = Math.max(0, Number(publicBusinessSettings.tax_rate || 0)) / 100;
  const onlyTaxable = publicBusinessSettings.tax_only_taxable !== false;

  const taxableSubtotal = taxEnabled
    ? state.cart.reduce((sum, item) => {
        const shouldTax = !onlyTaxable || item.taxable !== false;
        return shouldTax
          ? sum + Number(item.lineTotal || 0) * Number(item.quantity || 1)
          : sum;
      }, 0)
    : 0;

  const tax = Math.round(taxableSubtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return { subtotal, taxableSubtotal, tax, total };
}

function renderCart() {
  const cartQty = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $("#cartCount").textContent = cartQty;
  const cartFab = $("#cartFab");
  if (cartFab) cartFab.setAttribute("aria-label", `${text("cart")}: ${cartQty}`);
  const container = $("#cartItems");
  if (!state.cart.length) {
    container.innerHTML = `<p class="empty-state">${text("emptyCart")}</p>`;
  } else {
    container.innerHTML = state.cart.map((item) => `
      <div class="cart-item">
        <div>
          <strong>${item.quantity}x ${item.name}</strong>
          ${item.selections.map((selection) => `<p>${selection.group}: ${selection.name}</p>`).join("")}
          ${item.extras.map((extra) => `<p>Extra: ${extra.name} +${money(extra.price)}</p>`).join("")}
          ${item.removables.map((remove) => `<p>${typeof remove === "string" ? remove : remove.name}</p>`).join("")}
          ${item.notes ? `<p>${item.notes}</p>` : ""}
        </div>
        <div class="cart-item-actions">
          <strong class="cart-line-total">${money(item.lineTotal * item.quantity)}</strong>
          <div class="cart-quantity-control" role="group" aria-label="${state.lang === "en" ? "Quantity" : "Cantidad"} ${item.name}">
            <button class="cart-quantity-btn" data-cart-quantity="-1" data-cart-line="${item.id}" type="button" aria-label="${state.lang === "en" ? "Decrease" : "Disminuir"} ${item.name}">−</button>
            <output class="cart-quantity-value" aria-live="polite">${item.quantity}</output>
            <button class="cart-quantity-btn" data-cart-quantity="1" data-cart-line="${item.id}" type="button" aria-label="${state.lang === "en" ? "Increase" : "Aumentar"} ${item.name}">+</button>
          </div>
          <button class="text-btn cart-remove-btn" data-remove-cart="${item.id}" type="button" aria-label="${text("remove")} ${item.name}">${text("remove")}</button>
        </div>
      </div>
    `).join("");
  }
  const totals = getTotals();

  const subtotalValue = $("#subtotalValue");
  const taxValue = $("#taxValue");
  const totalValue = $("#totalValue");

  const taxSummaryRow = $("#taxSummaryRow");
  const taxSummaryLabel = $("#taxSummaryLabel");

  if (subtotalValue) subtotalValue.textContent = money(totals.subtotal);
  if (taxValue) taxValue.textContent = money(totals.tax);
  if (totalValue) totalValue.textContent = money(totals.total);
  if (taxSummaryRow) taxSummaryRow.hidden = publicBusinessSettings.tax_enabled !== true;
  if (taxSummaryLabel) {
    taxSummaryLabel.textContent = state.lang === "en" ? "Tax" : "Impuesto";
  }
}

function updateCartFabCompact(forceExpanded = false) {
  const fab = $("#cartFab");
  if (!fab) return;
  if (forceExpanded) state.cartFabCompact = false;
  fab.classList.toggle("is-compact", state.cartFabCompact);
}

function handlePageScroll() {
  const currentY = window.scrollY || 0;
  const delta = currentY - lastScrollY;
  const locked = Date.now() < scrollRevealLockUntil;

  if (currentY < 70 || locked || delta < -6) {
    document.body.classList.remove("is-scrolling-down");
    document.body.classList.add("is-scrolling-up");
    state.cartFabCompact = false;
  } else if (delta > 5) {
    document.body.classList.add("is-scrolling-down");
    document.body.classList.remove("is-scrolling-up");
    state.cartFabCompact = true;
  }

  lastScrollY = currentY;
  updateCartFabCompact();
}

function openCart() {
  state.cartFabCompact = false;
  updateCartFabCompact(true);
  document.body.classList.add("cart-open");
  $("#cartPanel").setAttribute("aria-hidden", "false");
}

function closeCart() {
  document.body.classList.remove("cart-open");
  $("#cartPanel").setAttribute("aria-hidden", "true");
}

function getExistingOrderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_ORDERS) || "[]").map((order) => String(order.id)));
  } catch (_) {
    return new Set();
  }
}

function nextSimpleOrderId() {
  const used = getExistingOrderIds();
  let next = Number(localStorage.getItem(STORAGE_ORDER_COUNTER) || "1");
  if (!Number.isFinite(next) || next < 1 || next > 999) next = 1;

  for (let attempt = 0; attempt < 999; attempt += 1) {
    const candidate = String(next);
    next = next >= 999 ? 1 : next + 1;
    localStorage.setItem(STORAGE_ORDER_COUNTER, String(next));
    if (!used.has(candidate)) return candidate;
  }

  return String(Math.floor(Math.random() * 999) + 1);
}

function openPayment(order) {
  state.pendingOrder = order;
  state.orderType = "";

  const orderTypeStep = $("#orderTypeStep");
  const paymentMethodStep = $("#paymentMethodStep");
  const orderThanksStep = $("#orderThanksStep");
  const kioskPaymentStep = $("#kioskPaymentStep");

  if (orderTypeStep) orderTypeStep.hidden = false;
  if (paymentMethodStep) paymentMethodStep.hidden = true;
  if (orderThanksStep) orderThanksStep.hidden = true;
  if (kioskPaymentStep) kioskPaymentStep.hidden = true;

  $("#paymentModal").setAttribute("aria-hidden", "false");
}

function showOrderThanks(orderNumber, activeOrderCount = 0) {
  const orderTypeStep = $("#orderTypeStep");
  const paymentMethodStep = $("#paymentMethodStep");
  const kioskPaymentStep = $("#kioskPaymentStep");
  const orderThanksStep = $("#orderThanksStep");

  if (orderTypeStep) orderTypeStep.hidden = true;
  if (paymentMethodStep) paymentMethodStep.hidden = true;
  if (kioskPaymentStep) kioskPaymentStep.hidden = true;
  if (orderThanksStep) orderThanksStep.hidden = false;

  const isEnglish = state.lang === "en";
  const title = $("#orderThanksTitle");
  const message = $("#orderThanksMessage");
  const number = $("#orderThanksNumber");
  const delay = $("#orderThanksDelay");
  const closeButton = $("#closeOrderThanksBtn");

  if (title) {
    title.textContent = isEnglish
      ? "Thank you for your order"
      : "Gracias por tu pedido";
  }

  if (message) {
    message.textContent = isEnglish
      ? "We will notify you on WhatsApp when your order is ready."
      : "Te informaremos por WhatsApp cuando tu pedido esté listo.";
  }

  if (number) {
    number.textContent = orderNumber
      ? (isEnglish ? `Order #${orderNumber}` : `Pedido #${orderNumber}`)
      : "";
    number.hidden = !orderNumber;
  }

  if (delay) {
    delay.hidden = activeOrderCount <= 3;
    delay.textContent = isEnglish
      ? "We currently have several orders in preparation, so your order may take a little longer."
      : "Tenemos varios pedidos en preparación, por lo que tu pedido puede tardar un poco más.";
  }

  if (closeButton) {
    closeButton.textContent = isEnglish ? "Close" : "Cerrar";
  }

  // Impide volver a enviar el mismo pedido desde esta ventana.
  state.pendingOrder = null;
  state.orderType = "";
}

function closePayment() {
  $("#paymentModal").setAttribute("aria-hidden", "true");

  const orderTypeStep = $("#orderTypeStep");
  const paymentMethodStep = $("#paymentMethodStep");
  const orderThanksStep = $("#orderThanksStep");

  if (orderTypeStep) orderTypeStep.hidden = false;
  if (paymentMethodStep) paymentMethodStep.hidden = true;
  if (orderThanksStep) orderThanksStep.hidden = true;

  state.pendingOrder = null;
  state.orderType = "";
}

async function postOrderToBackend(order) {
  if (!BACKEND_URL) return { ok: false, skipped: true };
  const response = await fetch(`${BACKEND_URL}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order)
  });
  if (!response.ok) throw new Error(`Backend error ${response.status}`);
  return response.json();
}

async function countActiveOrders() {
  const db = window.FOGON_DB;
  if (db && db.isReady && db.isReady()) {
    try {
      const orders = await db.fetchOrders();
      return orders.filter((order) => order.status === "new" || order.status === "accepted" || !order.status).length;
    } catch (error) {
      console.warn("No se pudo comprobar la carga actual de pedidos:", error);
    }
  }

  try {
    const orders = JSON.parse(localStorage.getItem(STORAGE_ORDERS) || "[]");
    return orders.filter((order) => order.status === "new" || order.status === "accepted" || !order.status).length;
  } catch (_) {
    return 0;
  }
}



function currentKioskId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = String(params.get("kiosk") || "").trim();

  if (fromUrl) {
    try {
      localStorage.setItem("fogon_kiosk_id", fromUrl);
    } catch (_) {}
    return fromUrl;
  }

  try {
    const stored = String(localStorage.getItem("fogon_kiosk_id") || "").trim();
    if (stored) return stored;
  } catch (_) {}

  return String(publicBusinessSettings.kiosk_id || "kiosk-01").trim() || "kiosk-01";
}

function buildExternalPaymentId(order) {
  const kiosk = currentKioskId()
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8) || "KIOSK";
  const orderNo = String(order.publicId || order.public_id || order.id || Date.now())
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-8);
  const stamp = Date.now().toString(36).slice(-10);
  return `${kiosk}-${orderNo}-${stamp}`.slice(0, 32);
}

function setKioskPaymentVisual(status, message = "") {
  const title = $("#kioskPaymentTitle");
  const text = $("#kioskPaymentMessage");
  const step = $("#kioskPaymentStep");

  if (step) step.dataset.paymentStatus = status;

  const labels = {
    waiting: state.lang === "en"
      ? "Waiting for payment on Clover"
      : "Esperando el pago en Clover",
    approved: state.lang === "en"
      ? "Payment approved"
      : "Pago aprobado",
    failed: state.lang === "en"
      ? "Payment failed"
      : "Pago fallido",
    cancelled: state.lang === "en"
      ? "Payment cancelled"
      : "Pago cancelado",
    review: state.lang === "en"
      ? "Payment needs verification"
      : "Pago pendiente de verificación",
    reauthorization_required: state.lang === "en"
      ? "Clover authorization required"
      : "Clover necesita autorización"
  };

  if (title) title.textContent = labels[status] || labels.waiting;
  if (text) {
    text.textContent = message || (
      status === "waiting"
        ? (state.lang === "en"
            ? "Use the assigned Clover Flex to complete the transaction."
            : "Completa la transacción en el Clover Flex asignado.")
        : ""
    );
  }
}

function isKioskCheckoutMode() {
  return String(publicBusinessSettings.checkout_mode || "pay_at_counter")
    .trim()
    .toLowerCase() === "pay_before_kitchen";
}

function kioskPaymentFunctionName() {
  return String(
    publicBusinessSettings.kiosk_payment_function ||
    "clover-kiosk-payment"
  ).trim() || "clover-kiosk-payment";
}

async function callKioskPaymentService(action, payload = {}) {
  const { supabaseUrl, anonKey } = publicCatalogFunctionConfig();
  const functionName = kioskPaymentFunctionName();
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    cache: "no-store",
    headers: publicCatalogHeaders(anonKey),
    body: JSON.stringify({ action, ...payload })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    const error = new Error(result?.error || `HTTP ${response.status}`);
    error.paymentStatus = String(result?.status || "failed");
    error.retrySafe = result?.retrySafe !== false;
    error.externalPaymentId = String(result?.externalPaymentId || "");
    error.httpStatus = response.status;
    throw error;
  }
  return result;
}

function setKioskPaymentStepVisible(visible, total = 0) {
  const orderTypeStep = $("#orderTypeStep");
  const paymentMethodStep = $("#paymentMethodStep");
  const kioskStep = $("#kioskPaymentStep");
  const thanksStep = $("#orderThanksStep");

  if (orderTypeStep) orderTypeStep.hidden = true;
  if (paymentMethodStep) paymentMethodStep.hidden = true;
  if (thanksStep) thanksStep.hidden = true;
  if (kioskStep) kioskStep.hidden = !visible;

  const totalNode = $("#kioskPaymentTotal");
  if (totalNode) totalNode.textContent = money(total);
}

async function startKioskBridgePayment(order) {
  const externalPaymentId = buildExternalPaymentId(order);

  state.activeKioskPayment = {
    orderId: order.databaseId || order.id,
    publicId: order.publicId || order.public_id || order.id,
    externalPaymentId
  };

  const result = await callKioskPaymentService("start", {
    amount: Math.round(Number(order.totals?.total || 0) * 100),
    externalPaymentId,
    kioskId: currentKioskId(),
    orderNumber: order.publicId || order.public_id || order.id,
    order
  });

  return { ...result, externalPaymentId };
}

async function cancelActiveKioskPayment() {
  const payment = state.activeKioskPayment;

  if (!payment) {
    closePayment();
    return;
  }

  const cancelButton = $("#cancelKioskPaymentButton");
  if (cancelButton) {
    cancelButton.disabled = true;
    cancelButton.textContent = state.lang === "en"
      ? "Cancelling payment…"
      : "Cancelando pago…";
  }

  try {
    const result = await callKioskPaymentService("cancel", {
      kioskId: currentKioskId(),
      externalPaymentId: payment.externalPaymentId
    });

    if (String(result?.status || "").toLowerCase() !== "cancelled") {
      throw new Error(
        state.lang === "en"
          ? "Clover did not confirm the cancellation."
          : "Clover no confirmó la cancelación."
      );
    }

    const db = window.FOGON_DB;
    if (db?.isReady?.() && payment.orderId) {
      try {
        await db.deleteOrder(payment.orderId);
      } catch (deleteError) {
        console.warn(
          "El pago fue cancelado, pero no se pudo borrar el pedido temporal:",
          deleteError
        );

        try {
          await db.updateKioskPayment(payment.orderId, {
            status: "payment_cancelled",
            paymentStatus: "cancelled",
            paymentError: "cancelled_by_customer",
            cloverExternalPaymentId: payment.externalPaymentId,
            checkoutMode: "pay_before_kitchen"
          });
        } catch (_) {}
      }
    }

    state.activeKioskPayment = null;
    closePayment();
  } catch (error) {
    console.error("No se pudo confirmar la cancelación en Clover:", error);

    setKioskPaymentVisual(
      "review",
      state.lang === "en"
        ? "The payment result is uncertain. Ask staff for help before trying again."
        : "El resultado del pago es incierto. Solicita ayuda antes de volver a intentarlo."
    );

    alert(
      state.lang === "en"
        ? "The payment window cannot be closed until Clover confirms the cancellation."
        : "No se puede cerrar la ventana hasta que Clover confirme la cancelación."
    );
  } finally {
    if (cancelButton) {
      cancelButton.disabled = false;
      cancelButton.textContent = state.lang === "en"
        ? "Cancel payment and return to menu"
        : "Cancelar pago y volver al menú";
    }
  }
}

function isConfirmedCloverPayment(result) {
  return Boolean(
    result &&
    String(result.status || "").toLowerCase() === "approved" &&
    String(result.cloverPaymentId || "").trim() &&
    String(result.completedAt || "").trim()
  );
}

async function saveOrder(paymentMethod) {
  if (!state.pendingOrder || orderSubmissionInProgress) return;

  orderSubmissionInProgress = true;

  const paymentButtons = Array.from(
    document.querySelectorAll("[data-payment]")
  );

  paymentButtons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  });

  let createdOrder = null;

  try {
    if (!currentOrderingState().open) {
      closePayment();
      alert(orderingClosedMessage());
      updateOrderingUi();
      return;
    }

    const originalPendingId = state.pendingOrder.id;

    // El modo guardado en Supabase manda. Nunca se inicia Clover por un valor
    // predeterminado o una configuración antigua en memoria.
    await loadPublicBusinessSettings();

    const checkoutMode = String(
      publicBusinessSettings.checkout_mode || "pay_at_counter"
    ).trim().toLowerCase();

    const kioskMode = checkoutMode === "pay_before_kitchen";
    const payWithCloverNow =
      kioskMode && paymentMethod === "card";

    const counterOrder = !payWithCloverNow;

    let order = {
      ...state.pendingOrder,
      paymentMethod,
      orderType: state.orderType,
      checkoutMode: payWithCloverNow
        ? "pay_before_kitchen"
        : "pay_at_counter",
      kioskId: currentKioskId(),
      paymentStatus: "pending",
      status: payWithCloverNow ? "awaiting_payment" : "new",
      kitchenVisible: counterOrder
    };

    order.items = (order.items || []).map((item, index) => (
      index === 0
        ? { ...item, orderType: state.orderType }
        : item
    ));

    const db = window.FOGON_DB;

    if (!db?.isReady()) {
      throw new Error(
        state.lang === "en"
          ? "The ordering service is temporarily unavailable."
          : "El servicio de pedidos no está disponible ahora mismo."
      );
    }

    createdOrder = await db.createOrder(order);
    createdOrder.orderType = state.orderType;
    createdOrder.checkoutMode = order.checkoutMode;
    createdOrder.kioskId = order.kioskId;

    if (payWithCloverNow) {
      setKioskPaymentStepVisible(true, createdOrder.totals?.total);
      setKioskPaymentVisual("waiting");

      const paymentResult =
        await startKioskBridgePayment(createdOrder);

      if (!isConfirmedCloverPayment(paymentResult)) {
        const paymentStatus = String(paymentResult.status || "failed").toLowerCase();
        const needsReview = paymentStatus === "review" || paymentStatus === "unknown";

        setKioskPaymentVisual(
          needsReview ? "review" : (paymentStatus === "cancelled" ? "cancelled" : "failed"),
          paymentResult.error || ""
        );

        await db.updateKioskPayment(
          createdOrder.databaseId || createdOrder.id,
          {
            paymentStatus: needsReview ? "review" : paymentStatus,
            paymentError: paymentResult.error || "",
            cloverExternalPaymentId:
              paymentResult.externalPaymentId || ""
          }
        );

        const paymentError = new Error(
          paymentResult.error ||
          (
            needsReview
              ? (state.lang === "en"
                  ? "Do not try to pay again. Ask staff to verify the Clover Flex."
                  : "No vuelvas a pagar. Solicita al personal que compruebe el Clover Flex.")
              : (state.lang === "en"
                  ? "The payment was not approved. Try another card."
                  : "El pago no fue aprobado. Prueba con otra tarjeta.")
          )
        );
        paymentError.paymentStatus = needsReview ? "review" : paymentStatus;
        paymentError.retrySafe = !needsReview;
        throw paymentError;
      }

      setKioskPaymentVisual("approved");

      createdOrder = await db.updateKioskPayment(
        createdOrder.databaseId || createdOrder.id,
        {
          status: "new",
          paymentStatus: "paid",
          paymentStartedAt:
            paymentResult.startedAt || new Date().toISOString(),
          paymentCompletedAt:
            paymentResult.completedAt || new Date().toISOString(),
          cloverPaymentId:
            paymentResult.cloverPaymentId || "",
          cloverExternalPaymentId:
            paymentResult.externalPaymentId || "",
          kioskId:
            currentKioskId(),
          checkoutMode: "pay_before_kitchen"
        }
      );

      state.activeKioskPayment = null;
    }

    const orders = JSON.parse(
      localStorage.getItem(STORAGE_ORDERS) || "[]"
    );

    orders.push(createdOrder);
    localStorage.setItem(STORAGE_ORDERS, JSON.stringify(orders));

    const activeOrderCount = await countActiveOrders();

    state.cart = [];

    const customerName = $("#customerName");
    const customerPhone = $("#customerPhone");

    if (customerName) customerName.value = "";
    if (customerPhone) customerPhone.value = "";

    renderCart();
    closeCart();

    const displayOrderNumber =
      createdOrder.publicId ||
      createdOrder.public_id ||
      createdOrder.id ||
      originalPendingId ||
      "";

    showOrderThanks(displayOrderNumber, activeOrderCount);
  } catch (error) {
    console.error("No se pudo completar el pedido:", error);

    const errorStatus = String(error?.paymentStatus || "failed").toLowerCase();
    const needsReview = errorStatus === "review" || errorStatus === "unknown";
    const needsReauthorization = errorStatus === "reauthorization_required";
    const finalFailureStatus = needsReview ? "review" : "failed";

    const createdAsKioskPayment =
      String(createdOrder?.checkoutMode || "") === "pay_before_kitchen";

    if (
      createdAsKioskPayment &&
      createdOrder &&
      window.FOGON_DB?.isReady?.()
    ) {
      try {
        await window.FOGON_DB.updateKioskPayment(
          createdOrder.databaseId || createdOrder.id,
          {
            paymentStatus: finalFailureStatus,
            paymentError: error?.message || String(error),
            cloverExternalPaymentId:
              error?.externalPaymentId || state.activeKioskPayment?.externalPaymentId || ""
          }
        );
      } catch (_) {}
    }

    const kioskStep = $("#kioskPaymentStep");
    const paymentStep = $("#paymentMethodStep");
    const cancelButton = $("#cancelKioskPaymentButton");

    if (needsReview) {
      if (kioskStep) kioskStep.hidden = false;
      if (paymentStep) paymentStep.hidden = true;
      if (cancelButton) {
        cancelButton.disabled = true;
        cancelButton.textContent = state.lang === "en"
          ? "Ask staff for help"
          : "Solicita ayuda al personal";
      }
      setKioskPaymentVisual(
        "review",
        state.lang === "en"
          ? "Do not pay again. The transaction must be checked on the Clover Flex."
          : "No vuelvas a pagar. La transacción debe comprobarse en el Clover Flex."
      );
    } else {
      if (kioskStep) kioskStep.hidden = true;
      if (paymentStep) paymentStep.hidden = false;
      if (cancelButton) {
        cancelButton.disabled = false;
        cancelButton.textContent = state.lang === "en" ? "Cancel payment" : "Cancelar pago";
      }
      if (needsReauthorization) {
        setKioskPaymentVisual("reauthorization_required", error?.message || "");
      }
      state.activeKioskPayment = null;
    }

    alert(
      error?.message ||
      (
        state.lang === "en"
          ? "The payment or order could not be completed."
          : "No se pudo completar el pago o el pedido."
      )
    );
  } finally {
    orderSubmissionInProgress = false;

    paymentButtons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute("aria-disabled");
    });
  }
}


function refreshModifierSelectionState(root = document) {
  root.querySelectorAll(".modifier-option").forEach((row) => {
    const input = row.querySelector("input");
    row.classList.toggle("is-selected", Boolean(input?.checked));
  });
}


function preventMenuZoomGestures() {
  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("gesturechange", (event) => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("gestureend", (event) => {
    event.preventDefault();
  }, { passive: false });

  let lastTouchEnd = 0;

  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 280) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

function bindLanguageButtons() {
  document.querySelectorAll("[data-set-lang]").forEach((button) => {
    if (button.dataset.languageBound === "true") return;
    button.dataset.languageBound = "true";

    const chooseLanguage = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const lang = String(button.dataset.setLang || "").trim();
      if (lang) setLanguage(lang);
    };

    button.addEventListener("click", chooseLanguage);
    button.addEventListener("pointerup", chooseLanguage);
  });
}

function initEvents() {
  document.addEventListener("click", async (event) => {
    const langButton = event.target.closest("[data-set-lang]");
    if (langButton) {
      event.preventDefault();
      event.stopPropagation();
      setLanguage(langButton.dataset.setLang);
      return;
    }

    if (event.target.closest("#themeToggleBtn")) toggleTheme();

    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      scrollToCategory(categoryButton.dataset.category);
    }

    const productButton = event.target.closest("[data-product-id]");
    if (productButton) {
      event.preventDefault();
      openProduct(productButton.dataset.productId);
      return;
    }

    if (event.target.closest(".modal-close")) {
      event.preventDefault();
      closeProduct();
      return;
    }

    if (event.target === $("#modalBackdrop")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest("#cartFab")) {
      if (document.body.classList.contains("cart-open")) {
        closeCart();
      } else {
        openCart();
      }
    }
    if (event.target.closest("#closeCartBtn")) closeCart();

    const quantityButton = event.target.closest("[data-cart-quantity]");
    if (quantityButton) {
      event.preventDefault();
      event.stopPropagation();
      changeCartQuantity(
        quantityButton.dataset.cartLine,
        Number(quantityButton.dataset.cartQuantity || 0)
      );
      return;
    }

    const removeButton = event.target.closest("[data-remove-cart]");
    if (removeButton) {
      event.preventDefault();
      event.stopPropagation();
      const lineId = String(removeButton.dataset.removeCart || "");
      state.cart = state.cart.filter((item) => String(item.id) !== lineId);
      renderCart();
      return;
    }

    const orderTypeButton = event.target.closest("[data-order-type]");
    if (orderTypeButton && state.pendingOrder) {
      state.orderType = orderTypeButton.dataset.orderType;

      // Releer la configuración justo antes de mostrar las formas de pago.
      await loadPublicBusinessSettings();

      $("#orderTypeStep").hidden = true;
      $("#paymentMethodStep").hidden = false;

      const kioskMode = isKioskCheckoutMode();
      const cardButton = document.querySelector('[data-payment="card"]');
      const cashButton = document.querySelector('[data-payment="cash"]');
      const subtitle = document.querySelector('#paymentMethodStep [data-i18n="paymentSubtitle"]');

      if (cardButton) {
        cardButton.hidden = false;
        cardButton.textContent = kioskMode
          ? `${state.lang === "en" ? "Pay by card" : "Pagar con tarjeta"} · ${money(state.pendingOrder.totals?.total)}`
          : (state.lang === "en"
              ? "Pay by card at the counter"
              : "Pagar con tarjeta por ventanilla");
      }

      if (cashButton) {
        cashButton.hidden = false;
        cashButton.textContent = state.lang === "en"
          ? "Pay cash at the counter"
          : "Pagar con efectivo por ventanilla";
      }

      if (subtitle) {
        subtitle.textContent = kioskMode
          ? (state.lang === "en"
              ? "Pay by card now on Clover, or choose cash at the counter."
              : "Paga ahora con tarjeta en Clover o elige efectivo en ventanilla.")
          : (state.lang === "en"
              ? "Choose card or cash at the counter. In both cases your order is sent to the kitchen now."
              : "Elige tarjeta o efectivo por ventanilla. En ambos casos tu pedido se envía ahora a Cocina.");
      }
    }

    if (event.target.closest("[data-close-payment-menu]")) {
      closePayment();
      return;
    }

    if (event.target.closest("#cancelKioskPaymentButton")) {
      void cancelActiveKioskPayment();
      return;
    }

    const paymentButton = event.target.closest("[data-payment]");
    if (paymentButton && state.pendingOrder && state.orderType) {
      saveOrder(paymentButton.dataset.payment);
    }

    if (event.target.closest("#closeOrderThanksBtn")) {
      closePayment();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches(".modifier-option input")) {
      refreshModifierSelectionState(event.target.closest(".modifier-group") || document);
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id === "productForm") {
      event.preventDefault();
      if (!event.target.checkValidity()) {
        alert(text("chooseRequired"));
        return;
      }
      addToCart(buildCartItem(event.target));
    }

    if (event.target.id === "checkoutForm") {
      event.preventDefault();
      if (!currentOrderingState().open) {
        alert(orderingClosedMessage());
        updateOrderingUi();
        return;
      }
      if (!event.target.checkValidity()) {
        event.target.reportValidity();
        return;
      }
      if (!state.cart.length) return;
      const totals = getTotals();
      openPayment({
        id: nextSimpleOrderId(),
        createdAt: new Date().toISOString(),
        customer: {
          name: $("#customerName").value.trim(),
          phone: $("#customerPhone").value.trim()
        },
        items: state.cart,
        totals,
        language: state.lang
      });
    }
  });
}

async function init() {
  applyTheme();
  await loadPublicBusinessSettings();
  preventMenuZoomGestures();
  initEvents();
  bindLanguageButtons();
  window.addEventListener("storage", (event) => {
    if (event.key === "fogon_availability") refreshAvailabilityIfChanged(false);
  });
  setInterval(refreshAvailabilityIfChanged, 1000);
  await loadPublicCatalog({ render: false, force: true });
  syncAvailabilityFromBackend();
  if (window.FOGON_DB?.isReady()) {
    window.FOGON_DB.subscribeAvailability(() => syncAvailabilityFromBackend());
    setInterval(syncAvailabilityFromBackend, 6000);
  }
  if (state.lang) {
    document.documentElement.lang = state.lang;
  }
  initializeLanguageGateTimer();
  applyText();
  renderCategories();
  renderMenu();
  renderCart();
  updateOrderingUi();
  setInterval(updateOrderingUi, 30000);

  setInterval(() => {
    loadPublicCatalog({ render: true }).catch((error) => {
      console.warn("No se pudo refrescar el catálogo público:", error);
    });
  }, 180000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const selectedAt = languageSelectionTimestamp();
      if (!selectedAt || Date.now() - selectedAt >= LANGUAGE_GATE_INTERVAL_MS) {
        showLanguageGate();
      } else {
        scheduleLanguageGate();
      }

      loadPublicCatalog({ render: true }).catch((error) => {
        console.warn("No se pudo refrescar el catálogo al volver a la página:", error);
      });
    }
  });

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      handlePageScroll();
      scrollTicking = false;
    });
  }, { passive: true });

  handlePageScroll();
}

init().catch((error) => {
  console.error("No se pudo iniciar el menú:", error);
});
