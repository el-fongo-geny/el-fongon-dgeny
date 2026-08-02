const state = {
  lang: localStorage.getItem("fogon_lang") || "",
  category: Array.isArray(CATEGORIES) && CATEGORIES.length ? CATEGORIES[0].id : "",
  cart: [],
  currentProduct: null,
  pendingOrder: null,
  orderType: "",
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
const WEEKLY_CLOSED_DAY_KEY = "system:weekly-closed-day";
let orderSubmissionInProgress = false;
let checkoutPhase = "closed";
const CALIFORNIA_TIME_ZONE = "America/Los_Angeles";
const ORDER_OPEN_MINUTES = 11 * 60;
const ORDER_CLOSE_MINUTES = 20 * 60 + 30;

function uniqueCartLineId(productId) {
  if (window.crypto?.randomUUID) return `${productId}-${window.crypto.randomUUID()}`;
  return `${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const configuredClosedDay = Number(availability[WEEKLY_CLOSED_DAY_KEY]);
  const weeklyClosed =
    Number.isInteger(configuredClosedDay) &&
    configuredClosedDay >= 0 &&
    configuredClosedDay <= 6 &&
    californiaWeekdayNow() === configuredClosedDay;

  const automaticOpen =
    !weeklyClosed &&
    californiaMinutesNow() >= ORDER_OPEN_MINUTES &&
    californiaMinutesNow() < ORDER_CLOSE_MINUTES;

  return {
    mode: weeklyClosed ? "weekly-closed" : manual ? (forcedOpen ? "open" : "closed") : "auto",
    open: weeklyClosed ? false : (manual ? forcedOpen : automaticOpen),
    weeklyClosed
  };
}

function orderingClosedMessage() {
  const status = currentOrderingState();
  if (status.weeklyClosed) {
    return state.lang === "en"
      ? "Online ordering is closed today for the restaurant's weekly closing day."
      : "Los pedidos en línea están cerrados hoy por el día semanal de cierre del local.";
  }
  return state.lang === "en"
    ? "Online ordering is currently closed. Regular ordering hours are 11:00 AM to 8:30 PM, California time."
    : "Los pedidos en línea están cerrados ahora mismo. El horario habitual es de 11:00 a. m. a 8:30 p. m., hora de California.";
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
      refreshAvailabilityIfChanged(true);
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
      refreshAvailabilityIfChanged(true);
    }
  } catch (error) {
    console.warn("No se pudo actualizar disponibilidad desde el backend:", error);
  }
}

function refreshAvailabilityIfChanged(force = false) {
  const nextSnapshot = localStorage.getItem("fogon_availability") || "{}";
  if (!force && nextSnapshot === lastAvailabilitySnapshot) return;
  lastAvailabilitySnapshot = nextSnapshot;
  renderMenu();
  updateOrderingUi();
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem("fogon_lang", lang);
  $("#languageGate").classList.add("hidden");
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

function productCardHtml(item, imageIndex) {
  const unavailable = !isProductAvailable(item);
  const priorityImage = imageIndex < 6;
  return `
    <article class="product-card ${unavailable ? "is-unavailable" : ""}">
      <button class="product-trigger" data-product-id="${item.id}" ${unavailable ? "disabled" : ""}>
        <div class="product-image">
          ${item.image ? `<img src="${item.image}" alt="${itemName(item)}" loading="${priorityImage ? "eager" : "lazy"}" fetchpriority="${priorityImage ? "high" : "auto"}" decoding="async" width="640" height="557" onerror="this.closest('.product-image').classList.add('missing-image'); this.remove();">` : ""}
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
  const item = MENU_ITEMS.find((product) => product.id === itemId);
  if (!item || !isProductAvailable(item)) return;

  state.currentProduct = item;
  const modal = $("#productModal");
  const groups = (item.optionGroups || []).map((group) => ({
    ...group,
    options: (group.options || []).filter((option) => isOptionAvailable(group, option))
  })).filter((group) => group.options.length || group.required);
  const extras = (item.extras || []).filter((extra) => isExtraAvailable(extra));
  const removables = (item.removables || []).filter((remove) => isRemovableAvailable(remove));

  modal.innerHTML = `
    <div class="modal-sheet">
      <button class="icon-btn modal-close" type="button" aria-label="Cerrar">×</button>
      <div class="modal-hero">
        <div class="product-image large">
          ${item.image ? `<img src="${item.image}" alt="${itemName(item)}" onerror="this.closest('.product-image').classList.add('missing-image'); this.remove();">` : ""}
        </div>
        <div>
          <h2>${itemName(item)}</h2>
          <p>${itemDescription(item)}</p>
          <strong>${money(item.price)}</strong>
        </div>
      </div>
      <form id="productForm" class="product-form">
        ${groups.map((group) => `
          <fieldset>
            <legend>${group[state.lang] || group.es} <span>${group.required ? text("required") : text("optional")}</span></legend>
            ${group.options.length ? group.options.map((option) => `
              <label class="choice-row">
                <input type="${group.type === "multi" ? "checkbox" : "radio"}" name="${group.id}" value="${option.id}" ${group.required ? "required" : ""}>
                <span>${optionLabel(option)}</span>
              </label>
            `).join("") : `<p class="choice-empty">${state.lang === "en" ? "Not available right now." : "No disponible por ahora."}</p>`}
          </fieldset>
        `).join("")}
        ${extras.length ? `
          <fieldset>
            <legend>Extras <span>${text("optional")}</span></legend>
            ${extras.map((extra) => `
              <label class="choice-row">
                <input type="checkbox" name="extras" value="${extra.id}">
                <span>${optionLabel(extra)}</span>
              </label>
            `).join("")}
          </fieldset>
        ` : ""}
        ${removables.length ? `
          <fieldset>
            <legend>${state.lang === "en" ? "Remove ingredients" : "Quitar ingredientes"} <span>${text("optional")}</span></legend>
            ${removables.map((remove) => `
              <label class="choice-row">
                <input type="checkbox" name="removables" value="${remove.id}">
                <span>${remove[state.lang] || remove.es}</span>
              </label>
            `).join("")}
          </fieldset>
        ` : ""}
        <label class="notes-label">
          <span>${text("notes")}</span>
          <textarea name="notes" rows="3"></textarea>
        </label>
        <button class="primary-btn full sticky-add" type="submit">${text("addToCart")} · ${money(item.price)}</button>
      </form>
    </div>
  `;
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
    taxable: false,
    taxRate: 0,
    selections,
    extras,
    removables,
    notes: form.notes.value.trim(),
    quantity: 1,
    lineTotal
  };
}

