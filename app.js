window.FOGON_MENU_BUILD = "103-menu-repair-category-bar";

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
    /*
      V104.8A.1:
      No deshabilitamos físicamente el botón por un estado cacheado.
      Un <button disabled> no genera submit/click, por lo que el cliente
      no puede forzar una comprobación fresca de Supabase.
      La validación definitiva ocurre en el submit.
    */
    submit.disabled = false;
    submit.setAttribute("aria-disabled", String(!status.open));
    submit.classList.toggle("is-ordering-closed", !status.open);
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

async function fetchEdgeFunction(functionName, url, options) {
  try {
    return await fetch(url, options);
  } catch (cause) {
    const error = new Error(
      `No se pudo conectar con la función ${functionName}. ` +
      "Comprueba que esté desplegada y que CORS/Verify JWT permitan esta web."
    );
    error.code = "edge_function_network_error";
    error.functionName = functionName;
    error.cause = cause;
    throw error;
  }
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
  menu_title_es: "Haz tu pedido desde aquí",
  menu_title_en: "Order your favorites",
  menu_subtitle_es: "Elige tus platos, personalízalos, añádelos al carrito y completa tu pedido con tu nombre y teléfono.",
  menu_subtitle_en: "Choose your dishes, customize them, add them to the cart and complete your order with your name and phone number.",
  footer_title_es: "Comida dominicana y latina en San Jose, California",
  footer_title_en: "Dominican and Latin food in San Jose, California",
  footer_paragraph_1_es: "El Fogon D' Geny prepara autentica comida dominicana, latina y caribeña en el centro de San Jose.",
  footer_paragraph_1_en: "El Fogon D' Geny serves authentic Dominican, Latin and Caribbean food in downtown San Jose.",
  footer_paragraph_2_es: "Si buscas comida dominicana sabrosa, comida latina o un restaurante dominicano en San Jose, visita El Fogon D' Geny.",
  footer_paragraph_2_en: "If you are looking for flavorful Dominican food, Latin food or a Dominican restaurant in San Jose, visit El Fogon D' Geny.",
  address_es: "796 S 1st St, San Jose, CA 95113",
  address_en: "796 S 1st St, San Jose, CA 95113",
  maps_label_es: "Ver ubicación en Google Maps",
  maps_label_en: "View location on Google Maps",
  maps_url: "https://www.google.com/maps/search/?api=1&query=El+Fogon+D%27+Geny+796+S+1st+St+San+Jose+CA+95113",
  tax_enabled: false,
  tax_rate: 10,
  tax_only_taxable: true,
  checkout_mode: "pay_at_counter"
};

let publicBusinessSettings = { ...DEFAULT_PUBLIC_SETTINGS };


function localizedBusinessSetting(key, fallback = "") {
  const lang = state.lang === "en" ? "en" : "es";
  const localizedKey = `${key}_${lang}`;

  return (
    publicBusinessSettings[localizedKey] ||
    publicBusinessSettings[key] ||
    fallback
  );
}

function applyLocalizedBusinessText() {
  const heroTitle = document.querySelector('[data-i18n="heroTitle"]');
  const heroSubtitle = document.querySelector('[data-i18n="heroSubtitle"]');

  if (heroTitle) {
    heroTitle.textContent = localizedBusinessSetting(
      "menu_title",
      state.lang === "en" ? "Order your favorites" : "Haz tu pedido desde aquí"
    );
  }

  if (heroSubtitle) {
    heroSubtitle.textContent = localizedBusinessSetting(
      "menu_subtitle",
      state.lang === "en"
        ? "Choose your dishes, customize them, add them to the cart and complete your order with your name and phone number."
        : "Elige tus platos, personalízalos, añádelos al carrito y completa tu pedido con tu nombre y teléfono."
    );
  }

  document.querySelectorAll("[data-business-setting]").forEach((node) => {
    const key = node.dataset.businessSetting;
    const value = localizedBusinessSetting(key);
    if (value) node.textContent = value;
  });

  const mapsLink = document.getElementById("businessMapsLink");
  if (mapsLink && publicBusinessSettings.maps_url) {
    mapsLink.href = publicBusinessSettings.maps_url;
  }
}

