(() => {
  "use strict";

window.FOGON_MENU_ADMIN_BUILD = "87-kiosk-settings";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const money = (value) => `$${Number(value || 0).toFixed(2)}`;

  window.FOGON_MENU_ADMIN_BUILD = "72-availability-business";

  const state = {
    pin: "",
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
    view: "products",
    query: "",
    category: "all",
    status: "all",
    selectedProductId: null,
    creatingProduct: false,
    editingCategoryId: null,
    dirty: false,
    busy: false,
    imageUploading: false,
    optionDraftGroups: [],
    availabilityQuery: "",
    businessSettings: {}
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function supabaseConfig() {
    const cfg = window.FOGON_SUPABASE || {};
    const url = String(cfg.url || "").replace(/\/$/, "");
    const anonKey = String(cfg.anonKey || "").trim();

    if (!url || !anonKey) {
      throw new Error("Faltan la URL o la anon key en supabase-config.js.");
    }

    return { url, anonKey };
  }

  function buildEdgeFunctionHeaders(anonKey) {
    const headers = {
      "Content-Type": "application/json",
      apikey: anonKey
    };

    const looksLikeJwt =
      anonKey.startsWith("eyJ") &&
      anonKey.split(".").length === 3;

    if (looksLikeJwt) {
      headers.Authorization = `Bearer ${anonKey}`;
    }

    return headers;
  }

  function menuAdminErrorMessage(error) {
    const status = Number(error?.status || 0);
    const payload = error?.payload || {};
    const code = String(payload?.error || "").trim();
    const detail = String(payload?.detail || error?.message || error || "").trim();

    if (status === 401 && code === "invalid_menu_admin_pin") {
      return "PIN de gestión del menú incorrecto.";
    }

    if (code === "missing_menu_admin_pin_secret") {
      return "Falta crear el Secret MENU_ADMIN_PIN en Supabase.";
    }

    if (code === "invalid_access_scope") {
      return "La función admin-catalog no reconoce el acceso de gestión del menú.";
    }

    if (code === "invalid_image_type") {
      return "El archivo seleccionado no es una imagen compatible.";
    }

    if (code === "image_too_large") {
      return "La imagen es demasiado grande. Elige otra foto o reduce su tamaño.";
    }

    if (code === "image_upload_failed") {
      return detail || "Supabase Storage no pudo guardar la imagen.";
    }

    if (status === 404) {
      return "La función admin-catalog no existe o todavía no está desplegada.";
    }

    if (/invalid jwt/i.test(detail)) {
      return "Supabase está bloqueando admin-catalog por JWT. Desactiva Verify JWT para esta función.";
    }

    if (/missing authorization header/i.test(detail)) {
      return "Verify JWT sigue activado en admin-catalog. Debe estar desactivado.";
    }

    if (/failed to fetch|networkerror|load failed/i.test(detail)) {
      return "El navegador no pudo conectar con admin-catalog. Revisa el despliegue, la URL de Supabase y CORS.";
    }

    return detail || "Supabase rechazó la solicitud.";
  }

  async function callAdminCatalog(action, extraBody = {}, pinOverride = "") {
    const pin = String(pinOverride || state.pin || "").trim();

    if (!pin) {
      throw new Error("La sesión terminó. Vuelve a introducir el PIN.");
    }

    const { url, anonKey } = supabaseConfig();

    const response = await fetch(`${url}/functions/v1/admin-catalog`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: buildEdgeFunctionHeaders(anonKey),
      body: JSON.stringify({
        ...extraBody,
        action,
        accessScope: "menu-admin",
        adminPin: pin
      })
    });

    const raw = await response.text();
    let result = {};

    try {
      result = raw ? JSON.parse(raw) : {};
    } catch (_) {
      result = { detail: raw };
    }

    if (!response.ok || !result?.ok) {
      const message = [
        result?.detail,
        result?.error,
        `HTTP ${response.status}`
      ].filter(Boolean).join(" · ");

      const requestError = new Error(message || "Supabase rechazó la solicitud.");
      requestError.status = response.status;
      requestError.payload = result;
      throw requestError;
    }

    return result;
  }

  function updateSyncStatus() {
    const status = $("#syncStatus");
    if (!status) return;

    const label = status.querySelector("span:last-child");

    status.dataset.state = state.imageUploading || state.busy
      ? "busy"
      : state.dirty
        ? "dirty"
        : "saved";

    if (label) {
      label.textContent = state.imageUploading
        ? "Subiendo imagen…"
        : state.busy
          ? "Guardando…"
          : state.dirty
            ? "Cambios sin guardar"
            : "Todo guardado";
    }
  }

  function refreshDisabledControls() {
    const disabled = state.busy || state.imageUploading;

    [
      "#refreshButton",
      "#addProductButton",
      "#saveProductButton",
      "#deleteProductButton",
      "#loginButton",
      "#chooseImageButton",
      "#imagePickerButton",
      "#removeImageButton"
    ].forEach((selector) => {
      const element = $(selector);
      if (element) element.disabled = disabled;
    });
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);
    updateSyncStatus();
    refreshDisabledControls();
  }

  function setImageUploading(uploading) {
    state.imageUploading = Boolean(uploading);
    updateSyncStatus();
    refreshDisabledControls();

    const previewButton = $("#imagePickerButton");
    if (previewButton) {
      previewButton.classList.toggle("is-uploading", state.imageUploading);
    }
  }

  function setDirty(dirty) {
    state.dirty = Boolean(dirty);
    updateSyncStatus();
  }

  function toast(message, type = "success") {
    const region = $("#toastRegion");

    if (!region) {
      console.log(message);
      return;
    }

    const item = document.createElement("div");
    item.className = "toast";
    item.dataset.type = type;
    item.textContent = message;
    region.appendChild(item);

    setTimeout(() => item.remove(), 4200);
  }

  function categoryName(categoryId) {
    return state.catalog.categories.find(
      (category) => category.id === categoryId
    )?.name_es || categoryId || "Sin categoría";
  }

  function productStats(productId) {
    const groups = state.catalog.optionGroups.filter(
      (group) => group.product_id === productId
    );

    const groupIds = new Set(groups.map((group) => group.id));

    return {
      groups: groups.length,
      options: state.catalog.options.filter(
        (option) => groupIds.has(option.option_group_id)
      ).length,
      extras: state.catalog.productExtras.filter(
        (link) => link.product_id === productId
      ).length,
      removables: state.catalog.productRemovables.filter(
        (link) => link.product_id === productId
      ).length
    };
  }

  function renderSummary() {
    const products = state.catalog.products;
    const totalProducts = $("#totalProducts");
    const visibleProducts = $("#visibleProducts");
    const hiddenProducts = $("#hiddenProducts");

    if (totalProducts) totalProducts.textContent = String(products.length);
    if (visibleProducts) {
      visibleProducts.textContent = String(
        products.filter((product) => product.visible).length
      );
    }
    if (hiddenProducts) {
      hiddenProducts.textContent = String(
        products.filter((product) => !product.visible).length
      );
    }
  }

  function renderCategoryFilter() {
    const select = $("#categoryFilter");
    if (!select) return;

    const current = state.category;

    select.innerHTML = [
      `<option value="all">Todas las categorías</option>`,
      ...state.catalog.categories.map((category) => `
        <option value="${escapeHtml(category.id)}">
          ${escapeHtml(category.name_es)}
        </option>
      `)
    ].join("");

    select.value = state.catalog.categories.some(
      (category) => category.id === current
    ) ? current : "all";
  }

  function filteredProducts() {
    const query = state.query.trim().toLowerCase();

    return state.catalog.products.filter((product) => {
      const matchesCategory =
        state.category === "all" ||
        product.category_id === state.category;

      const matchesStatus =
        state.status === "all" ||
        (state.status === "visible" && product.visible) ||
        (state.status === "hidden" && !product.visible) ||
        (state.status === "inactive" && !product.active);

      const text = [
        product.name_es,
        product.name_en,
        product.description_es,
        product.description_en,
        categoryName(product.category_id)
      ].filter(Boolean).join(" ").toLowerCase();

      return matchesCategory && matchesStatus && (!query || text.includes(query));
    });
  }

  function renderProducts() {
    renderSummary();
    renderCategoryFilter();

    const body = $("#productTableBody");
    const empty = $("#productEmptyState");
    if (!body || !empty) return;

    const products = filteredProducts();

    if (!products.length) {
      body.innerHTML = "";
      empty.hidden = false;
      return;
    }

    empty.hidden = true;

    body.innerHTML = products.map((product) => `
      <tr>
        <td>
          <div class="product-cell">
            <span class="product-thumb">
              ${product.image_url
                ? `<img src="${escapeHtml(product.image_url)}" alt="" loading="lazy">`
                : "Sin imagen"}
            </span>
            <span class="product-copy">
              <strong>${escapeHtml(product.name_es)}</strong>
              <small>${escapeHtml(product.name_en || product.description_es || "")}</small>
            </span>
          </div>
        </td>
        <td>${escapeHtml(categoryName(product.category_id))}</td>
        <td><span class="price-value">${money(product.base_price)}</span></td>
        <td>
          <div class="status-control">
            <label class="status-switch">
              <input
                type="checkbox"
                data-product-visible="${escapeHtml(product.id)}"
                ${product.visible ? "checked" : ""}
                aria-label="Mostrar u ocultar ${escapeHtml(product.name_es)}"
              >
              <span class="status-switch-control" aria-hidden="true"></span>
            </label>
            <span class="status-label">${product.visible ? "Visible" : "Oculto"}</span>
          </div>
        </td>
        <td class="align-right">
          <div class="row-actions">
            <button
              class="row-button"
              type="button"
              data-edit-product="${escapeHtml(product.id)}"
            >Editar</button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  function renderCategories() {
    const list = $("#categoryList");
    if (!list) return;

    if (!state.catalog.categories.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">×</div>
          <h2>No hay categorías</h2>
          <p>Ejecuta primero la carga inicial del catálogo.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = state.catalog.categories.map((category) => {
      const productCount = state.catalog.products.filter(
        (product) => product.category_id === category.id
      ).length;

      return `
        <article class="category-row">
          <div>
            <small>Nombre en español</small>
            <strong>${escapeHtml(category.name_es)}</strong>
          </div>
          <div class="category-english">
            <small>Nombre en inglés</small>
            <span>${escapeHtml(category.name_en || category.name_es)}</span>
          </div>
          <div class="category-order">
            <small>Orden</small>
            <span>${Number(category.sort_order || 0)}</span>
          </div>
          <div>
            <small>Productos</small>
            <span>${productCount}</span>
          </div>
          <button
            class="row-button"
            type="button"
            data-edit-category="${escapeHtml(category.id)}"
          >Editar</button>
        </article>
      `;
    }).join("");
  }


  function availabilityItemLabel(item) {
    return String(item?.name_es || item?.name_en || item?.id || "");
  }

  function renderAvailabilityItems() {
    const list = $("#availabilityItemsList");
    if (!list) return;

    const query = state.availabilityQuery.trim().toLowerCase();
    const items = (state.catalog.inventory || [])
      .slice()
      .sort((left, right) => {
        const group = String(left.group_name || "").localeCompare(String(right.group_name || ""));
        return group || Number(left.sort_order || 0) - Number(right.sort_order || 0);
      })
      .filter((item) => {
        const text = [
          item.id,
          item.name_es,
          item.name_en,
          item.group_name
        ].filter(Boolean).join(" ").toLowerCase();
        return !query || text.includes(query);
      });

    if (!items.length) {
      list.innerHTML = `<div class="empty-state"><h2>No hay elementos</h2><p>Crea el primer artículo del inventario.</p></div>`;
      return;
    }

    list.innerHTML = items.map((item) => `
      <article class="management-row">
        <div class="management-row-main">
          <small>${escapeHtml(item.group_name || "Sin grupo")}</small>
          <strong>${escapeHtml(availabilityItemLabel(item))}</strong>
          <span>${escapeHtml(item.name_en || item.name_es || "")}</span>
        </div>
        <span class="management-order">Orden ${Number(item.sort_order || 0)}</span>
        <span class="status-badge ${item.active === false ? "status-hidden" : "status-visible"}">
          ${item.active === false ? "Inactivo" : "Activo"}
        </span>
        <div class="management-row-actions">
          <button class="row-button" type="button" data-edit-availability-item="${escapeHtml(item.id)}">Editar</button>
          <button class="row-button danger-row-button" type="button" data-delete-availability-item="${escapeHtml(item.id)}">Eliminar</button>
        </div>
      </article>
    `).join("");
  }

  function inventoryGroupNames() {
    return Array.from(new Set((state.catalog.inventory || []).map((item) => String(item.group_name || "").trim()).filter(Boolean))).sort((a,b) => a.localeCompare(b,"es"));
  }

  function populateInventoryGroupSelect(selectedGroup = "") {
    const select = $("#availabilityItemGroupSelect");
    if (!select) return;
    const groups = inventoryGroupNames();
    const current = String(selectedGroup || "").trim();
    if (current && !groups.includes(current)) groups.unshift(current);
    if (!groups.length) groups.push("General");
    select.innerHTML = groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("") + `<option value="__new__">+ Crear nuevo grupo</option>`;
    select.value = current && groups.includes(current) ? current : groups[0];
    toggleNewInventoryGroupField();
  }

  function toggleNewInventoryGroupField() {
    const creating = $("#availabilityItemGroupSelect")?.value === "__new__";
    const field = $("#availabilityNewGroupField");
    const input = $("#availabilityItemNewGroup");
    if (field) field.hidden = !creating;
    if (!creating && input) input.value = "";
    if (creating) input?.focus();
  }

  function selectedInventoryGroupName() {
    const selected = String($("#availabilityItemGroupSelect")?.value || "").trim();
    if (selected === "__new__") return String($("#availabilityItemNewGroup")?.value || "").trim() || "General";
    return selected || "General";
  }

  function openAvailabilityItemForm(item = null) {
    const form = $("#availabilityItemForm");
    if (!form) return;

    $("#availabilityItemOriginalId").value = item?.id || "";
    $("#availabilityItemNameEs").value = item?.name_es || "";
    populateInventoryGroupSelect(item?.group_name || "General");
    $("#availabilityItemSort").value = Number(item?.sort_order || 0);
    $("#availabilityItemActive").checked = item?.active !== false;
    form.hidden = false;
    $("#availabilityItemNameEs")?.focus();
  }

  function closeAvailabilityItemForm() {
    const form = $("#availabilityItemForm");
    if (form) form.hidden = true;
    form?.reset();
    if ($("#availabilityItemActive")) $("#availabilityItemActive").checked = true;
  }

  async function saveAvailabilityItem(event) {
    event.preventDefault();

    const nameEs = String($("#availabilityItemNameEs")?.value || "").trim();
    if (!nameEs) {
      toast("Escribe el nombre del elemento.", "error");
      return;
    }

    setBusy(true);
    try {
      await callAdminCatalog("save_inventory_item", {
        item: {
          id: String($("#availabilityItemOriginalId")?.value || "").trim(),
          name_es: nameEs,
          name_en: nameEs,
          group_name: selectedInventoryGroupName(),
          sort_order: Number($("#availabilityItemSort")?.value || 0),
          active: Boolean($("#availabilityItemActive")?.checked)
        }
      });
      closeAvailabilityItemForm();
      await loadCatalog({ preserveSelection: true });
      toast("Artículo del inventario guardado.");
    } catch (error) {
      toast(`No se pudo guardar. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAvailabilityItem(itemId) {
    const item = (state.catalog.inventory || []).find((candidate) => String(candidate.id) === String(itemId));
    if (!item) return;

    const first = confirm(`¿Eliminar “${availabilityItemLabel(item)}” del Inventario?`);
    if (!first) return;

    setBusy(true);
    try {
      await callAdminCatalog("delete_inventory_item", { itemId });
      await loadCatalog({ preserveSelection: true });
      toast("Artículo eliminado.");
    } catch (error) {
      toast(`No se pudo eliminar. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const BUSINESS_DEFAULTS = {
    menu_title: "Haz tu pedido",
    menu_subtitle: "Elige tus favoritos, personaliza y recoge en la ventanilla.",
    footer_title: "Comida dominicana y latina en San Jose, California",
    footer_paragraph_1: "El Fogon D' Geny prepara autentica comida dominicana, latina y caribeña en el centro de San Jose.",
    footer_paragraph_2: "Si buscas comida dominicana sabrosa, comida latina o un restaurante dominicano en San Jose, visita El Fogon D' Geny.",
    address: "796 S 1st St, San Jose, CA 95113",
    maps_label: "Ver ubicación en Google Maps",
    maps_url: "https://www.google.com/maps/search/?api=1&query=El+Fogon+D%27+Geny+796+S+1st+St+San+Jose+CA+95113",
    tax_enabled: false,
    tax_rate: 10,
    tax_only_taxable: true,
    checkout_mode: "pay_before_kitchen",
    kiosk_id: "kiosk-01",
    kiosk_bridge_url: "http://127.0.0.1:17840",
    allow_cash_backup: false
  };

  function currentBusinessSettings() {
    return { ...BUSINESS_DEFAULTS, ...(state.businessSettings || {}) };
  }

  function fillBusinessSettingsForm(force = false) {
    const form = $("#businessSettingsForm");
    if (!form) return;
    if (!force && form.dataset.loaded === "true") return;

    const settings = currentBusinessSettings();
    $("#businessMenuTitle").value = settings.menu_title || "";
    $("#businessMenuSubtitle").value = settings.menu_subtitle || "";
    $("#businessFooterTitle").value = settings.footer_title || "";
    $("#businessFooterParagraph1").value = settings.footer_paragraph_1 || "";
    $("#businessFooterParagraph2").value = settings.footer_paragraph_2 || "";
    $("#businessAddress").value = settings.address || "";
    $("#businessMapsLabel").value = settings.maps_label || "";
    $("#businessMapsUrl").value = settings.maps_url || "";
    $("#businessTaxEnabled").checked = settings.tax_enabled === true;
    $("#businessTaxRate").value = Number(settings.tax_rate || 10).toFixed(3);
    $("#businessTaxOnlyTaxable").checked = settings.tax_only_taxable !== false;
    $("#businessCheckoutMode").value = settings.checkout_mode || "pay_before_kitchen";
    $("#businessKioskId").value = settings.kiosk_id || "kiosk-01";
    $("#businessKioskBridgeUrl").value = settings.kiosk_bridge_url || "http://127.0.0.1:17840";
    $("#businessAllowCashBackup").checked = settings.allow_cash_backup === true;
    updateTaxSettingsUi();
    updateKioskSettingsUi();
    form.dataset.loaded = "true";
  }

  function updateTaxSettingsUi() {
    const enabled = Boolean($("#businessTaxEnabled")?.checked);
    const fields = $("#taxRateFields");
    const status = $("#taxEnabledStatus");

    if (fields) fields.hidden = !enabled;
    if (status) status.textContent = enabled ? "Activado" : "Desactivado";
  }


  function updateKioskSettingsUi() {
    const mode = String($("#businessCheckoutMode")?.value || "pay_before_kitchen");
    const fields = $("#kioskConnectionFields");
    if (fields) fields.hidden = mode !== "pay_before_kitchen";
  }

  async function testKioskBridgeConnection() {
    const button = $("#testKioskBridgeButton");
    const status = $("#kioskBridgeStatus");
    const baseUrl = String($("#businessKioskBridgeUrl")?.value || "").trim().replace(/\/$/, "");

    if (!baseUrl) {
      if (status) status.textContent = "Falta la dirección";
      return;
    }

    if (button) button.disabled = true;
    if (status) status.textContent = "Comprobando…";

    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: "GET",
        cache: "no-store"
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }

      if (status) {
        status.textContent = result.mode === "simulator"
          ? "Conectado · simulador"
          : "Conectado · Clover";
      }
    } catch (error) {
      if (status) status.textContent = "No conectado";
      toast(`No se pudo conectar con Fogón Kiosk Bridge. ${error?.message || error}`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveBusinessSettings(event) {
    event.preventDefault();
    const settings = {
      menu_title: String($("#businessMenuTitle")?.value || "").trim(),
      menu_subtitle: String($("#businessMenuSubtitle")?.value || "").trim(),
      footer_title: String($("#businessFooterTitle")?.value || "").trim(),
      footer_paragraph_1: String($("#businessFooterParagraph1")?.value || "").trim(),
      footer_paragraph_2: String($("#businessFooterParagraph2")?.value || "").trim(),
      address: String($("#businessAddress")?.value || "").trim(),
      maps_label: String($("#businessMapsLabel")?.value || "").trim(),
      maps_url: String($("#businessMapsUrl")?.value || "").trim(),
      tax_enabled: Boolean($("#businessTaxEnabled")?.checked),
      tax_rate: Math.max(0, Math.min(20, Number($("#businessTaxRate")?.value || 10))),
      tax_only_taxable: Boolean($("#businessTaxOnlyTaxable")?.checked),
      checkout_mode: String($("#businessCheckoutMode")?.value || "pay_before_kitchen"),
      kiosk_id: String($("#businessKioskId")?.value || "kiosk-01").trim() || "kiosk-01",
      kiosk_bridge_url: String($("#businessKioskBridgeUrl")?.value || "http://127.0.0.1:17840").trim().replace(/\/$/, ""),
      allow_cash_backup: Boolean($("#businessAllowCashBackup")?.checked)
    };

    setBusy(true);
    try {
      const result = await callAdminCatalog("update_menu_settings", { settings });
      state.businessSettings = { ...(result.settings || settings) };
      toast("Información del menú actualizada.");
    } catch (error) {
      toast(`No se pudo guardar. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function renderAll() {
    renderProducts();
    renderCategories();
    renderAvailabilityItems();
    fillBusinessSettingsForm();
  }

  async function loadCatalog({ preserveSelection = true } = {}) {
    const selectedProductId = preserveSelection ? state.selectedProductId : null;
    setBusy(true);

    try {
      const result = await callAdminCatalog("list_catalog");

      state.catalog = {
        categories: result.catalog?.categories || [],
        products: result.catalog?.products || [],
        optionGroups: result.catalog?.optionGroups || [],
        options: result.catalog?.options || [],
        extras: result.catalog?.extras || [],
        productExtras: result.catalog?.productExtras || [],
        removables: result.catalog?.removables || [],
        productRemovables: result.catalog?.productRemovables || [],
        inventory: result.catalog?.inventory || [],
        settings: result.catalog?.settings || {}
      };

      state.businessSettings = { ...(result.catalog?.settings || {}) };

      renderAll();

      if (selectedProductId) {
        const selected = state.catalog.products.find(
          (product) => product.id === selectedProductId
        );
        const drawer = $("#productDrawer");

        if (
          selected &&
          drawer &&
          drawer.getAttribute("aria-hidden") === "false"
        ) {
          fillProductForm(selected, false);
        }
      }
    } finally {
      setBusy(false);
    }
  }



  const WEEKLY_SCHEDULE_DEFAULTS = {
  "0": { open: true, start: "11:00", end: "20:30" },
  "1": { open: true, start: "11:00", end: "20:30" },
  "2": { open: false, start: "11:00", end: "20:30" },
  "3": { open: true, start: "11:00", end: "20:30" },
  "4": { open: true, start: "11:00", end: "20:30" },
  "5": { open: true, start: "11:00", end: "20:30" },
  "6": { open: true, start: "11:00", end: "20:30" }
};

  const WEEKDAY_NAMES = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado"
  ];

  function normalizedScheduleSettings() {
    const source = state.businessSettings?.weekly_schedule;
    const schedule = source && typeof source === "object" ? source : {};

    return Object.fromEntries(
      Object.entries(WEEKLY_SCHEDULE_DEFAULTS).map(([day, fallback]) => {
        const candidate = schedule[day] && typeof schedule[day] === "object"
          ? schedule[day]
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

  function ensureScheduleView() {
    if ($("#scheduleView")) return;

    const nav = $(".sidebar-nav");
    const workspace = $(".workspace");
    if (!nav || !workspace) return;

    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.dataset.view = "schedule";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16M7 3v6M17 3v6M5 11h14v9H5z"/>
      </svg>
      <span>Horario semanal</span>
    `;
    nav.appendChild(button);

    const section = document.createElement("section");
    section.id = "scheduleView";
    section.className = "view";
    section.hidden = true;
    section.innerHTML = `
      <section class="content-card schedule-settings-card">
        <div class="schedule-settings-copy">
          <p class="eyebrow">Hora de California</p>
          <h2>Días y horario de pedidos</h2>
          <p>
            Decide qué días se aceptan pedidos web y configura la hora
            de apertura y cierre de cada día. Los días desactivados
            permanecen cerrados durante 24 horas.
          </p>
        </div>

        <form id="weeklyScheduleForm" class="weekly-schedule-form">
          <div id="weeklyScheduleRows" class="weekly-schedule-rows"></div>

          <div class="weekly-schedule-actions">
            <button
              id="restoreDefaultScheduleButton"
              class="button button-secondary"
              type="button"
            >
              Restaurar horario recomendado
            </button>

            <button class="button button-primary" type="submit">
              Guardar horario semanal
            </button>
          </div>

          <p id="weeklyScheduleStatus" class="schedule-settings-status"></p>
        </form>
      </section>
    `;

    workspace.appendChild(section);
  }

  function renderWeeklySchedule() {
    const container = $("#weeklyScheduleRows");
    if (!container) return;

    const schedule = normalizedScheduleSettings();

    container.innerHTML = WEEKDAY_NAMES.map((name, day) => {
      const config = schedule[String(day)];
      const isOpen = config.open !== false;

      return `
        <article class="weekly-schedule-row" data-schedule-day="${day}">
          <label class="weekly-day-toggle">
            <input
              type="checkbox"
              data-schedule-open="${day}"
              ${isOpen ? "checked" : ""}
            >
            <span class="switch-control" aria-hidden="true"></span>
            <strong>${name}</strong>
            <small>${isOpen ? "Abierto" : "Cerrado todo el día"}</small>
          </label>

          <label class="field weekly-time-field">
            <span>Abre</span>
            <input
              type="time"
              data-schedule-start="${day}"
              value="${config.start}"
              ${isOpen ? "" : "disabled"}
              required
            >
          </label>

          <label class="field weekly-time-field">
            <span>Cierra</span>
            <input
              type="time"
              data-schedule-end="${day}"
              value="${config.end}"
              ${isOpen ? "" : "disabled"}
              required
            >
          </label>
        </article>
      `;
    }).join("");
  }

  function readWeeklyScheduleForm() {
    return Object.fromEntries(
      WEEKDAY_NAMES.map((_, day) => {
        const open = Boolean(
          document.querySelector(`[data-schedule-open="${day}"]`)?.checked
        );

        return [
          String(day),
          {
            open,
            start: String(
              document.querySelector(`[data-schedule-start="${day}"]`)?.value
              || "11:00"
            ),
            end: String(
              document.querySelector(`[data-schedule-end="${day}"]`)?.value
              || "20:30"
            )
          }
        ];
      })
    );
  }

  function updateScheduleRow(day) {
    const openInput = document.querySelector(`[data-schedule-open="${day}"]`);
    const startInput = document.querySelector(`[data-schedule-start="${day}"]`);
    const endInput = document.querySelector(`[data-schedule-end="${day}"]`);
    const row = document.querySelector(`[data-schedule-day="${day}"]`);
    const status = row?.querySelector(".weekly-day-toggle small");
    const open = Boolean(openInput?.checked);

    if (startInput) startInput.disabled = !open;
    if (endInput) endInput.disabled = !open;
    if (status) status.textContent = open ? "Abierto" : "Cerrado todo el día";
    row?.classList.toggle("is-closed", !open);
  }

  async function saveWeeklySchedule(event) {
    event?.preventDefault();

    const status = $("#weeklyScheduleStatus");
    const form = $("#weeklyScheduleForm");
    const submit = form?.querySelector('button[type="submit"]');

    if (submit) submit.disabled = true;
    if (status) status.textContent = "Guardando…";

    try {
      const weeklySchedule = readWeeklyScheduleForm();

      const result = await callAdminCatalog("update_menu_settings", {
        settings: {
          weekly_schedule: weeklySchedule
        }
      });

      state.businessSettings = {
        ...(state.businessSettings || {}),
        ...(result.settings || {}),
        weekly_schedule: weeklySchedule
      };

      if (status) {
        status.textContent =
          "Horario guardado. Los cambios se aplican en hora de California.";
      }

      toast("Horario semanal guardado.", "success");
    } catch (error) {
      console.error(error);
      if (status) status.textContent = "No se pudo guardar el horario.";
      toast(
        `No se pudo guardar. ${menuAdminErrorMessage(error)}`,
        "error"
      );
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function switchView(view) {
    state.view = view;

    $$('[data-view]').forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });

    const viewIds = {
      products: "productsView",
      categories: "categoriesView",
      schedule: "scheduleView",
      "availability-items": "availabilityItemsView",
      business: "businessView"
    };

    Object.entries(viewIds).forEach(([key, id]) => {
      const section = document.getElementById(id);
      if (section) section.hidden = key !== view;
    });

    const titles = {
      products: "Productos",
      categories: "Categorías",
      schedule: "Horario semanal",
      "availability-items": "Inventario",
      business: "Datos del menú"
    };

    const pageTitle = $("#pageTitle");
    const addProductButton = $("#addProductButton");
    if (pageTitle) pageTitle.textContent = titles[view] || "Administración";
    if (addProductButton) addProductButton.hidden = view !== "products";
    if (view === "schedule") renderWeeklySchedule();
    if (view === "availability-items") renderAvailabilityItems();
    if (view === "business") fillBusinessSettingsForm(true);

    closeMobileSidebar();
  }

  function openMobileSidebar() {
    document.body.classList.add("sidebar-open");
    const backdrop = $("#mobileSidebarBackdrop");
    if (backdrop) backdrop.hidden = false;
  }

  function closeMobileSidebar() {
    document.body.classList.remove("sidebar-open");
    const backdrop = $("#mobileSidebarBackdrop");
    if (backdrop) backdrop.hidden = true;
  }

  function renderProductCategoryOptions(selected = "") {
    const select = $("#productCategory");
    if (!select) return;

    select.innerHTML = state.catalog.categories.map((category) => `
      <option value="${escapeHtml(category.id)}">
        ${escapeHtml(category.name_es)}${category.active ? "" : " — inactiva"}
      </option>
    `).join("");

    if (selected) select.value = selected;
  }

  function renderOptionSummary(productId = "") {
    const stats = productId
      ? productStats(productId)
      : { groups: 0, options: 0, extras: 0, removables: 0 };

    const summary = $("#optionSummary");
    if (!summary) return;

    summary.innerHTML = `
      <article><strong>${stats.groups}</strong><span>Grupos</span></article>
      <article><strong>${stats.options}</strong><span>Opciones</span></article>
      <article><strong>${stats.extras}</strong><span>Extras</span></article>
      <article><strong>${stats.removables}</strong><span>Removibles</span></article>
    `;
  }


  function createLocalOptionId(prefix = "option") {
    if (window.crypto?.randomUUID) return `${prefix}:${window.crypto.randomUUID()}`;
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }

  function productOptionDraft(productId = "") {
    const groups = state.catalog.optionGroups
      .filter((group) => group.product_id === productId && group.active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    return groups.map((group, groupIndex) => ({
      id: String(group.id || ""),
      clientId: createLocalOptionId("group"),
      nameEs: String(group.name_es || ""),
      nameEn: String(group.name_en || group.name_es || ""),
      required: group.required === true,
      selectionType: String(group.selection_type || "single") === "multiple" ? "multiple" : "single",
      sortOrder: Number(group.sort_order ?? groupIndex * 10),
      options: state.catalog.options
        .filter((option) => option.option_group_id === group.id && option.active !== false)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((option, optionIndex) => ({
          id: String(option.id || ""),
          clientId: createLocalOptionId("choice"),
          nameEs: String(option.name_es || ""),
          nameEn: String(option.name_en || option.name_es || ""),
          priceDelta: Number(option.price_delta || 0),
          sortOrder: Number(option.sort_order ?? optionIndex * 10)
        }))
    }));
  }

  function optionDraftSummary() {
    return {
      groups: state.optionDraftGroups.length,
      options: state.optionDraftGroups.reduce(
        (total, group) => total + group.options.length,
        0
      )
    };
  }

  function renderOptionDraftSummary() {
    const summary = $("#optionSummary");
    if (!summary) return;
    const stats = optionDraftSummary();
    summary.innerHTML = `
      <article><strong>${stats.groups}</strong><span>Grupos</span></article>
      <article><strong>${stats.options}</strong><span>Subopciones</span></article>
      <article><strong>${state.optionDraftGroups.filter((group) => group.required).length}</strong><span>Obligatorios</span></article>
      <article><strong>${state.optionDraftGroups.filter((group) => !group.required).length}</strong><span>Opcionales</span></article>
    `;
  }

  function renderOptionGroupsEditor() {
    const editor = $("#optionGroupsEditor");
    const empty = $("#optionGroupsEmpty");
    if (!editor || !empty) return;

    renderOptionDraftSummary();
    empty.hidden = state.optionDraftGroups.length > 0;

    editor.innerHTML = state.optionDraftGroups.map((group, groupIndex) => `
      <article class="option-group-card" data-option-group="${escapeHtml(group.clientId)}">
        <header class="option-group-header">
          <div class="option-group-title">
            <span class="option-group-index">${groupIndex + 1}</span>
            <strong>${escapeHtml(group.nameEs || "Grupo sin nombre")}</strong>
          </div>
          <div class="option-group-actions">
            <button class="option-mini-button danger" type="button"
              data-remove-option-group="${escapeHtml(group.clientId)}">Eliminar grupo</button>
          </div>
        </header>

        <div class="option-group-body">
          <div class="option-group-fields">
            <label class="field">
              <span>Nombre del grupo en español *</span>
              <input type="text" maxlength="160"
                value="${escapeHtml(group.nameEs)}"
                placeholder="Ej.: Elige tu proteína"
                data-option-group-field="nameEs"
                data-option-group-id="${escapeHtml(group.clientId)}">
            </label>
            <label class="field">
              <span>Nombre del grupo en inglés</span>
              <input type="text" maxlength="160"
                value="${escapeHtml(group.nameEn)}"
                placeholder="Ej.: Choose your protein"
                data-option-group-field="nameEn"
                data-option-group-id="${escapeHtml(group.clientId)}">
            </label>
          </div>

          <div class="option-group-settings">
            <label class="option-required-card">
              <span>
                <strong>Elección obligatoria</strong>
                <small>El cliente debe elegir antes de agregar.</small>
              </span>
              <span class="switch-row">
                <input type="checkbox" ${group.required ? "checked" : ""}
                  data-option-group-required="${escapeHtml(group.clientId)}">
                <span class="switch-control" aria-hidden="true"></span>
              </span>
            </label>

            <label class="field">
              <span>Tipo de selección</span>
              <select data-option-group-selection="${escapeHtml(group.clientId)}">
                <option value="single" ${group.selectionType === "single" ? "selected" : ""}>Una sola opción</option>
                <option value="multiple" ${group.selectionType === "multiple" ? "selected" : ""}>Varias opciones</option>
              </select>
            </label>
          </div>

          <div class="option-list-heading">
            <strong>Opciones de este grupo</strong>
            <button class="option-mini-button" type="button"
              data-add-option="${escapeHtml(group.clientId)}">+ Añadir opción</button>
          </div>

          <div class="option-rows">
            ${group.options.length ? group.options.map((option) => `
              <div class="option-row" data-option-row="${escapeHtml(option.clientId)}">
                <label class="field">
                  <span>Nombre en español *</span>
                  <input type="text" maxlength="160"
                    value="${escapeHtml(option.nameEs)}"
                    placeholder="Ej.: Bistec"
                    data-option-field="nameEs"
                    data-group-id="${escapeHtml(group.clientId)}"
                    data-option-id="${escapeHtml(option.clientId)}">
                </label>
                <label class="field">
                  <span>Nombre en inglés</span>
                  <input type="text" maxlength="160"
                    value="${escapeHtml(option.nameEn)}"
                    placeholder="Ej.: Steak"
                    data-option-field="nameEn"
                    data-group-id="${escapeHtml(group.clientId)}"
                    data-option-id="${escapeHtml(option.clientId)}">
                </label>
                <label class="field option-row-price">
                  <span>Precio extra</span>
                  <div class="money-field">
                    <span>$</span>
                    <input type="number" min="0" step="0.01" inputmode="decimal"
                      value="${Number(option.priceDelta || 0).toFixed(2)}"
                      data-option-field="priceDelta"
                      data-group-id="${escapeHtml(group.clientId)}"
                      data-option-id="${escapeHtml(option.clientId)}">
                  </div>
                </label>
                <div class="option-row-actions">
                  <button class="option-mini-button danger" type="button"
                    data-remove-option="${escapeHtml(option.clientId)}"
                    data-group-id="${escapeHtml(group.clientId)}">Eliminar</button>
                </div>
              </div>
            `).join("") : `<div class="option-row-empty">Añade al menos una opción a este grupo.</div>`}
          </div>
        </div>
      </article>
    `).join("");
  }

  function addOptionGroup() {
    state.optionDraftGroups.push({
      id: "",
      clientId: createLocalOptionId("group"),
      nameEs: "",
      nameEn: "",
      required: true,
      selectionType: "single",
      sortOrder: state.optionDraftGroups.length * 10,
      options: [{
        id: "",
        clientId: createLocalOptionId("choice"),
        nameEs: "",
        nameEn: "",
        priceDelta: 0,
        sortOrder: 0
      }]
    });
    renderOptionGroupsEditor();
    setDirty(true);
  }

  function removeOptionGroup(clientId) {
    const group = state.optionDraftGroups.find((item) => item.clientId === clientId);
    if (!group) return;
    const label = group.nameEs || "este grupo";
    if (!confirm(`¿Eliminar “${label}” y todas sus opciones?`)) return;
    state.optionDraftGroups = state.optionDraftGroups.filter((item) => item.clientId !== clientId);
    renderOptionGroupsEditor();
    setDirty(true);
  }

  function addOptionToGroup(clientId) {
    const group = state.optionDraftGroups.find((item) => item.clientId === clientId);
    if (!group) return;
    group.options.push({
      id: "",
      clientId: createLocalOptionId("choice"),
      nameEs: "",
      nameEn: "",
      priceDelta: 0,
      sortOrder: group.options.length * 10
    });
    renderOptionGroupsEditor();
    setDirty(true);
  }

  function removeOptionFromGroup(groupClientId, optionClientId) {
    const group = state.optionDraftGroups.find((item) => item.clientId === groupClientId);
    if (!group) return;
    group.options = group.options.filter((item) => item.clientId !== optionClientId);
    renderOptionGroupsEditor();
    setDirty(true);
  }

  function updateOptionDraftFromInput(target) {
    const groupClientId = target.dataset.optionGroupId || target.dataset.groupId || "";
    const group = state.optionDraftGroups.find((item) => item.clientId === groupClientId);
    if (!group) return;

    if (target.dataset.optionGroupField) {
      group[target.dataset.optionGroupField] = target.value;
      const card = target.closest(".option-group-card");
      const title = card?.querySelector(".option-group-title strong");
      if (title && target.dataset.optionGroupField === "nameEs") {
        title.textContent = target.value.trim() || "Grupo sin nombre";
      }
    }

    if (target.dataset.optionGroupRequired) {
      group.required = target.checked;
      renderOptionDraftSummary();
    }

    if (target.dataset.optionGroupSelection) {
      group.selectionType = target.value === "multiple" ? "multiple" : "single";
    }

    if (target.dataset.optionField) {
      const option = group.options.find((item) => item.clientId === target.dataset.optionId);
      if (!option) return;
      const field = target.dataset.optionField;
      option[field] = field === "priceDelta"
        ? Math.max(0, Number(target.value || 0))
        : target.value;
    }

    setDirty(true);
  }

  function optionGroupsPayload() {
    return state.optionDraftGroups.map((group, groupIndex) => {
      const nameEs = String(group.nameEs || "").trim();
      if (!nameEs) throw new Error(`Escribe el nombre del grupo ${groupIndex + 1}.`);
      if (!group.options.length) {
        throw new Error(`Añade al menos una opción al grupo “${nameEs}”.`);
      }

      return {
        id: group.id || null,
        nameEs,
        nameEn: String(group.nameEn || "").trim() || nameEs,
        required: Boolean(group.required),
        selectionType: group.selectionType === "multiple" ? "multiple" : "single",
        sortOrder: groupIndex * 10,
        options: group.options.map((option, optionIndex) => {
          const optionNameEs = String(option.nameEs || "").trim();
          if (!optionNameEs) {
            throw new Error(`Completa el nombre de la opción ${optionIndex + 1} en “${nameEs}”.`);
          }
          const priceDelta = Number(option.priceDelta || 0);
          if (!Number.isFinite(priceDelta) || priceDelta < 0) {
            throw new Error(`El precio adicional de “${optionNameEs}” no es válido.`);
          }
          return {
            id: option.id || null,
            nameEs: optionNameEs,
            nameEn: String(option.nameEn || "").trim() || optionNameEs,
            priceDelta,
            sortOrder: optionIndex * 10
          };
        })
      };
    });
  }

  const IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const IMAGE_MAX_UPLOAD_BYTES = 2600 * 1024;
  const IMAGE_OUTPUT_WIDTH = 1280;
  const IMAGE_OUTPUT_HEIGHT = 1114;
  const IMAGE_MOBILE_SAFE_RATIO = 0.92;
  const IMAGE_DEFAULT_HELP =
    "Selecciona una foto y se abrirá el editor. El archivo final se adapta automáticamente al formato del menú.";

  const imageEditor = {
    source: null,
    sourceUrl: "",
    sourceName: "producto.jpg",
    sourceWidth: 0,
    sourceHeight: 0,
    mode: "balanced",
    background: "blur",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0
  };

  function setImageUploadStatus(message = IMAGE_DEFAULT_HELP, stateName = "") {
    const status = $("#imageUploadStatus");
    if (!status) return;

    status.textContent = message;

    if (stateName) status.dataset.state = stateName;
    else delete status.dataset.state;
  }

  function openImagePicker() {
    if (state.imageUploading || state.busy) return;
    $("#imageFile")?.click();
  }

  function validateSelectedImage(file) {
    if (!file) throw new Error("No se seleccionó ninguna imagen.");

    const looksLikeImage =
      String(file.type || "").startsWith("image/") ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(String(file.name || ""));

    if (!looksLikeImage) {
      throw new Error("Selecciona un archivo de imagen.");
    }

    if (file.size > IMAGE_MAX_SOURCE_BYTES) {
      throw new Error("La foto supera 20 MB. Selecciona una imagen más pequeña.");
    }
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => resolve({ image, objectUrl });
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(
          "El navegador no pudo leer esta foto. Prueba con una imagen JPG, PNG o WebP."
        ));
      };

      image.src = objectUrl;
    });
  }

  function disposeImageEditorSource() {
    if (imageEditor.sourceUrl) {
      URL.revokeObjectURL(imageEditor.sourceUrl);
    }

    imageEditor.source = null;
    imageEditor.sourceUrl = "";
    imageEditor.sourceWidth = 0;
    imageEditor.sourceHeight = 0;
  }

  function resetImageEditorTransform() {
    imageEditor.mode = "balanced";
    imageEditor.background = "blur";
    imageEditor.zoom = 1;
    imageEditor.offsetX = 0;
    imageEditor.offsetY = 0;
    imageEditor.rotation = 0;
    updateImageEditorControls();
    renderImageEditor();
  }

  async function openImageEditorFromBlob(blob, sourceName = "producto.jpg") {
    validateSelectedImage(blob);
    setImageUploadStatus("Abriendo el editor de encuadre…", "uploading");

    const loaded = await loadImageFromBlob(blob);
    const sourceWidth = Number(loaded.image.naturalWidth || loaded.image.width || 0);
    const sourceHeight = Number(loaded.image.naturalHeight || loaded.image.height || 0);

    if (!sourceWidth || !sourceHeight) {
      URL.revokeObjectURL(loaded.objectUrl);
      throw new Error("La imagen no tiene dimensiones válidas.");
    }

    disposeImageEditorSource();
    imageEditor.source = loaded.image;
    imageEditor.sourceUrl = loaded.objectUrl;
    imageEditor.sourceName = String(sourceName || "producto.jpg").slice(0, 180);
    imageEditor.sourceWidth = sourceWidth;
    imageEditor.sourceHeight = sourceHeight;
    imageEditor.mode = "balanced";
    imageEditor.background = "blur";
    imageEditor.zoom = 1;
    imageEditor.offsetX = 0;
    imageEditor.offsetY = 0;
    imageEditor.rotation = 0;

    const modal = $("#imageCropModal");
    if (modal) modal.hidden = false;
    document.body.classList.add("image-crop-open");

    updateImageEditorControls();
    renderImageEditor();
    setImageUploadStatus(
      "Ajusta la foto y pulsa “Aplicar y subir imagen”.",
      "success"
    );
  }

  async function openCurrentImageEditor() {
    const url = String($("#imageUrl")?.value || "").trim();
    if (!url || state.imageUploading || state.busy) return;

    setImageUploading(true);
    setImageUploadStatus("Descargando la imagen actual para editarla…", "uploading");

    try {
      const response = await fetch(url, { cache: "no-store", mode: "cors" });
      if (!response.ok) throw new Error(`No se pudo abrir la imagen actual (HTTP ${response.status}).`);
      const blob = await response.blob();
      const name = url.split("/").pop()?.split("?")[0] || "imagen-actual.jpg";
      await openImageEditorFromBlob(blob, name);
    } catch (error) {
      console.error("No se pudo editar la imagen actual:", error);
      setImageUploadStatus(
        "No se pudo abrir la imagen actual. Selecciónala otra vez desde Fotos o Archivos.",
        "error"
      );
      toast("No se pudo abrir la imagen actual para editarla.", "error");
    } finally {
      setImageUploading(false);
    }
  }

  function closeImageEditor() {
    const modal = $("#imageCropModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("image-crop-open");
    imageEditor.dragging = false;
    imageEditor.pointerId = null;

    const canvas = $("#imageCropCanvas");
    if (canvas) canvas.classList.remove("is-dragging");
  }

  function rotatedDimensions() {
    const quarterTurn = Math.abs(imageEditor.rotation % 180) === 90;
    return quarterTurn
      ? { width: imageEditor.sourceHeight, height: imageEditor.sourceWidth }
      : { width: imageEditor.sourceWidth, height: imageEditor.sourceHeight };
  }

  function imageScaleForMode(mode = imageEditor.mode) {
    const dimensions = rotatedDimensions();
    if (!dimensions.width || !dimensions.height) return 1;

    const containScale = Math.min(
      IMAGE_OUTPUT_WIDTH / dimensions.width,
      IMAGE_OUTPUT_HEIGHT / dimensions.height
    );
    const coverScale = Math.max(
      IMAGE_OUTPUT_WIDTH / dimensions.width,
      IMAGE_OUTPUT_HEIGHT / dimensions.height
    );

    /*
      balanced es el ajuste recomendado para fotos verticales o cuadradas:
      conserva casi todo el plato, pero amplía la foto lo suficiente para que
      no parezca una miniatura estrecha dentro de la tarjeta.
    */
    const balancedScale = Math.min(
      coverScale,
      containScale + (coverScale - containScale) * 0.48
    );

    const baseScale = mode === "cover"
      ? coverScale
      : mode === "balanced"
        ? balancedScale
        : containScale;

    return baseScale * imageEditor.zoom;
  }

  function clampImageOffsets() {
    const dimensions = rotatedDimensions();
    const scale = imageScaleForMode();
    const drawWidth = dimensions.width * scale;
    const drawHeight = dimensions.height * scale;

    if (imageEditor.mode === "cover") {
      const maxX = Math.max(0, (drawWidth - IMAGE_OUTPUT_WIDTH) / 2);
      const maxY = Math.max(0, (drawHeight - IMAGE_OUTPUT_HEIGHT) / 2);
      imageEditor.offsetX = Math.max(-maxX, Math.min(maxX, imageEditor.offsetX));
      imageEditor.offsetY = Math.max(-maxY, Math.min(maxY, imageEditor.offsetY));
      return;
    }

    if (imageEditor.mode === "balanced") {
      /*
        Permite recolocar el plato sin dejarlo salir demasiado de la zona útil.
        Cuando un eje ya sobrepasa el marco, el movimiento se limita al recorte
        disponible; cuando queda fondo, se permite un desplazamiento moderado.
      */
      const maxX = drawWidth >= IMAGE_OUTPUT_WIDTH
        ? (drawWidth - IMAGE_OUTPUT_WIDTH) / 2
        : Math.min((IMAGE_OUTPUT_WIDTH - drawWidth) / 2, IMAGE_OUTPUT_WIDTH * 0.12);
      const maxY = drawHeight >= IMAGE_OUTPUT_HEIGHT
        ? (drawHeight - IMAGE_OUTPUT_HEIGHT) / 2
        : Math.min((IMAGE_OUTPUT_HEIGHT - drawHeight) / 2, IMAGE_OUTPUT_HEIGHT * 0.12);
      imageEditor.offsetX = Math.max(-maxX, Math.min(maxX, imageEditor.offsetX));
      imageEditor.offsetY = Math.max(-maxY, Math.min(maxY, imageEditor.offsetY));
      return;
    }

    const maxX = Math.max(IMAGE_OUTPUT_WIDTH * 0.48, drawWidth * 0.45);
    const maxY = Math.max(IMAGE_OUTPUT_HEIGHT * 0.48, drawHeight * 0.45);
    imageEditor.offsetX = Math.max(-maxX, Math.min(maxX, imageEditor.offsetX));
    imageEditor.offsetY = Math.max(-maxY, Math.min(maxY, imageEditor.offsetY));
  }

  function drawSource(context, scale, offsetX, offsetY, alpha = 1) {
    if (!imageEditor.source) return;

    context.save();
    context.globalAlpha = alpha;
    context.translate(
      IMAGE_OUTPUT_WIDTH / 2 + offsetX,
      IMAGE_OUTPUT_HEIGHT / 2 + offsetY
    );
    context.rotate(imageEditor.rotation * Math.PI / 180);
    context.drawImage(
      imageEditor.source,
      -imageEditor.sourceWidth * scale / 2,
      -imageEditor.sourceHeight * scale / 2,
      imageEditor.sourceWidth * scale,
      imageEditor.sourceHeight * scale
    );
    context.restore();
  }

  function drawEditorBackground(context) {
    const background = imageEditor.background;

    if (imageEditor.mode === "cover") {
      context.fillStyle = "#f4efe7";
      context.fillRect(0, 0, IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT);
      return;
    }

    if (background === "white") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT);
      return;
    }

    if (background === "dark") {
      context.fillStyle = "#1c1b19";
      context.fillRect(0, 0, IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT);
      return;
    }

    if (background === "neutral") {
      context.fillStyle = "#f1e9de";
      context.fillRect(0, 0, IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT);
      return;
    }

    context.save();
    const dimensions = rotatedDimensions();
    const coverScale = Math.max(
      IMAGE_OUTPUT_WIDTH / dimensions.width,
      IMAGE_OUTPUT_HEIGHT / dimensions.height
    ) * 1.12;

    if ("filter" in context) context.filter = "blur(28px) saturate(1.08) contrast(.96)";
    drawSource(context, coverScale, 0, 0, 0.96);
    context.restore();

    context.fillStyle = "rgba(255, 248, 239, .10)";
    context.fillRect(0, 0, IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT);
  }

  function drawImageComposition(canvas, withGuides = false) {
    if (!canvas || !imageEditor.source) return;

    if (canvas.width !== IMAGE_OUTPUT_WIDTH) canvas.width = IMAGE_OUTPUT_WIDTH;
    if (canvas.height !== IMAGE_OUTPUT_HEIGHT) canvas.height = IMAGE_OUTPUT_HEIGHT;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Este navegador no permite procesar imágenes.");

    context.clearRect(0, 0, IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT);
    drawEditorBackground(context);
    clampImageOffsets();
    drawSource(
      context,
      imageScaleForMode(),
      imageEditor.offsetX,
      imageEditor.offsetY,
      1
    );

    if (!withGuides) return;

    context.save();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(255,255,255,.58)";
    context.setLineDash([12, 10]);
    context.beginPath();
    context.moveTo(IMAGE_OUTPUT_WIDTH / 3, 0);
    context.lineTo(IMAGE_OUTPUT_WIDTH / 3, IMAGE_OUTPUT_HEIGHT);
    context.moveTo(IMAGE_OUTPUT_WIDTH * 2 / 3, 0);
    context.lineTo(IMAGE_OUTPUT_WIDTH * 2 / 3, IMAGE_OUTPUT_HEIGHT);
    context.moveTo(0, IMAGE_OUTPUT_HEIGHT / 3);
    context.lineTo(IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT / 3);
    context.moveTo(0, IMAGE_OUTPUT_HEIGHT * 2 / 3);
    context.lineTo(IMAGE_OUTPUT_WIDTH, IMAGE_OUTPUT_HEIGHT * 2 / 3);
    context.stroke();

    const safeWidth = IMAGE_OUTPUT_HEIGHT * IMAGE_MOBILE_SAFE_RATIO;
    const safeX = (IMAGE_OUTPUT_WIDTH - safeWidth) / 2;
    context.lineWidth = 5;
    context.strokeStyle = "rgba(255, 232, 74, .95)";
    context.setLineDash([20, 12]);
    context.strokeRect(safeX, 4, safeWidth, IMAGE_OUTPUT_HEIGHT - 8);

    context.setLineDash([]);
    context.fillStyle = "rgba(0,0,0,.72)";
    context.fillRect(safeX + 12, 14, 200, 40);
    context.fillStyle = "#fff355";
    context.font = "700 22px system-ui, sans-serif";
    context.fillText("ZONA SEGURA MÓVIL", safeX + 24, 42);
    context.restore();
  }

  function renderImageEditor() {
    const canvas = $("#imageCropCanvas");
    if (!canvas || !imageEditor.source) return;
    drawImageComposition(canvas, true);
  }

  function updateImageEditorControls() {
    $$("[data-crop-mode]").forEach((button) => {
      const active = button.dataset.cropMode === imageEditor.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const background = $("#cropBackground");
    if (background) {
      background.value = imageEditor.background;
      background.disabled = imageEditor.mode === "cover";
    }

    const zoom = $("#cropZoom");
    if (zoom) zoom.value = String(imageEditor.zoom);

    const zoomValue = $("#cropZoomValue");
    if (zoomValue) zoomValue.textContent = `${Math.round(imageEditor.zoom * 100)} %`;

    const sourceInfo = $("#cropSourceInfo");
    if (sourceInfo) {
      sourceInfo.textContent = imageEditor.sourceWidth && imageEditor.sourceHeight
        ? `${imageEditor.sourceWidth} × ${imageEditor.sourceHeight} px`
        : "—";
    }
  }

  function setImageEditorMode(mode) {
    if (mode !== "contain" && mode !== "balanced" && mode !== "cover") return;
    imageEditor.mode = mode;
    imageEditor.zoom = 1;
    imageEditor.offsetX = 0;
    imageEditor.offsetY = 0;
    updateImageEditorControls();
    renderImageEditor();
  }

  function setImageEditorZoom(value) {
    const zoom = Number(value);
    imageEditor.zoom = Number.isFinite(zoom)
      ? Math.max(1, Math.min(3, zoom))
      : 1;
    clampImageOffsets();
    updateImageEditorControls();
    renderImageEditor();
  }

  function rotateImageEditor(direction) {
    imageEditor.rotation = (imageEditor.rotation + direction + 360) % 360;
    imageEditor.offsetX = 0;
    imageEditor.offsetY = 0;
    renderImageEditor();
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("No se pudo preparar la imagen para subirla."));
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  async function createEditedImageBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_OUTPUT_WIDTH;
    canvas.height = IMAGE_OUTPUT_HEIGHT;
    drawImageComposition(canvas, false);

    let quality = 0.92;
    let blob = await canvasToJpegBlob(canvas, quality);

    while (blob.size > IMAGE_MAX_UPLOAD_BYTES && quality > 0.62) {
      quality -= 0.07;
      blob = await canvasToJpegBlob(canvas, quality);
    }

    if (blob.size > IMAGE_MAX_UPLOAD_BYTES) {
      throw new Error("La imagen preparada sigue siendo demasiado pesada.");
    }

    return blob;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");

        if (commaIndex < 0) {
          reject(new Error("No se pudo leer la imagen seleccionada."));
          return;
        }

        resolve(result.slice(commaIndex + 1));
      };

      reader.onerror = () => reject(
        new Error("No se pudo leer la imagen seleccionada.")
      );

      reader.readAsDataURL(blob);
    });
  }

  async function applyAndUploadEditedImage() {
    if (!imageEditor.source || state.imageUploading) return;

    setImageUploading(true);
    setImageUploadStatus("Preparando el encuadre final…", "uploading");

    try {
      const blob = await createEditedImageBlob();
      const base64 = await blobToBase64(blob);
      const productId = String($("#productId")?.value || "").trim();
      const productName = String($("#nameEs")?.value || "Producto").trim();

      setImageUploadStatus("Subiendo la imagen a Supabase…", "uploading");

      const result = await callAdminCatalog("upload_product_image", {
        image: {
          base64,
          contentType: "image/jpeg",
          originalName: imageEditor.sourceName.replace(/\.[^.]+$/, "") + "-menu.jpg",
          productId,
          productName,
          width: IMAGE_OUTPUT_WIDTH,
          height: IMAGE_OUTPUT_HEIGHT
        }
      });

      const publicUrl = String(result?.image?.publicUrl || "").trim();
      if (!publicUrl) {
        throw new Error("Supabase no devolvió la dirección pública de la imagen.");
      }

      const imageUrlInput = $("#imageUrl");
      if (imageUrlInput) imageUrlInput.value = publicUrl;

      updateImagePreview();
      setDirty(true);
      closeImageEditor();
      setImageUploadStatus(
        "Imagen adaptada y subida correctamente. Pulsa “Guardar producto” para aplicarla al menú.",
        "success"
      );
      toast("Imagen encuadrada y subida. Guarda el producto para aplicar el cambio.");
    } catch (error) {
      console.error("No se pudo subir la imagen editada:", error);
      setImageUploadStatus(
        `No se pudo subir: ${menuAdminErrorMessage(error)}`,
        "error"
      );
      toast(`No se pudo subir la imagen. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      const input = $("#imageFile");
      if (input) input.value = "";
      setImageUploading(false);
    }
  }

  function removeCurrentImage() {
    if (state.imageUploading) return;

    const imageUrlInput = $("#imageUrl");
    if (imageUrlInput) imageUrlInput.value = "";

    const input = $("#imageFile");
    if (input) input.value = "";

    updateImagePreview();
    setDirty(true);
    setImageUploadStatus(
      "La imagen se quitará cuando pulses “Guardar producto”.",
      "success"
    );
  }

  async function handleImageInputChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    try {
      validateSelectedImage(file);
      await openImageEditorFromBlob(file, file.name || "producto.jpg");
    } catch (error) {
      console.error("No se pudo abrir el editor:", error);
      setImageUploadStatus(menuAdminErrorMessage(error), "error");
      toast(menuAdminErrorMessage(error), "error");
      const input = $("#imageFile");
      if (input) input.value = "";
    }
  }

  function updateImagePreview() {
    const imageUrlInput = $("#imageUrl");
    const image = $("#imagePreview");
    const placeholder = $("#imagePlaceholder");

    if (!imageUrlInput || !image || !placeholder) return;

    const url = String(imageUrlInput.value || "").trim();

    if (!url) {
      image.hidden = true;
      image.removeAttribute("src");
      placeholder.hidden = false;

      const removeButton = $("#removeImageButton");
      const editButton = $("#editImageButton");
      if (removeButton) removeButton.hidden = true;
      if (editButton) editButton.hidden = true;
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

    const removeButton = $("#removeImageButton");
    const editButton = $("#editImageButton");
    if (removeButton) removeButton.hidden = !url;
    if (editButton) editButton.hidden = !url;
  }

  function handleCropPointerDown(event) {
    if (!imageEditor.source) return;
    const canvas = $("#imageCropCanvas");
    if (!canvas) return;

    imageEditor.dragging = true;
    imageEditor.pointerId = event.pointerId;
    imageEditor.lastX = event.clientX;
    imageEditor.lastY = event.clientY;
    canvas.classList.add("is-dragging");

    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    }
  }

  function handleCropPointerMove(event) {
    if (!imageEditor.dragging || imageEditor.pointerId !== event.pointerId) return;
    const canvas = $("#imageCropCanvas");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = IMAGE_OUTPUT_WIDTH / Math.max(1, rect.width);
    const scaleY = IMAGE_OUTPUT_HEIGHT / Math.max(1, rect.height);
    const deltaX = (event.clientX - imageEditor.lastX) * scaleX;
    const deltaY = (event.clientY - imageEditor.lastY) * scaleY;

    imageEditor.lastX = event.clientX;
    imageEditor.lastY = event.clientY;
    imageEditor.offsetX += deltaX;
    imageEditor.offsetY += deltaY;
    clampImageOffsets();
    renderImageEditor();
  }

  function handleCropPointerUp(event) {
    if (imageEditor.pointerId !== event.pointerId) return;
    imageEditor.dragging = false;
    imageEditor.pointerId = null;
    $("#imageCropCanvas")?.classList.remove("is-dragging");
  }

  function handleCropWheel(event) {
    if (!imageEditor.source) return;
    event.preventDefault();
    const next = imageEditor.zoom + (event.deltaY < 0 ? 0.08 : -0.08);
    setImageEditorZoom(next);
  }

  function fillProductForm(product = null, creating = false) {
    state.creatingProduct = Boolean(creating);
    state.selectedProductId = product?.id || null;

    $("#productId").value = product?.id || "";
    $("#nameEs").value = product?.name_es || "";
    $("#nameEn").value = product?.name_en || "";
    $("#basePrice").value = Number(product?.base_price || 0).toFixed(2);
    $("#descriptionEs").value = product?.description_es || "";
    $("#descriptionEn").value = product?.description_en || "";
    $("#imageUrl").value = product?.image_url || "";
    $("#visible").checked = product ? product.visible !== false : true;
    $("#active").checked = product ? product.active !== false : true;
    $("#taxable").checked = product ? product.taxable !== false : true;
    $("#sortOrder").value = Number(product?.sort_order || 0);

    const defaultCategory =
      product?.category_id ||
      (state.category !== "all" ? state.category : "") ||
      state.catalog.categories.find((category) => category.active)?.id ||
      state.catalog.categories[0]?.id ||
      "";

    renderProductCategoryOptions(defaultCategory);
    state.optionDraftGroups = product?.id ? productOptionDraft(product.id) : [];
    renderOptionGroupsEditor();

    $("#drawerEyebrow").textContent = creating ? "Nuevo producto" : "Editar producto";
    $("#drawerTitle").textContent = product?.name_es || "Nuevo producto";
    $("#deleteProductButton").hidden = creating || !product?.id;

    const imageFileInput = $("#imageFile");
    if (imageFileInput) imageFileInput.value = "";
    setImageUploadStatus();
    updateImagePreview();
    setDirty(false);
  }

  function openProductDrawer(product = null, creating = false) {
    if (!state.catalog.categories.length) {
      toast("Primero necesitas al menos una categoría.", "error");
      return;
    }

    fillProductForm(product, creating);

    const backdrop = $("#drawerBackdrop");
    const drawer = $("#productDrawer");

    if (backdrop) backdrop.hidden = false;
    if (drawer) drawer.setAttribute("aria-hidden", "false");

    document.body.classList.add("drawer-open");
    setTimeout(() => $("#nameEs")?.focus(), 100);
  }

  function closeProductDrawer(force = false) {
    if (!force && state.imageUploading) {
      toast("Espera a que termine la subida de la imagen.", "error");
      return;
    }

    if (
      !force &&
      state.dirty &&
      !confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")
    ) {
      return;
    }

    const backdrop = $("#drawerBackdrop");
    const drawer = $("#productDrawer");

    if (backdrop) backdrop.hidden = true;
    if (drawer) drawer.setAttribute("aria-hidden", "true");

    document.body.classList.remove("drawer-open");
    state.selectedProductId = null;
    state.creatingProduct = false;
    setDirty(false);
  }

  function productPayload() {
    const nameEs = String($("#nameEs").value || "").trim();
    const nameEn = String($("#nameEn").value || "").trim() || nameEs;
    const categoryId = String($("#productCategory").value || "").trim();
    const price = Number($("#basePrice").value || 0);

    if (!nameEs) throw new Error("Escribe el nombre en español.");
    if (!categoryId) throw new Error("Selecciona una categoría.");
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Escribe un precio válido.");
    }

    const payload = {
      categoryId,
      nameEs,
      nameEn,
      descriptionEs: String($("#descriptionEs").value || "").trim(),
      descriptionEn: String($("#descriptionEn").value || "").trim(),
      basePrice: price,
      imageUrl: String($("#imageUrl").value || "").trim(),
      visible: $("#visible").checked,
      active: $("#active").checked,
      taxable: $("#taxable").checked,
      featured: false,
      sortOrder: Number($("#sortOrder").value || 0),
      optionGroups: optionGroupsPayload()
    };

    const id = String($("#productId").value || "").trim();
    if (id) payload.id = id;

    return payload;
  }

  async function saveProduct(event) {
    event.preventDefault();

    if (state.imageUploading) {
      toast("Espera a que termine la subida de la imagen.", "error");
      return;
    }

    setBusy(true);

    try {
      const product = productPayload();
      const action = state.creatingProduct ? "create_product" : "update_product";
      const result = await callAdminCatalog(action, { product });

      state.selectedProductId = result.product?.id || product.id || null;
      state.creatingProduct = false;
      setDirty(false);

      await loadCatalog({ preserveSelection: true });
      closeProductDrawer(true);
      toast("Producto guardado correctamente.");
    } catch (error) {
      console.error(error);
      toast(`No se pudo guardar. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct() {
    const productId = String($("#productId").value || "").trim();
    if (!productId) return;

    const product = state.catalog.products.find(
      (candidate) => candidate.id === productId
    );

    const accepted = confirm(
      `¿Eliminar definitivamente "${product?.name_es || productId}"?\n\n` +
      "Para retirarlo temporalmente, usa el interruptor de visibilidad."
    );

    if (!accepted) return;

    setBusy(true);

    try {
      await callAdminCatalog("delete_product", { productId });
      closeProductDrawer(true);
      await loadCatalog({ preserveSelection: false });
      toast("Producto eliminado.");
    } catch (error) {
      console.error(error);
      toast(`No se pudo eliminar. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility(productId, visible) {
    try {
      await callAdminCatalog("set_product_visibility", { productId, visible });

      const product = state.catalog.products.find(
        (candidate) => candidate.id === productId
      );

      if (product) product.visible = visible;

      renderProducts();
      toast(visible ? "Producto visible." : "Producto ocultado.");
    } catch (error) {
      console.error(error);
      renderProducts();
      toast(`No se pudo cambiar el estado. ${menuAdminErrorMessage(error)}`, "error");
    }
  }

  function fillCategoryForm(category) {
    state.editingCategoryId = category.id;
    $("#categoryId").value = category.id;
    $("#categoryNameEs").value = category.name_es || "";
    $("#categoryNameEn").value = category.name_en || "";
    $("#categorySortOrder").value = Number(category.sort_order || 0);
    $("#categoryActive").checked = category.active !== false;
    $("#categoryModalTitle").textContent = category.name_es || "Categoría";
  }

  function openCategoryModal(category) {
    fillCategoryForm(category);
    const modal = $("#categoryModal");
    if (modal) modal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => $("#categoryNameEs")?.focus(), 80);
  }

  function closeCategoryModal() {
    const modal = $("#categoryModal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("modal-open");
    state.editingCategoryId = null;
  }

  async function saveCategory(event) {
    event.preventDefault();

    const nameEs = String($("#categoryNameEs").value || "").trim();
    const nameEn = String($("#categoryNameEn").value || "").trim() || nameEs;

    if (!nameEs) {
      toast("Escribe el nombre de la categoría.", "error");
      return;
    }

    setBusy(true);

    try {
      await callAdminCatalog("update_category", {
        category: {
          id: String($("#categoryId").value || "").trim(),
          nameEs,
          nameEn,
          sortOrder: Number($("#categorySortOrder").value || 0),
          active: $("#categoryActive").checked
        }
      });

      closeCategoryModal();
      await loadCatalog({ preserveSelection: true });
      toast("Categoría guardada correctamente.");
    } catch (error) {
      console.error(error);
      toast(`No se pudo guardar la categoría. ${menuAdminErrorMessage(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function login(event) {
    event.preventDefault();

    const input = $("#pinInput");
    const errorBox = $("#loginError");
    const pin = String(input?.value || "").trim();

    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }

    if (!pin) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = "Escribe el PIN de gestión del menú.";
      }
      input?.focus();
      return;
    }

    setBusy(true);

    try {
      await callAdminCatalog("list_catalog", {}, pin);

      state.pin = pin;
      if (input) input.value = "";

      const loginScreen = $("#loginScreen");
      const appShell = $("#appShell");

      if (loginScreen) loginScreen.hidden = true;
      if (appShell) appShell.hidden = false;

      await loadCatalog({ preserveSelection: false });
    } catch (loginError) {
      console.error(loginError);
      state.pin = "";

      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = menuAdminErrorMessage(loginError);
      }

      input?.focus();
      input?.select();
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    state.pin = "";
    closeProductDrawer(true);
    closeCategoryModal();

    const appShell = $("#appShell");
    const loginScreen = $("#loginScreen");

    if (appShell) appShell.hidden = true;
    if (loginScreen) loginScreen.hidden = false;

    $("#pinInput")?.focus();
  }

  function init() {
    ensureScheduleView();
    const loginForm = $("#loginForm");

    if (!loginForm) {
      console.error("No se encontró #loginForm en menu-admin.html.");
      return;
    }

    loginForm.addEventListener("submit", login);
    $("#logoutButton")?.addEventListener("click", logout);
    $("#newAvailabilityItemButton")?.addEventListener("click", () => openAvailabilityItemForm());
    $("#cancelAvailabilityItemButton")?.addEventListener("click", closeAvailabilityItemForm);
    $("#availabilityItemForm")?.addEventListener("submit", saveAvailabilityItem);
    $("#availabilityItemGroupSelect")?.addEventListener("change", toggleNewInventoryGroupField);
    $("#availabilityItemSearch")?.addEventListener("input", (event) => {
      state.availabilityQuery = event.target.value || "";
      renderAvailabilityItems();
    });
    $("#businessSettingsForm")?.addEventListener("submit", saveBusinessSettings);
    $("#weeklyScheduleForm")?.addEventListener("submit", saveWeeklySchedule);
    $("#weeklyScheduleRows")?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-schedule-open]");
      if (input) updateScheduleRow(input.dataset.scheduleOpen);
    });
    $("#restoreDefaultScheduleButton")?.addEventListener("click", () => {
      state.businessSettings = {
        ...(state.businessSettings || {}),
        weekly_schedule: JSON.parse(JSON.stringify(WEEKLY_SCHEDULE_DEFAULTS))
      };
      renderWeeklySchedule();
      const status = $("#weeklyScheduleStatus");
      if (status) status.textContent =
        "Horario recomendado cargado. Pulsa Guardar para aplicarlo.";
    });
    $("#businessTaxEnabled")?.addEventListener("change", updateTaxSettingsUi);
    $("#businessCheckoutMode")?.addEventListener("change", updateKioskSettingsUi);
    $("#testKioskBridgeButton")?.addEventListener("click", testKioskBridgeConnection);
    $("#resetBusinessSettingsButton")?.addEventListener("click", () => {
      state.businessSettings = { ...BUSINESS_DEFAULTS };
      const form = $("#businessSettingsForm");
      if (form) form.dataset.loaded = "false";
      fillBusinessSettingsForm(true);
    });

    $$('[data-view]').forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });

    $("#mobileMenuButton")?.addEventListener("click", openMobileSidebar);
    $("#mobileSidebarBackdrop")?.addEventListener("click", closeMobileSidebar);

    $("#refreshButton")?.addEventListener("click", () => {
      loadCatalog({ preserveSelection: true })
        .then(() => toast("Catálogo actualizado."))
        .catch((error) => {
          toast(`No se pudo actualizar. ${menuAdminErrorMessage(error)}`, "error");
        });
    });

    $("#addProductButton")?.addEventListener("click", () => {
      openProductDrawer(null, true);
    });

    $$('[data-create-product]').forEach((button) => {
      button.addEventListener("click", () => openProductDrawer(null, true));
    });

    $("#productSearch")?.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderProducts();
    });

    $("#categoryFilter")?.addEventListener("change", (event) => {
      state.category = event.target.value;
      renderProducts();
    });

    $("#statusFilter")?.addEventListener("change", (event) => {
      state.status = event.target.value;
      renderProducts();
    });

    $("#clearFiltersButton")?.addEventListener("click", () => {
      state.query = "";
      state.category = "all";
      state.status = "all";

      if ($("#productSearch")) $("#productSearch").value = "";
      if ($("#categoryFilter")) $("#categoryFilter").value = "all";
      if ($("#statusFilter")) $("#statusFilter").value = "all";

      renderProducts();
    });

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const productButton = target.closest("[data-edit-product]");

      if (productButton) {
        const product = state.catalog.products.find(
          (candidate) => candidate.id === productButton.dataset.editProduct
        );
        if (product) openProductDrawer(product, false);
        return;
      }

      const editAvailabilityButton = target.closest("[data-edit-availability-item]");
      if (editAvailabilityButton) {
        const item = (state.catalog.inventory || []).find(
          (candidate) => String(candidate.id) === String(editAvailabilityButton.dataset.editAvailabilityItem)
        );
        if (item) openAvailabilityItemForm(item);
        return;
      }

      const deleteAvailabilityButton = target.closest("[data-delete-availability-item]");
      if (deleteAvailabilityButton) {
        void deleteAvailabilityItem(deleteAvailabilityButton.dataset.deleteAvailabilityItem);
        return;
      }

      const categoryButton = target.closest("[data-edit-category]");

      if (categoryButton) {
        const category = state.catalog.categories.find(
          (candidate) => candidate.id === categoryButton.dataset.editCategory
        );
        if (category) openCategoryModal(category);
        return;
      }

      if (target.closest("[data-close-category-modal]")) {
        closeCategoryModal();
      }
    });

    document.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const input = target.closest("[data-product-visible]");
      if (input) {
        toggleVisibility(input.dataset.productVisible, input.checked);
      }
    });

    $("#closeDrawerButton")?.addEventListener("click", () => closeProductDrawer());
    $("#drawerBackdrop")?.addEventListener("click", () => closeProductDrawer());
    $("#cancelProductButton")?.addEventListener("click", () => closeProductDrawer());
    $("#deleteProductButton")?.addEventListener("click", deleteProduct);
    $("#addOptionGroupButton")?.addEventListener("click", addOptionGroup);

    $("#optionGroupsEditor")?.addEventListener("click", (event) => {
      const removeGroup = event.target.closest("[data-remove-option-group]");
      if (removeGroup) {
        removeOptionGroup(removeGroup.dataset.removeOptionGroup);
        return;
      }

      const addOption = event.target.closest("[data-add-option]");
      if (addOption) {
        addOptionToGroup(addOption.dataset.addOption);
        return;
      }

      const removeOption = event.target.closest("[data-remove-option]");
      if (removeOption) {
        removeOptionFromGroup(
          removeOption.dataset.groupId,
          removeOption.dataset.removeOption
        );
      }
    });

    $("#optionGroupsEditor")?.addEventListener("input", (event) => {
      updateOptionDraftFromInput(event.target);
    });

    $("#optionGroupsEditor")?.addEventListener("change", (event) => {
      updateOptionDraftFromInput(event.target);
    });

    $("#productForm")?.addEventListener("submit", saveProduct);

    $("#productForm")?.addEventListener("input", () => {
      setDirty(true);
      const title = $("#drawerTitle");
      if (title) {
        title.textContent = String($("#nameEs")?.value || "").trim() || "Nuevo producto";
      }
    });

    $("#productForm")?.addEventListener("change", () => setDirty(true));
    $("#imageUrl")?.addEventListener("input", updateImagePreview);
    $("#imagePickerButton")?.addEventListener("click", openImagePicker);
    $("#chooseImageButton")?.addEventListener("click", openImagePicker);
    $("#editImageButton")?.addEventListener("click", openCurrentImageEditor);
    $("#imageFile")?.addEventListener("change", handleImageInputChange);
    $("#removeImageButton")?.addEventListener("click", removeCurrentImage);

    $$("[data-crop-mode]").forEach((button) => {
      button.addEventListener("click", () => setImageEditorMode(button.dataset.cropMode));
    });
    $("#cropBackground")?.addEventListener("change", (event) => {
      imageEditor.background = event.target.value || "blur";
      renderImageEditor();
    });
    $("#cropZoom")?.addEventListener("input", (event) => setImageEditorZoom(event.target.value));
    $("#rotateImageLeft")?.addEventListener("click", () => rotateImageEditor(-90));
    $("#rotateImageRight")?.addEventListener("click", () => rotateImageEditor(90));
    $("#resetImageCrop")?.addEventListener("click", resetImageEditorTransform);
    $("#closeImageCropButton")?.addEventListener("click", closeImageEditor);
    $("#cancelImageCropButton")?.addEventListener("click", closeImageEditor);
    $("[data-close-image-editor]")?.addEventListener("click", closeImageEditor);
    $("#applyImageCropButton")?.addEventListener("click", applyAndUploadEditedImage);

    const cropCanvas = $("#imageCropCanvas");
    cropCanvas?.addEventListener("pointerdown", handleCropPointerDown);
    cropCanvas?.addEventListener("pointermove", handleCropPointerMove);
    cropCanvas?.addEventListener("pointerup", handleCropPointerUp);
    cropCanvas?.addEventListener("pointercancel", handleCropPointerUp);
    cropCanvas?.addEventListener("wheel", handleCropWheel, { passive: false });
    $("#categoryForm")?.addEventListener("submit", saveCategory);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      const imageCropModal = $("#imageCropModal");
      const categoryModal = $("#categoryModal");
      const productDrawer = $("#productDrawer");

      if (imageCropModal && !imageCropModal.hidden) {
        closeImageEditor();
        return;
      }

      if (categoryModal && !categoryModal.hidden) {
        closeCategoryModal();
        return;
      }

      if (
        productDrawer &&
        productDrawer.getAttribute("aria-hidden") === "false"
      ) {
        closeProductDrawer();
        return;
      }

      closeMobileSidebar();
    });

    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    window.addEventListener("pagehide", () => {
      state.pin = "";
    });

    $("#pinInput")?.focus();
    updateSyncStatus();
  }

  init();
})();