function addToCart(cartItem) {
  state.cart.push(cartItem);

  // Cierra el producto inmediatamente después de agregarlo.
  // Así, incluso si una actualización visual falla, el modal no queda abierto.
  closeProduct();

  renderCart();
  showAddedToCartNotice();
}

function getTotals() {
  const subtotal = state.cart.reduce((sum, item) => sum + item.lineTotal * item.quantity, 0);
  const tax = 0;
  return { subtotal, tax, total: subtotal };
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
        <div>
          <strong>${money(item.lineTotal * item.quantity)}</strong>
          <button class="text-btn cart-remove-btn" data-remove-cart="${item.id}" type="button" aria-label="${text("remove")} ${item.name}">${text("remove")}</button>
        </div>
      </div>
    `).join("");
  }
  const totals = getTotals();

  const subtotalValue = $("#subtotalValue");
  const taxValue = $("#taxValue");
  const totalValue = $("#totalValue");

  if (subtotalValue) subtotalValue.textContent = money(totals.subtotal);
  if (taxValue) taxValue.textContent = money(totals.tax);
  if (totalValue) totalValue.textContent = money(totals.total);
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

function setCheckoutPhase(phase) {
  checkoutPhase = phase;

  const orderTypeStep = $("#orderTypeStep");
  const paymentMethodStep = $("#paymentMethodStep");
  const orderThanksStep = $("#orderThanksStep");

  if (orderTypeStep) orderTypeStep.hidden = phase !== "order-type";
  if (paymentMethodStep) paymentMethodStep.hidden = phase !== "payment";
  if (orderThanksStep) orderThanksStep.hidden = phase !== "thanks";
}

function openPayment(order) {
  state.pendingOrder = order;
  state.orderType = "";
  setCheckoutPhase("order-type");
  $("#paymentModal").setAttribute("aria-hidden", "false");
}

function showOrderThanks(orderNumber, activeOrderCount = 0) {
  setCheckoutPhase("thanks");

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

  state.pendingOrder = null;
  state.orderType = "";
}

function closePayment() {
  $("#paymentModal").setAttribute("aria-hidden", "true");
  setCheckoutPhase("closed");
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

  try {
    if (!currentOrderingState().open) {
      closePayment();
      alert(orderingClosedMessage());
      updateOrderingUi();
      return;
    }

    const originalPendingId = state.pendingOrder.id;

    let order = {
      ...state.pendingOrder,
      paymentMethod,
      orderType: state.orderType,
      status: "new"
    };

    order.items = (order.items || []).map((item, index) => (
      index === 0
        ? { ...item, orderType: state.orderType }
        : item
    ));

    const db = window.FOGON_DB;

    if (db?.isReady()) {
      order = await db.createOrder(order);
      order.orderType = state.orderType;
    } else if (BACKEND_URL) {
      const result = await postOrderToBackend(order);
      if (result?.orderId) order.backendOrderId = result.orderId;
    } else {
      throw new Error(
        state.lang === "en"
          ? "The ordering service is temporarily unavailable. Please try again."
          : "El servicio de pedidos no está disponible ahora mismo. Inténtalo otra vez."
      );
    }

    const orders = JSON.parse(
      localStorage.getItem(STORAGE_ORDERS) || "[]"
    );

    orders.unshift(order);
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
      order.publicId ||
      order.public_id ||
      order.id ||
      originalPendingId ||
      "";

    showOrderThanks(displayOrderNumber, activeOrderCount);
  } catch (error) {
    console.error("No se pudo guardar el pedido:", error);

    alert(
      error?.message ||
      (
        state.lang === "en"
          ? "The order could not be sent. Please try again."
          : "No se pudo enviar el pedido. Inténtalo otra vez."
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

function initEvents() {
  document.addEventListener("click", (event) => {
    const langButton = event.target.closest("[data-set-lang]");
    if (langButton) setLanguage(langButton.dataset.setLang);

    if (event.target.closest("#themeToggleBtn")) toggleTheme();

    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      scrollToCategory(categoryButton.dataset.category);
    }

    const productButton = event.target.closest("[data-product-id]");
    if (productButton) openProduct(productButton.dataset.productId);

    if (event.target.closest(".modal-close") || event.target === $("#modalBackdrop")) closeProduct();
    if (event.target.closest("#cartFab")) {
      if (document.body.classList.contains("cart-open")) {
        closeCart();
      } else {
        openCart();
      }
    }
    if (event.target.closest("#closeCartBtn")) closeCart();

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
    if (orderTypeButton && state.pendingOrder && checkoutPhase === "order-type") {
      state.orderType = orderTypeButton.dataset.orderType;
      setCheckoutPhase("payment");
      return;
    }

    const paymentButton = event.target.closest("[data-payment]");
    if (
      paymentButton &&
      state.pendingOrder &&
      state.orderType &&
      checkoutPhase === "payment" &&
      !orderSubmissionInProgress
    ) {
      saveOrder(paymentButton.dataset.payment);
      return;
    }

    if (event.target.closest("#closeOrderThanksBtn")) {
      closePayment();
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
  initEvents();
  window.addEventListener("storage", (event) => {
    if (event.key === "fogon_availability" || event.key === null) refreshAvailabilityIfChanged(true);
  });
  setInterval(refreshAvailabilityIfChanged, 1000);
  await loadPublicCatalog({ render: false, force: true });
  syncAvailabilityFromBackend();
  if (window.FOGON_DB?.isReady()) {
    window.FOGON_DB.subscribeAvailability(() => syncAvailabilityFromBackend());
    setInterval(syncAvailabilityFromBackend, 6000);
  }
  if (state.lang) {
    $("#languageGate").classList.add("hidden");
    document.documentElement.lang = state.lang;
  }
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
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
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
