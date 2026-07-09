const state = {
  lang: localStorage.getItem("fogon_lang") || "",
  category: CATEGORIES[0].id,
  cart: [],
  currentProduct: null,
  pendingOrder: null,
  theme: localStorage.getItem("fogon_theme") || "light",
  cartFabCompact: false
};

let lastScrollY = window.scrollY || 0;
let scrollRevealLockUntil = 0;

const STORAGE_ORDERS = "fogon_orders";
const STORAGE_ORDER_COUNTER = "fogon_order_counter";
const BACKEND_URL = (window.FOGON_BACKEND_URL || "").replace(/\/$/, "");

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const text = (key) => UI_TEXT[state.lang || "es"][key] || key;
const itemName = (item) => item[state.lang] || item.es;
const itemDescription = (item) => item.description?.[state.lang] || item.description?.es || "";
let lastAvailabilitySnapshot = localStorage.getItem("fogon_availability") || "{}";

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
  return availabilityValue(optionAvailabilityKey(group, option));
}

function isExtraAvailable(extra) {
  return availabilityValue(extraAvailabilityKey(extra));
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
  handlePageScroll();
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
  const active = tabs.querySelector(`[data-category="${state.category}"]`);
  if (active) active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
}

function productCardHtml(item) {
  const unavailable = !isProductAvailable(item);
  return `
    <article class="product-card ${unavailable ? "is-unavailable" : ""}">
      <button class="product-trigger" data-product-id="${item.id}" ${unavailable ? "disabled" : ""}>
        <div class="product-image">
          ${item.image ? `<img src="${item.image}" alt="${itemName(item)}" loading="lazy" onerror="this.closest('.product-image').classList.add('missing-image'); this.remove();">` : ""}
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
  grid.innerHTML = CATEGORIES.map((category) => {
    const items = MENU_ITEMS.filter((item) => item.category === category.id);
    if (!items.length) return "";
    return `
      <section class="category-section" id="cat-${category.id}" data-category-section="${category.id}">
        <div class="category-title">
          <h2>${category[state.lang] || category.es}</h2>
          <span>${items.length}</span>
        </div>
        <div class="category-products">
          ${items.map(productCardHtml).join("")}
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
      renderCategories();
      const active = Array.from(document.querySelectorAll("[data-category]")).find((button) => button.dataset.category === nextCategory);
      if (active) active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
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
        price: Number(option.price || 0)
      });
    });
  });

  const extras = [];
  Array.from(form.querySelectorAll(`[name="extras"]:checked`)).forEach((input) => {
    const extra = (item.extras || []).find((candidate) => candidate.id === input.value);
    if (!extra) return;
    lineTotal += Number(extra.price || 0);
    extras.push({ name: extra[state.lang] || extra.es, price: Number(extra.price || 0) });
  });

  const removables = [];
  Array.from(form.querySelectorAll(`[name="removables"]:checked`)).forEach((input) => {
    const remove = (item.removables || []).find((candidate) => candidate.id === input.value);
    if (remove) removables.push(remove[state.lang] || remove.es);
  });

  return {
    id: `${item.id}-${Date.now()}`,
    productId: item.id,
    name: itemName(item),
    basePrice: Number(item.price),
    taxable: item.taxable !== false,
    taxRate: TAX_RATE_SAN_JOSE_CA,
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
  renderCart();
  closeProduct();
  openCart();
}

function getTotals() {
  const subtotal = state.cart.reduce((sum, item) => sum + item.lineTotal * item.quantity, 0);
  const tax = state.cart.reduce((sum, item) => item.taxable ? sum + item.lineTotal * item.quantity * item.taxRate : sum, 0);
  return { subtotal, tax, total: subtotal + tax };
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
          ${item.removables.map((remove) => `<p>${remove}</p>`).join("")}
          ${item.notes ? `<p>${item.notes}</p>` : ""}
        </div>
        <div>
          <strong>${money(item.lineTotal * item.quantity)}</strong>
          <button class="text-btn" data-remove-cart="${item.id}" type="button">${text("remove")}</button>
        </div>
      </div>
    `).join("");
  }
  const totals = getTotals();
  $("#subtotalValue").textContent = money(totals.subtotal);
  $("#taxValue").textContent = money(totals.tax);
  $("#totalValue").textContent = money(totals.total);
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
  $("#paymentModal").setAttribute("aria-hidden", "false");
}

function closePayment() {
  $("#paymentModal").setAttribute("aria-hidden", "true");
  state.pendingOrder = null;
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

async function saveOrder(paymentMethod) {
  if (!state.pendingOrder) return;

  let order = { ...state.pendingOrder, paymentMethod, status: "new" };
  const db = window.FOGON_DB;

  if (db?.isReady()) {
    try {
      order = await db.createOrder(order);
    } catch (error) {
      console.error(error);
      alert(state.lang === "en"
        ? "The order could not be sent. Please try again."
        : "No se pudo enviar el pedido. Inténtalo otra vez.");
      return;
    }
  } else {
    try {
      const result = await postOrderToBackend(order);
      if (result?.orderId) order.backendOrderId = result.orderId;
    } catch (error) {
      console.warn("No se pudo enviar el pedido al backend todavía:", error);
    }
  }

  const orders = JSON.parse(localStorage.getItem(STORAGE_ORDERS) || "[]");
  orders.unshift(order);
  localStorage.setItem(STORAGE_ORDERS, JSON.stringify(orders));

  state.cart = [];
  renderCart();
  closeCart();
  closePayment();
  alert(text("orderSent"));
}

function initEvents() {
  window.addEventListener("scroll", handlePageScroll, { passive: true });

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
    if (event.target.closest("#cartFab")) openCart();
    if (event.target.closest("#closeCartBtn")) closeCart();

    const removeButton = event.target.closest("[data-remove-cart]");
    if (removeButton) {
      state.cart = state.cart.filter((item) => item.id !== removeButton.dataset.removeCart);
      renderCart();
    }

    const paymentButton = event.target.closest("[data-payment]");
    if (paymentButton && state.pendingOrder) saveOrder(paymentButton.dataset.payment);
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

function init() {
  applyTheme();
  initEvents();
  window.addEventListener("storage", (event) => {
    if (event.key === "fogon_availability" || event.key === null) refreshAvailabilityIfChanged(true);
  });
  setInterval(refreshAvailabilityIfChanged, 1000);
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
  handlePageScroll();
}

init();