function applyPublicBusinessSettings(settings = {}) {
  publicBusinessSettings = { ...DEFAULT_PUBLIC_SETTINGS, ...(settings || {}) };
  publicWeeklySchedule = normalizeWeeklySchedule(
    publicBusinessSettings.weekly_schedule
  );

  applyLocalizedBusinessText();
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
    return (group.options || []).some((option) => isOptionAvailable(group, option));
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

  // V104.6: cada selección explícita de idioma abre las categorías.
  // Mantiene intacto el cierre/apertura manual posterior del usuario.
  openCategoryDrawer({ persist: true });

  setInterval(() => {
    renderCategories();
  }, 60000);
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
  applyLocalizedBusinessText();

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

const CATEGORY_DRAWER_STORAGE_KEY = "fogon_category_drawer_open";

function categoryImageForHour(categoryId) {
  const products = MENU_ITEMS.filter(
    (item) =>
      item.category === categoryId &&
      item.visible !== false &&
      String(item.image || "").trim()
  );

  if (!products.length) return "";

  const hourBucket = Math.floor(Date.now() / 3600000);
  let hash = 0;
  const seed = `${categoryId}:${hourBucket}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }

  return products[Math.abs(hash) % products.length]?.image || "";
}

function renderCategories() {
  const tabs = $("#categoryTabs");
  if (!tabs) return;

  tabs.innerHTML = CATEGORIES.map((category) => {
    const image = categoryImageForHour(category.id);
    return `
      <button class="category-drawer-item ${category.id === state.category ? "active" : ""}" data-category="${escapeAttribute(category.id)}" type="button">
        <span class="category-drawer-image ${image ? "has-image" : ""}">
          ${image ? `<img src="${escapeAttribute(image)}" alt="" loading="lazy" decoding="async">` : `<span>FG</span>`}
        </span>
        <span class="category-drawer-label">${escapeHtml(category[state.lang] || category.es)}</span>
      </button>
    `;
  }).join("");
}

function openCategoryDrawer({ persist = true } = {}) {
  document.body.classList.add("category-drawer-open");
  $("#categoryDrawer")?.setAttribute("aria-hidden", "false");
  if ($("#categoryDrawerBackdrop")) $("#categoryDrawerBackdrop").hidden = false;
  if (persist) localStorage.setItem(CATEGORY_DRAWER_STORAGE_KEY, "1");
}

function closeCategoryDrawer({ persist = true } = {}) {
  document.body.classList.remove("category-drawer-open");
  $("#categoryDrawer")?.setAttribute("aria-hidden", "true");
  if ($("#categoryDrawerBackdrop")) $("#categoryDrawerBackdrop").hidden = true;
  if (persist) localStorage.setItem(CATEGORY_DRAWER_STORAGE_KEY, "0");
}

function toggleCategoryDrawer() {
  if (document.body.classList.contains("category-drawer-open")) {
    closeCategoryDrawer();
  } else {
    openCategoryDrawer();
  }
}

function restoreCategoryDrawerState() {
  const saved = localStorage.getItem(CATEGORY_DRAWER_STORAGE_KEY);
  if (saved === "1" && window.innerWidth > 700) {
    openCategoryDrawer({ persist: false });
  } else {
    closeCategoryDrawer({ persist: false });
  }
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
  closeCategoryDrawer();
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
    options: (group.options || []).map((option) => ({
      ...option,
      available: isOptionAvailable(group, option)
    }))
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
          <label class="modifier-option ${option.available ? "" : "is-sold-out"}">
            <input
              type="${group.type === "multi" ? "checkbox" : "radio"}"
              name="${escapeAttribute(group.id)}"
              value="${escapeAttribute(option.id)}"
              ${group.required && option.available ? "required" : ""}
              ${option.available ? "" : "disabled"}
            >
            <span class="modifier-control" aria-hidden="true"></span>
            <span class="modifier-option-copy">
              <strong>${escapeHtml(option[state.lang] || option.es)}</strong>
              ${option.available
                ? (Number(option.price || 0) !== 0
                  ? `<small>${Number(option.price) > 0 ? "+" : ""}${money(option.price)}</small>`
                  : `<small>${state.lang === "en" ? "Included" : "Incluido"}</small>`)
                : `<small class="modifier-sold-out">${state.lang === "en" ? "Sold out" : "Agotado"}</small>`}
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
        groupId: group.id,
        optionId: option.id,
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
      id: extra.id,
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
        id: remove.id,
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
          <div class="cart-item-actions-top">
            <strong class="cart-line-total">${money(item.lineTotal * item.quantity)}</strong>
            <button class="text-btn cart-remove-btn" data-remove-cart="${item.id}" type="button" aria-label="${text("remove")} ${item.name}">${text("remove")}</button>
          </div>
          <div class="cart-quantity-control" role="group" aria-label="${state.lang === "en" ? "Quantity" : "Cantidad"} ${item.name}">
            <button class="cart-quantity-btn" data-cart-quantity="-1" data-cart-line="${item.id}" type="button" aria-label="${state.lang === "en" ? "Decrease" : "Disminuir"} ${item.name}">−</button>
            <output class="cart-quantity-value" aria-live="polite">${item.quantity}</output>
            <button class="cart-quantity-btn" data-cart-quantity="1" data-cart-line="${item.id}" type="button" aria-label="${state.lang === "en" ? "Increase" : "Aumentar"} ${item.name}">+</button>
          </div>
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

  // Refresca el estado real de apertura al entrar al carrito.
  void syncAvailabilityFromBackend()
    .then(() => updateOrderingUi())
    .catch((error) => {
      console.warn("No se pudo refrescar el estado de pedidos al abrir el carrito:", error);
      updateOrderingUi();
    });
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

  // V104.8A.2:
  // El flujo de confirmación tiene prioridad absoluta sobre el carrito.
  closeCart();
  document.body.classList.add("payment-open", "modal-open");

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

function closePaymentFlow() {
  const modal = $("#paymentModal");
  if (modal) modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("payment-open", "modal-open");
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
  closePaymentFlow();

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



function explicitKioskId() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("kiosk") || "").trim();
}

function hasExplicitKioskUrl() {
  return Boolean(explicitKioskId());
}

function currentKioskId() {
  return (
    explicitKioskId() ||
    publicBusinessSettings.kiosk_id ||
    "kiosk-01"
  ).trim();
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
  return (
    hasExplicitKioskUrl() &&
    String(publicBusinessSettings.checkout_mode || "pay_at_counter")
      .trim()
      .toLowerCase() === "pay_before_kitchen"
  );
}

function kioskPaymentFunctionName() {
  return String(
    publicBusinessSettings.kiosk_payment_function ||
    "clover-kiosk-payment"
  ).trim() || "clover-kiosk-payment";
}


const KIOSK_DEVICE_CREDENTIAL_PREFIX = "fogon_kiosk_device_credential_";
const KIOSK_SESSION_PREFIX = "fogon_kiosk_session_";
const KIOSK_SESSION_EXPIRY_PREFIX = "fogon_kiosk_session_expiry_";

function kioskCredentialStorageKey(kioskId) {
  return `${KIOSK_DEVICE_CREDENTIAL_PREFIX}${kioskId}`;
}

function kioskSessionStorageKey(kioskId) {
  return `${KIOSK_SESSION_PREFIX}${kioskId}`;
}

function kioskSessionExpiryStorageKey(kioskId) {
  return `${KIOSK_SESSION_EXPIRY_PREFIX}${kioskId}`;
}

function storedKioskCredential(kioskId) {
  try {
    return String(
      localStorage.getItem(kioskCredentialStorageKey(kioskId)) || ""
    ).trim();
  } catch (_) {
    return "";
  }
}

function storedKioskSession(kioskId) {
  try {
    const token = String(
      sessionStorage.getItem(kioskSessionStorageKey(kioskId)) || ""
    ).trim();

    const expiresAt = Number(
      sessionStorage.getItem(kioskSessionExpiryStorageKey(kioskId)) || 0
    );

    if (!token || !expiresAt || expiresAt <= Date.now() + 30_000) {
      return "";
    }

    return token;
  } catch (_) {
    return "";
  }
}

function saveKioskIdentity(kioskId, credential, sessionToken, expiresAt) {
  try {
    if (credential) {
      localStorage.setItem(
        kioskCredentialStorageKey(kioskId),
        credential
      );
    }

    if (sessionToken) {
      sessionStorage.setItem(
        kioskSessionStorageKey(kioskId),
        sessionToken
      );
    }

    if (expiresAt) {
      sessionStorage.setItem(
        kioskSessionExpiryStorageKey(kioskId),
        String(Date.parse(expiresAt) || 0)
      );
    }
  } catch (_) {}
}

async function callKioskSessionService(action, payload = {}) {
  const { supabaseUrl, anonKey } = publicCatalogFunctionConfig();

  const response = await fetchEdgeFunction(
    "kiosk-device-session",
    `${supabaseUrl}/functions/v1/kiosk-device-session`,
    {
      method: "POST",
      cache: "no-store",
      headers: publicCatalogHeaders(anonKey),
      body: JSON.stringify({
        action,
        kioskId: currentKioskId(),
        ...payload
      })
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result?.ok !== true) {
    const error = new Error(
      result?.error || `HTTP ${response.status}`
    );
    error.httpStatus = response.status;
    throw error;
  }

  return result;
}

let kioskPairingResolver = null;

function setKioskActivationMessage(message = "", isError = false) {
  const node = $("#kioskActivationMessage");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", Boolean(isError));
}

function closeKioskActivationModal() {
  const modal = $("#kioskActivationModal");
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }
  const input = $("#kioskActivationCode");
  if (input) input.value = "";
  setKioskActivationMessage("");
}

function requestKioskPairingCode() {
  if (!hasExplicitKioskUrl()) {
    return Promise.reject(new Error("Esta página no es una URL de kiosco."));
  }

  const modal = $("#kioskActivationModal");
  const input = $("#kioskActivationCode");
  const idNode = $("#kioskActivationId");
  if (!modal || !input) {
    return Promise.reject(new Error("No se pudo abrir la vinculación del kiosco."));
  }

  if (idNode) idNode.textContent = currentKioskId();
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  setKioskActivationMessage(
    state.lang === "en"
      ? "Enter the 8-digit pairing code generated in the Admin Menu."
      : "Introduce el código de 8 dígitos generado en Gestionar menú."
  );

  setTimeout(() => input.focus(), 50);

  return new Promise((resolve, reject) => {
    kioskPairingResolver = { resolve, reject };
  });
}

async function ensureKioskSession({ interactive = true } = {}) {
  if (!hasExplicitKioskUrl()) {
    throw new Error(
      state.lang === "en"
        ? "This page is not configured as a kiosk."
        : "Esta página no está configurada como kiosco."
    );
  }

  const kioskId = currentKioskId();
  const currentSession = storedKioskSession(kioskId);

  if (currentSession) return currentSession;

  const credential = storedKioskCredential(kioskId);

  if (credential) {
    try {
      const result = await callKioskSessionService("start", {
        deviceSecret: credential
      });

      saveKioskIdentity(kioskId, "", result.sessionToken, result.expiresAt);
      closeKioskActivationModal();
      return result.sessionToken;
    } catch (error) {
      if (error?.httpStatus !== 401 && error?.httpStatus !== 403) throw error;
      try {
        localStorage.removeItem(kioskCredentialStorageKey(kioskId));
      } catch (_) {}
    }
  }

  if (!interactive) {
    throw new Error("kiosk_pairing_required");
  }

  const pairingCode = await requestKioskPairingCode();

  try {
    const result = await callKioskSessionService("pair", {
      pairingCode: String(pairingCode).replace(/\D/g, "").slice(0, 8)
    });

    saveKioskIdentity(
      kioskId,
      result.deviceCredential,
      result.sessionToken,
      result.expiresAt
    );

    closeKioskActivationModal();
    return result.sessionToken;
  } catch (error) {
    setKioskActivationMessage(
      state.lang === "en"
        ? "The code is invalid, expired, or this kiosk is disabled."
        : "El código es incorrecto, caducó o este kiosco está desactivado.",
      true
    );
    throw error;
  }
}

async function bootstrapKioskIdentity() {
  if (!hasExplicitKioskUrl()) return;

  try {
    await ensureKioskSession({ interactive: true });
  } catch (error) {
    console.warn("El kiosco todavía no está vinculado:", error);
  }
}

async function callKioskPaymentService(action, payload = {}) {
  const { supabaseUrl, anonKey } = publicCatalogFunctionConfig();
  const functionName = kioskPaymentFunctionName();

  const sessionToken = action === "health"
    ? ""
    : await ensureKioskSession();

  const headers = {
    ...publicCatalogHeaders(anonKey)
  };

  if (sessionToken) {
    headers["x-kiosk-session"] = sessionToken;
  }

  const response = await fetchEdgeFunction(functionName, `${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify({
      action,
      kioskId: currentKioskId(),
      ...payload
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    const error = new Error(
      result?.detail || result?.error || result?.message || `HTTP ${response.status}`
    );
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

  const cancelButton = $("#cancelKioskPaymentButton");
  const reviewMessage = $("#kioskReviewStaffMessage");
  const leaveReviewButton = $("#leaveKioskReviewButton");
  if (cancelButton) cancelButton.hidden = false;
  if (reviewMessage) reviewMessage.hidden = true;
  if (leaveReviewButton) leaveReviewButton.hidden = true;
}


async function createSecurePublicOrder(order) {
  const { supabaseUrl, anonKey } = publicCatalogFunctionConfig();

  const response = await fetch(
    `${supabaseUrl}/functions/v1/public-order-create`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        ...publicCatalogHeaders(anonKey)
      },
      body: JSON.stringify({
        checkoutId: order.checkoutId || order.id,
        customer: {
          name: order.customer?.name || "",
          phone: order.customer?.phone || ""
        },
        language: order.language || state.lang || "es",
        orderType: order.orderType || state.orderType || "takeout",
        paymentMethod: order.paymentMethod || "card",
        items: (order.items || []).map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity || 1),
          notes: String(item.notes || "").slice(0, 500),
          selections: (item.selections || []).map((selection) => ({
            groupId: selection.groupId || "",
            optionId: selection.optionId || ""
          })),
          extras: (item.extras || []).map((extra) => ({
            id: extra.id || ""
          })),
          removables: (item.removables || []).map((remove) => ({
            id: remove.id || ""
          }))
        }))
      })
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result?.ok !== true || !result?.order) {
    const error = new Error(
      result?.detail || result?.error || `HTTP ${response.status}`
    );
    error.httpStatus = response.status;
    error.code = String(result?.error || "public_order_create_failed");
    throw error;
  }

  return result.order;
}

