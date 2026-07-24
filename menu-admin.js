(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const money = (value) => `$${Number(value || 0).toFixed(2)}`;

  window.FOGON_MENU_ADMIN_BUILD = "4-image-upload";

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
    imageUploading: false
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

  function renderAll() {
    renderProducts();
    renderCategories();
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
        inventory: result.catalog?.inventory || []
      };

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

  function switchView(view) {
    state.view = view;

    $$('[data-view]').forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });

    const productsView = $("#productsView");
    const categoriesView = $("#categoriesView");
    const pageTitle = $("#pageTitle");
    const addProductButton = $("#addProductButton");

    if (productsView) productsView.hidden = view !== "products";
    if (categoriesView) categoriesView.hidden = view !== "categories";
    if (pageTitle) pageTitle.textContent = view === "products" ? "Productos" : "Categorías";
    if (addProductButton) addProductButton.hidden = view !== "products";

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

  const IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const IMAGE_MAX_UPLOAD_BYTES = 1800 * 1024;
  const IMAGE_MAX_DIMENSION = 1600;
  const IMAGE_DEFAULT_HELP =
    "En móvil abrirá Fotos, Cámara o Archivos; en PC abrirá el explorador de archivos.";

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

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
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

  async function prepareImageForUpload(file) {
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

    const loaded = await loadImageFromFile(file);

    try {
      const sourceWidth = Number(loaded.image.naturalWidth || loaded.image.width || 0);
      const sourceHeight = Number(loaded.image.naturalHeight || loaded.image.height || 0);

      if (!sourceWidth || !sourceHeight) {
        throw new Error("La imagen no tiene dimensiones válidas.");
      }

      let scale = Math.min(
        1,
        IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight)
      );
      let quality = 0.86;
      let blob = null;
      let canvas = null;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));

        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Este navegador no permite procesar imágenes.");

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(loaded.image, 0, 0, width, height);

        blob = await canvasToJpegBlob(canvas, quality);

        if (blob.size <= IMAGE_MAX_UPLOAD_BYTES) break;

        if (quality > 0.62) {
          quality -= 0.08;
        } else {
          scale *= 0.82;
        }
      }

      if (!blob || blob.size > IMAGE_MAX_UPLOAD_BYTES) {
        throw new Error(
          "No fue posible reducir esta imagen. Prueba con otra foto menos pesada."
        );
      }

      return {
        blob,
        contentType: "image/jpeg",
        width: canvas.width,
        height: canvas.height
      };
    } finally {
      URL.revokeObjectURL(loaded.objectUrl);
    }
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

  async function uploadImageFile(file) {
    if (state.imageUploading) return;

    setImageUploading(true);
    setImageUploadStatus("Preparando la imagen…", "uploading");

    try {
      const prepared = await prepareImageForUpload(file);
      setImageUploadStatus("Subiendo la imagen a Supabase…", "uploading");

      const base64 = await blobToBase64(prepared.blob);
      const productId = String($("#productId")?.value || "").trim();
      const productName = String($("#nameEs")?.value || "Producto").trim();

      const result = await callAdminCatalog("upload_product_image", {
        image: {
          base64,
          contentType: prepared.contentType,
          originalName: String(file.name || "producto.jpg").slice(0, 180),
          productId,
          productName,
          width: prepared.width,
          height: prepared.height
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
      setImageUploadStatus(
        "Imagen subida correctamente. Pulsa “Guardar producto” para aplicarla al menú.",
        "success"
      );
      toast("Imagen subida. Guarda el producto para aplicar el cambio.");
    } catch (error) {
      console.error("No se pudo subir la imagen:", error);
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

  function handleImageInputChange(event) {
    const file = event?.target?.files?.[0];
    if (file) uploadImageFile(file);
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
      if (removeButton) removeButton.hidden = true;
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
    if (removeButton) removeButton.hidden = !url;
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
    renderOptionSummary(product?.id || "");

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
      sortOrder: Number($("#sortOrder").value || 0)
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
    const loginForm = $("#loginForm");

    if (!loginForm) {
      console.error("No se encontró #loginForm en menu-admin.html.");
      return;
    }

    loginForm.addEventListener("submit", login);
    $("#logoutButton")?.addEventListener("click", logout);

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
    $("#imageFile")?.addEventListener("change", handleImageInputChange);
    $("#removeImageButton")?.addEventListener("click", removeCurrentImage);
    $("#categoryForm")?.addEventListener("submit", saveCategory);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      const categoryModal = $("#categoryModal");
      const productDrawer = $("#productDrawer");

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