async function createSecureKioskOrder(order) {
  const { supabaseUrl, anonKey } = publicCatalogFunctionConfig();
  const sessionToken = await ensureKioskSession();

  const response = await fetchEdgeFunction(
    "kiosk-order-create",
    `${supabaseUrl}/functions/v1/kiosk-order-create`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        ...publicCatalogHeaders(anonKey),
        "x-kiosk-session": sessionToken
      },
      body: JSON.stringify({
        kioskId: currentKioskId(),
        checkoutId: order.checkoutId || order.id,
        checkoutMode: order.checkoutMode || "pay_at_counter",
        customer: {
          name: order.customer?.name || "",
          phone: order.customer?.phone || ""
        },
        language: order.language || state.lang || "es",
        orderType: order.orderType || state.orderType || "takeout",
        paymentMethod: order.paymentMethod || "card",
        items: (order.items || []).map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity || 1),
          notes: String(item.notes || "").slice(0, 500),
          selections: (item.selections || []).map((selection) => ({
            groupId: selection.groupId || "",
            optionId: selection.optionId || ""
          })),
          extras: (item.extras || []).map((extra) => ({
            id: extra.id || ""
          })),
          removables: (item.removables || []).map((remove) => ({
            id: remove.id || ""
          }))
        }))
      })
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result?.ok !== true || !result?.order) {
    const error = new Error(
      result?.detail || result?.error || result?.message || `HTTP ${response.status}`
    );
    error.httpStatus = response.status;
    throw error;
  }

  return result.order;
}

async function startKioskBridgePayment(order) {
  const orderId = order.databaseId || order.id;

  // V104.2: primero el servidor reclama/crea el intento de pago de forma atómica.
  // El navegador nunca inventa el Idempotency-Key de Clover.
  const prepared = await callKioskPaymentService("prepare", { orderId });

  state.activeKioskPayment = {
    orderId,
    publicId: order.publicId || order.public_id || order.id,
    paymentAttemptId: prepared.paymentAttemptId || "",
    externalPaymentId: prepared.externalPaymentId || ""
  };

  const result = await callKioskPaymentService("start", {
    orderId,
    paymentAttemptId: prepared.paymentAttemptId
  });

  return {
    ...result,
    paymentAttemptId: prepared.paymentAttemptId,
    externalPaymentId: prepared.externalPaymentId
  };
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
      paymentAttemptId: payment.paymentAttemptId || "",
      externalPaymentId: payment.externalPaymentId || ""
    });

    if (String(result?.status || "").toLowerCase() !== "cancelled") {
      throw new Error(
        state.lang === "en"
          ? "Clover did not confirm the cancellation."
          : "Clover no confirmó la cancelación."
      );
    }

    // clover-kiosk-payment registra la cancelación del pedido desde servidor.
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

function leaveKioskPaymentReview() {
  const kioskStep = $("#kioskPaymentStep");

  if (kioskStep?.dataset.paymentStatus !== "review") return;

  // El intento queda intacto en Supabase para que el personal lo revise.
  // Limpiamos el carrito local para impedir que el cliente cree y pague
  // accidentalmente un segundo pedido mientras el primero sigue incierto.
  state.cart = [];
  renderCart();
  closePayment();
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

    const kioskPage = hasExplicitKioskUrl();
    const kioskMode = kioskPage && checkoutMode === "pay_before_kitchen";
    const payWithCloverNow =
      kioskMode && paymentMethod === "card";

    // Efectivo nunca depende de Clover. En una URL de kiosco sigue usando
    // el creador seguro para evitar duplicados, pero entra a Cocina de inmediato.
    const secureKioskOrder = kioskPage;
    const counterOrder = !payWithCloverNow;

    let order = {
      ...state.pendingOrder,
      checkoutId: state.pendingOrder.checkoutId || state.pendingOrder.id,
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

    createdOrder = secureKioskOrder
      ? await createSecureKioskOrder(order)
      : await createSecurePublicOrder(order);

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

        // El servidor registra el estado del intento y del pedido.


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

      createdOrder = {
        ...createdOrder,
        status: "new",
        paymentStatus: "paid",
        checkoutMode: "pay_before_kitchen",
        kitchenVisible: true,
        cloverPaymentId: paymentResult.cloverPaymentId || "",
        cloverExternalPaymentId: paymentResult.externalPaymentId || ""
      };

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

    // Los pedidos kiosco se modifican únicamente desde Edge Functions.

    const kioskStep = $("#kioskPaymentStep");
    const paymentStep = $("#paymentMethodStep");
    const cancelButton = $("#cancelKioskPaymentButton");
    const reviewMessage = $("#kioskReviewStaffMessage");
    const leaveReviewButton = $("#leaveKioskReviewButton");

    if (needsReview) {
      if (kioskStep) kioskStep.hidden = false;
      if (paymentStep) paymentStep.hidden = true;
      if (cancelButton) {
        cancelButton.hidden = true;
        cancelButton.disabled = false;
      }
      if (reviewMessage) {
        reviewMessage.hidden = false;
        reviewMessage.textContent = state.lang === "en"
          ? "The order was recorded. Ask staff to check the payment in Clover. Do not try to pay again."
          : "El pedido quedó registrado. Avisa al personal para que compruebe el cobro en Clover. No intentes pagar otra vez.";
      }
      if (leaveReviewButton) {
        leaveReviewButton.hidden = false;
        leaveReviewButton.textContent = state.lang === "en"
          ? "Back to menu"
          : "Volver al menú";
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
        cancelButton.hidden = false;
        cancelButton.disabled = false;
        cancelButton.textContent = state.lang === "en" ? "Cancel payment" : "Cancelar pago";
      }
      if (reviewMessage) reviewMessage.hidden = true;
      if (leaveReviewButton) leaveReviewButton.hidden = true;
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
  // V102: pinch-zoom is allowed; CSS touch-action handles accidental double taps.
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

    if (event.target.closest("#cancelKioskActivationBtn")) {
      if (kioskPairingResolver?.reject) {
        kioskPairingResolver.reject(new Error("pairing_cancelled"));
      }
      kioskPairingResolver = null;
      closeKioskActivationModal();
      return;
    }

    if (event.target.closest("#categoryDrawerToggle")) {
      toggleCategoryDrawer();
      return;
    }

    if (event.target.closest("#categoryDrawerClose") || event.target.closest("#categoryDrawerBackdrop")) {
      closeCategoryDrawer();
      return;
    }

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

    if (event.target.closest("#leaveKioskReviewButton")) {
      leaveKioskPaymentReview();
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

  document.addEventListener("submit", async (event) => {
    if (event.target.id === "kioskActivationForm") {
      event.preventDefault();
      const code = String($("#kioskActivationCode")?.value || "")
        .replace(/\D/g, "")
        .slice(0, 8);

      if (!/^\d{8}$/.test(code)) {
        setKioskActivationMessage(
          state.lang === "en" ? "Enter all 8 digits." : "Introduce los 8 dígitos.",
          true
        );
        return;
      }

      const resolver = kioskPairingResolver;
      kioskPairingResolver = null;
      if (resolver?.resolve) resolver.resolve(code);
      return;
    }

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

      const checkoutForm = event.target;
      const submitButton = checkoutForm.querySelector('button[type="submit"]');

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");
      }

      try {
        /*
          Fuente de verdad: Supabase.
          Evita rechazar el pedido por un fogon_availability antiguo en
          localStorage cuando el restaurante acaba de abrir manualmente.
        */
        await syncAvailabilityFromBackend();
        updateOrderingUi();

        if (!currentOrderingState().open) {
          alert(orderingClosedMessage());
          updateOrderingUi();
          return;
        }

        if (!checkoutForm.checkValidity()) {
          checkoutForm.reportValidity();
          return;
        }

        if (!state.cart.length) return;

        const totals = getTotals();
        openPayment({
        id: nextSimpleOrderId(),
        checkoutId: (crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        createdAt: new Date().toISOString(),
        customer: {
          name: $("#customerName").value.trim(),
          phone: $("#customerPhone").value.trim()
        },
        items: state.cart,
        totals,
        language: state.lang
        });
      } catch (error) {
        console.error("No se pudo comprobar el estado del restaurante:", error);

        alert(
          state.lang === "en"
            ? "We could not verify whether online ordering is open. Check your connection and try again."
            : "No pudimos comprobar si los pedidos están abiertos. Revisa la conexión e inténtalo de nuevo."
        );
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
        }
        updateOrderingUi();
      }
    }
  });
}

async function init() {
  applyTheme();
  await loadPublicBusinessSettings();
  initEvents();
  bindLanguageButtons();
  void bootstrapKioskIdentity();
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
