const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

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
  busy: false
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
    throw new Error(
      "Faltan la URL o la anon key en supabase-config.js."
    );
  }

  return {
    url,
    anonKey
  };
}

async function callAdminCatalog(
  action,
  extraBody = {},
  pinOverride = ""
) {
  const pin = String(
    pinOverride || state.pin || ""
  ).trim();

  if (!pin) {
    throw new Error(
      "La sesión terminó. Vuelve a introducir el PIN."
    );
  }

  const { url, anonKey } = supabaseConfig();

  const response = await fetch(
    `${url}/functions/v1/admin-catalog`,
    {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        action,
        adminPin: pin,
        ...extraBody
      })
    }
  );

  const raw = await response.text();
  let result = {};

  try {
    result = raw ? JSON.parse(raw) : {};
  } catch (_) {
    result = {
      detail: raw
    };
  }

  if (!response.ok || !result?.ok) {
    const message = [
      result?.detail,
      result?.error,
      `HTTP ${response.status}`
    ]
      .filter(Boolean)
      .join(" · ");

    const error = new Error(
      message || "Supabase rechazó la solicitud."
    );

    error.status = response.status;
    error.payload = result;

    throw error;
  }

  return result;
}

function updateSyncStatus() {
  const status = $("#syncStatus");

  if (!status) {
    return;
  }

  const label = status.querySelector(
    "span:last-child"
  );

  status.dataset.state = state.busy
    ? "busy"
    : state.dirty
      ? "dirty"
      : "saved";

  if (label) {
    label.textContent = state.busy
      ? "Guardando…"
      : state.dirty
        ? "Cambios sin guardar"
        : "Todo guardado";
  }
}

function setBusy(busy) {
  state.busy = Boolean(busy);

  updateSyncStatus();

  [
    "#refreshButton",
    "#addProductButton",
    "#saveProductButton",
    "#deleteProductButton",
    "#loginButton"
  ].forEach((selector) => {
    const element = $(selector);

    if (element) {
      element.disabled = state.busy;
    }
  });
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

  setTimeout(() => {
    item.remove();
  }, 4200);
}

function categoryName(categoryId) {
  return (
    state.catalog.categories.find(
      (category) => category.id === categoryId
    )?.name_es ||
    categoryId ||
    "Sin categoría"
  );
}

function productStats(productId) {
  const groups =
    state.catalog.optionGroups.filter(
      (group) => group.product_id === productId
    );

  const groupIds = new Set(
    groups.map((group) => group.id)
  );

  return {
    groups: groups.length,

    options: state.catalog.options.filter(
      (option) =>
        groupIds.has(option.option_group_id)
    ).length,

    extras:
      state.catalog.productExtras.filter(
        (link) => link.product_id === productId
      ).length,

    removables:
      state.catalog.productRemovables.filter(
        (link) => link.product_id === productId
      ).length
  };
}

function renderSummary() {
  const products = state.catalog.products;

  const totalProducts = $("#totalProducts");
  const visibleProducts = $("#visibleProducts");
  const hiddenProducts = $("#hiddenProducts");

  if (totalProducts) {
    totalProducts.textContent = String(
      products.length
    );
  }

  if (visibleProducts) {
    visibleProducts.textContent = String(
      products.filter(
        (product) => product.visible
      ).length
    );
  }

  if (hiddenProducts) {
    hiddenProducts.textContent = String(
      products.filter(
        (product) => !product.visible
      ).length
    );
  }
}

function renderCategoryFilter() {
  const select = $("#categoryFilter");

  if (!select) {
    return;
  }

  const current = state.category;

  select.innerHTML = [
    `<option value="all">Todas las categorías</option>`,

    ...state.catalog.categories.map(
      (category) => `
        <option value="${escapeHtml(category.id)}">
          ${escapeHtml(category.name_es)}
        </option>
      `
    )
  ].join("");

  select.value =
    state.catalog.categories.some(
      (category) => category.id === current
    )
      ? current
      : "all";
}

function filteredProducts() {
  const query = state.query
    .trim()
    .toLowerCase();

  return state.catalog.products.filter(
    (product) => {
      const matchesCategory =
        state.category === "all" ||
        product.category_id === state.category;

      const matchesStatus =
        state.status === "all" ||
        (
          state.status === "visible" &&
          product.visible
        ) ||
        (
          state.status === "hidden" &&
          !product.visible
        ) ||
        (
          state.status === "inactive" &&
          !product.active
        );

      const text = [
        product.name_es,
        product.name_en,
        product.description_es,
        product.description_en,
        categoryName(product.category_id)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        matchesCategory &&
        matchesStatus &&
        (!query || text.includes(query))
      );
    }
  );
}

function renderProducts() {
  renderSummary();
  renderCategoryFilter();

  const body = $("#productTableBody");
  const empty = $("#productEmptyState");

  if (!body || !empty) {
    return;
  }

  const products = filteredProducts();

  if (!products.length) {
    body.innerHTML = "";
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  body.innerHTML = products
    .map(
      (product) => `
        <tr>
          <td>
            <div class="product-cell">
              <span class="product-thumb">
                ${
                  product.image_url
                    ? `
                      <img
                        src="${escapeHtml(product.image_url)}"
                        alt=""
                        loading="lazy"
                      >
                    `
                    : "Sin imagen"
                }
              </span>

              <span class="product-copy">
                <strong>
                  ${escapeHtml(product.name_es)}
                </strong>

                <small>
                  ${escapeHtml(
                    product.name_en ||
                    product.description_es ||
                    ""
                  )}
                </small>
              </span>
            </div>
          </td>

          <td>
            ${escapeHtml(
              categoryName(product.category_id)
            )}
          </td>

          <td>
            <span class="price-value">
              ${money(product.base_price)}
            </span>
          </td>

          <td>
            <div class="status-control">
              <label class="status-switch">
                <input
                  type="checkbox"
                  data-product-visible="${escapeHtml(product.id)}"
                  ${product.visible ? "checked" : ""}
                  aria-label="Mostrar u ocultar ${escapeHtml(product.name_es)}"
                >

                <span
                  class="status-switch-control"
                  aria-hidden="true"
                ></span>
              </label>

              <span class="status-label">
                ${product.visible ? "Visible" : "Oculto"}
              </span>
            </div>
          </td>

          <td class="align-right">
            <div class="row-actions">
              <button
                class="row-button"
                type="button"
                data-edit-product="${escapeHtml(product.id)}"
              >
                Editar
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderCategories() {
  const list = $("#categoryList");

  if (!list) {
    return;
  }

  if (!state.catalog.categories.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">×</div>
        <h2>No hay categorías</h2>
        <p>
          Ejecuta primero la carga inicial del catálogo.
        </p>
      </div>
    `;

    return;
  }

  list.innerHTML = state.catalog.categories
    .map((category) => {
      const productCount =
        state.catalog.products.filter(
          (product) =>
            product.category_id === category.id
        ).length;

      return `
        <article class="category-row">
          <div>
            <small>Nombre en español</small>
            <strong>
              ${escapeHtml(category.name_es)}
            </strong>
          </div>

          <div class="category-english">
            <small>Nombre en inglés</small>
            <span>
              ${escapeHtml(
                category.name_en ||
                category.name_es
              )}
            </span>
          </div>

          <div class="category-order">
            <small>Orden</small>
            <span>
              ${Number(category.sort_order || 0)}
            </span>
          </div>

          <div>
            <small>Productos</small>
            <span>${productCount}</span>
          </div>

          <button
            class="row-button"
            type="button"
            data-edit-category="${escapeHtml(category.id)}"
          >
            Editar
          </button>
        </article>
      `;
    })
    .join("");
}

function renderAll() {
  renderProducts();
  renderCategories();
}

async function loadCatalog({
  preserveSelection = true
} = {}) {
  const selectedProductId =
    preserveSelection
      ? state.selectedProductId
      : null;

  setBusy(true);

  try {
    const result =
      await callAdminCatalog("list_catalog");

    state.catalog = {
      categories:
        result.catalog?.categories || [],

      products:
        result.catalog?.products || [],

      optionGroups:
        result.catalog?.optionGroups || [],

      options:
        result.catalog?.options || [],

      extras:
        result.catalog?.extras || [],

      productExtras:
        result.catalog?.productExtras || [],

      removables:
        result.catalog?.removables || [],

      productRemovables:
        result.catalog?.productRemovables || [],

      inventory:
        result.catalog?.inventory || []
    };

    renderAll();

    if (selectedProductId) {
      const selected =
        state.catalog.products.find(
          (product) =>
            product.id === selectedProductId
        );

      const drawer = $("#productDrawer");

      if (
        selected &&
        drawer &&
        drawer.getAttribute("aria-hidden") ===
          "false"
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

  $$("[data-view]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.view === view
    );
  });

  const productsView = $("#productsView");
  const categoriesView = $("#categoriesView");
  const pageTitle = $("#pageTitle");
  const addProductButton =
    $("#addProductButton");

  if (productsView) {
    productsView.hidden = view !== "products";
  }

  if (categoriesView) {
    categoriesView.hidden =
      view !== "categories";
  }

  if (pageTitle) {
    pageTitle.textContent =
      view === "products"
        ? "Productos"
        : "Categorías";
  }

  if (addProductButton) {
    addProductButton.hidden =
      view !== "products";
  }

  closeMobileSidebar();
}

function openMobileSidebar() {
  document.body.classList.add(
    "sidebar-open"
  );

  const backdrop =
    $("#mobileSidebarBackdrop");

  if (backdrop) {
    backdrop.hidden = false;
  }
}

function closeMobileSidebar() {
  document.body.classList.remove(
    "sidebar-open"
  );

  const backdrop =
    $("#mobileSidebarBackdrop");

  if (backdrop) {
    backdrop.hidden = true;
  }
}

function renderProductCategoryOptions(
  selected = ""
) {
  const select = $("#productCategory");

  if (!select) {
    return;
  }

  select.innerHTML =
    state.catalog.categories
      .map(
        (category) => `
          <option value="${escapeHtml(category.id)}">
            ${escapeHtml(category.name_es)}
            ${category.active ? "" : " — inactiva"}
          </option>
        `
      )
      .join("");

  if (selected) {
    select.value = selected;
  }
}

function renderOptionSummary(
  productId = ""
) {
  const stats = productId
    ? productStats(productId)
    : {
        groups: 0,
        options: 0,
        extras: 0,
        removables: 0
      };

  const summary = $("#optionSummary");

  if (!summary) {
    return;
  }

  summary.innerHTML = `
    <article>
      <strong>${stats.groups}</strong>
      <span>Grupos</span>
    </article>

    <article>
      <strong>${stats.options}</strong>
      <span>Opciones</span>
    </article>

    <article>
      <strong>${stats.extras}</strong>
      <span>Extras</span>
    </article>

    <article>
      <strong>${stats.removables}</strong>
      <span>Removibles</span>
    </article>
  `;
}

function updateImagePreview() {
  const imageUrlInput = $("#imageUrl");
  const image = $("#imagePreview");
  const placeholder =
    $("#imagePlaceholder");

  if (
    !imageUrlInput ||
    !image ||
    !placeholder
  ) {
    return;
  }

  const url = String(
    imageUrlInput.value || ""
  ).trim();

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

function fillProductForm(
  product = null,
  creating = false
) {
  state.creatingProduct =
    Boolean(creating);

  state.selectedProductId =
    product?.id || null;

  $("#productId").value =
    product?.id || "";

  $("#nameEs").value =
    product?.name_es || "";

  $("#nameEn").value =
    product?.name_en || "";

  $("#basePrice").value =
    Number(
      product?.base_price || 0
    ).toFixed(2);

  $("#descriptionEs").value =
    product?.description_es || "";

  $("#descriptionEn").value =
    product?.description_en || "";

  $("#imageUrl").value =
    product?.image_url || "";

  $("#visible").checked =
    product
      ? product.visible !== false
      : true;

  $("#active").checked =
    product
      ? product.active !== false
      : true;

  $("#taxable").checked =
    product
      ? product.taxable !== false
      : true;

  $("#sortOrder").value =
    Number(product?.sort_order || 0);

  const defaultCategory =
    product?.category_id ||
    (
      state.category !== "all"
        ? state.category
        : ""
    ) ||
    state.catalog.categories.find(
      (category) => category.active
    )?.id ||
    state.catalog.categories[0]?.id ||
    "";

  renderProductCategoryOptions(
    defaultCategory
  );

  renderOptionSummary(
    product?.id || ""
  );

  $("#drawerEyebrow").textContent =
    creating
      ? "Nuevo producto"
      : "Editar producto";

  $("#drawerTitle").textContent =
    product?.name_es ||
    "Nuevo producto";

  $("#deleteProductButton").hidden =
    creating || !product?.id;

  updateImagePreview();
  setDirty(false);
}

function openProductDrawer(
  product = null,
  creating = false
) {
  if (!state.catalog.categories.length) {
    toast(
      "Primero necesitas al menos una categoría.",
      "error"
    );

    return;
  }

  fillProductForm(product, creating);

  const backdrop = $("#drawerBackdrop");
  const drawer = $("#productDrawer");

  if (backdrop) {
    backdrop.hidden = false;
  }

  if (drawer) {
    drawer.setAttribute(
      "aria-hidden",
      "false"
    );
  }

  document.body.classList.add(
    "drawer-open"
  );

  setTimeout(() => {
    $("#nameEs")?.focus();
  }, 100);
}

function closeProductDrawer(
  force = false
) {
  if (
    !force &&
    state.dirty &&
    !confirm(
      "Hay cambios sin guardar. ¿Quieres descartarlos?"
    )
  ) {
    return;
  }

  const backdrop = $("#drawerBackdrop");
  const drawer = $("#productDrawer");

  if (backdrop) {
    backdrop.hidden = true;
  }

  if (drawer) {
    drawer.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  document.body.classList.remove(
    "drawer-open"
  );

  state.selectedProductId = null;
  state.creatingProduct = false;

  setDirty(false);
}

function productPayload() {
  const nameEs = String(
    $("#nameEs").value || ""
  ).trim();

  const nameEn =
    String(
      $("#nameEn").value || ""
    ).trim() || nameEs;

  const categoryId = String(
    $("#productCategory").value || ""
  ).trim();

  const price = Number(
    $("#basePrice").value || 0
  );

  if (!nameEs) {
    throw new Error(
      "Escribe el nombre en español."
    );
  }

  if (!categoryId) {
    throw new Error(
      "Selecciona una categoría."
    );
  }

  if (
    !Number.isFinite(price) ||
    price < 0
  ) {
    throw new Error(
      "Escribe un precio válido."
    );
  }

  const payload = {
    categoryId,
    nameEs,
    nameEn,

    descriptionEs: String(
      $("#descriptionEs").value || ""
    ).trim(),

    descriptionEn: String(
      $("#descriptionEn").value || ""
    ).trim(),

    basePrice: price,

    imageUrl: String(
      $("#imageUrl").value || ""
    ).trim(),

    visible:
      $("#visible").checked,

    active:
      $("#active").checked,

    taxable:
      $("#taxable").checked,

    featured: false,

    sortOrder: Number(
      $("#sortOrder").value || 0
    )
  };

  const id = String(
    $("#productId").value || ""
  ).trim();

  if (id) {
    payload.id = id;
  }

  return payload;
}

async function saveProduct(event) {
  event.preventDefault();
  setBusy(true);

  try {
    const product = productPayload();

    const action =
      state.creatingProduct
        ? "create_product"
        : "update_product";

    const result =
      await callAdminCatalog(
        action,
        {
          product
        }
      );

    state.selectedProductId =
      result.product?.id ||
      product.id ||
      null;

    state.creatingProduct = false;

    setDirty(false);

    await loadCatalog({
      preserveSelection: true
    });

    closeProductDrawer(true);

    toast(
      "Producto guardado correctamente."
    );
  } catch (error) {
    console.error(error);

    toast(
      `No se pudo guardar. ${
        error.message || error
      }`,
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function deleteProduct() {
  const productId = String(
    $("#productId").value || ""
  ).trim();

  if (!productId) {
    return;
  }

  const product =
    state.catalog.products.find(
      (candidate) =>
        candidate.id === productId
    );

  const accepted = confirm(
    `¿Eliminar definitivamente "${
      product?.name_es || productId
    }"?\n\nPara retirarlo temporalmente, usa el interruptor de visibilidad.`
  );

  if (!accepted) {
    return;
  }

  setBusy(true);

  try {
    await callAdminCatalog(
      "delete_product",
      {
        productId
      }
    );

    closeProductDrawer(true);

    await loadCatalog({
      preserveSelection: false
    });

    toast("Producto eliminado.");
  } catch (error) {
    console.error(error);

    toast(
      `No se pudo eliminar. ${
        error.message || error
      }`,
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function toggleVisibility(
  productId,
  visible
) {
  try {
    await callAdminCatalog(
      "set_product_visibility",
      {
        productId,
        visible
      }
    );

    const product =
      state.catalog.products.find(
        (candidate) =>
          candidate.id === productId
      );

    if (product) {
      product.visible = visible;
    }

    renderProducts();

    toast(
      visible
        ? "Producto visible."
        : "Producto ocultado."
    );
  } catch (error) {
    console.error(error);

    renderProducts();

    toast(
      `No se pudo cambiar el estado. ${
        error.message || error
      }`,
      "error"
    );
  }
}

function fillCategoryForm(category) {
  state.editingCategoryId =
    category.id;

  $("#categoryId").value =
    category.id;

  $("#categoryNameEs").value =
    category.name_es || "";

  $("#categoryNameEn").value =
    category.name_en || "";

  $("#categorySortOrder").value =
    Number(category.sort_order || 0);

  $("#categoryActive").checked =
    category.active !== false;

  $("#categoryModalTitle").textContent =
    category.name_es || "Categoría";
}

function openCategoryModal(category) {
  fillCategoryForm(category);

  const modal = $("#categoryModal");

  if (modal) {
    modal.hidden = false;
  }

  document.body.classList.add(
    "modal-open"
  );

  setTimeout(() => {
    $("#categoryNameEs")?.focus();
  }, 80);
}

function closeCategoryModal() {
  const modal = $("#categoryModal");

  if (modal) {
    modal.hidden = true;
  }

  document.body.classList.remove(
    "modal-open"
  );

  state.editingCategoryId = null;
}

async function saveCategory(event) {
  event.preventDefault();

  const nameEs = String(
    $("#categoryNameEs").value || ""
  ).trim();

  const nameEn =
    String(
      $("#categoryNameEn").value || ""
    ).trim() || nameEs;

  if (!nameEs) {
    toast(
      "Escribe el nombre de la categoría.",
      "error"
    );

    return;
  }

  setBusy(true);

  try {
    await callAdminCatalog(
      "update_category",
      {
        category: {
          id: String(
            $("#categoryId").value || ""
          ).trim(),

          nameEs,
          nameEn,

          sortOrder: Number(
            $("#categorySortOrder").value ||
            0
          ),

          active:
            $("#categoryActive").checked
        }
      }
    );

    closeCategoryModal();

    await loadCatalog({
      preserveSelection: true
    });

    toast(
      "Categoría guardada correctamente."
    );
  } catch (error) {
    console.error(error);

    toast(
      `No se pudo guardar la categoría. ${
        error.message || error
      }`,
      "error"
    );
  } finally {
    setBusy(false);
  }
}

async function login(event) {
  event.preventDefault();

  const input = $("#pinInput");
  const error = $("#loginError");

  const pin = String(
    input.value || ""
  ).trim();

  error.hidden = true;

  setBusy(true);

  try {
    await callAdminCatalog(
      "list_catalog",
      {},
      pin
    );

    state.pin = pin;
    input.value = "";

    $("#loginScreen").hidden = true;
    $("#appShell").hidden = false;

    await loadCatalog({
      preserveSelection: false
    });
  } catch (loginError) {
    console.error(loginError);

    error.hidden = false;

    error.textContent =
      loginError.status === 401
        ? "PIN incorrecto."
        : `No se pudo entrar. ${
            loginError.message ||
            loginError
          }`;

    input.focus();
    input.select();
  } finally {
    setBusy(false);
  }
}

function logout() {
  state.pin = "";

  closeProductDrawer(true);
  closeCategoryModal();

  $("#appShell").hidden = true;
  $("#loginScreen").hidden = false;

  $("#pinInput").focus();
}

function init() {
  const loginForm = $("#loginForm");

  if (!loginForm) {
    console.error(
      "No se encontró #loginForm en menu-admin.html."
    );

    return;
  }

  loginForm.addEventListener(
    "submit",
    login
  );

  $("#logoutButton")?.addEventListener(
    "click",
    logout
  );

  $$("[data-view]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          switchView(
            button.dataset.view
          );
        }
      );
    }
  );

  $("#mobileMenuButton")?.addEventListener(
    "click",
    openMobileSidebar
  );

  $("#mobileSidebarBackdrop")?.addEventListener(
    "click",
    closeMobileSidebar
  );

  $("#refreshButton")?.addEventListener(
    "click",
    () => {
      loadCatalog({
        preserveSelection: true
      })
        .then(() => {
          toast("Catálogo actualizado.");
        })
        .catch((error) => {
          toast(
            `No se pudo actualizar. ${
              error.message || error
            }`,
            "error"
          );
        });
    }
  );

  $("#addProductButton")?.addEventListener(
    "click",
    () => {
      openProductDrawer(null, true);
    }
  );

  $$("[data-create-product]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          openProductDrawer(null, true);
        }
      );
    }
  );

  $("#productSearch")?.addEventListener(
    "input",
    (event) => {
      state.query = event.target.value;
      renderProducts();
    }
  );

  $("#categoryFilter")?.addEventListener(
    "change",
    (event) => {
      state.category =
        event.target.value;

      renderProducts();
    }
  );

  $("#statusFilter")?.addEventListener(
    "change",
    (event) => {
      state.status =
        event.target.value;

      renderProducts();
    }
  );

  $("#clearFiltersButton")?.addEventListener(
    "click",
    () => {
      state.query = "";
      state.category = "all";
      state.status = "all";

      $("#productSearch").value = "";
      $("#categoryFilter").value =
        "all";
      $("#statusFilter").value =
        "all";

      renderProducts();
    }
  );

  document.addEventListener(
    "click",
    (event) => {
      const productButton =
        event.target.closest(
          "[data-edit-product]"
        );

      if (productButton) {
        const product =
          state.catalog.products.find(
            (candidate) =>
              candidate.id ===
              productButton.dataset
                .editProduct
          );

        if (product) {
          openProductDrawer(
            product,
            false
          );
        }

        return;
      }

      const categoryButton =
        event.target.closest(
          "[data-edit-category]"
        );

      if (categoryButton) {
        const category =
          state.catalog.categories.find(
            (candidate) =>
              candidate.id ===
              categoryButton.dataset
                .editCategory
          );

        if (category) {
          openCategoryModal(category);
        }

        return;
      }

      if (
        event.target.closest(
          "[data-close-category-modal]"
        )
      ) {
        closeCategoryModal();
      }
    }
  );

  document.addEventListener(
    "change",
    (event) => {
      const input =
        event.target.closest(
          "[data-product-visible]"
        );

      if (input) {
        toggleVisibility(
          input.dataset.productVisible,
          input.checked
        );
      }
    }
  );

  $("#closeDrawerButton")?.addEventListener(
    "click",
    () => {
      closeProductDrawer();
    }
  );

  $("#drawerBackdrop")?.addEventListener(
    "click",
    () => {
      closeProductDrawer();
    }
  );

  $("#cancelProductButton")?.addEventListener(
    "click",
    () => {
      closeProductDrawer();
    }
  );

  $("#deleteProductButton")?.addEventListener(
    "click",
    deleteProduct
  );

  $("#productForm")?.addEventListener(
    "submit",
    saveProduct
  );

  $("#productForm")?.addEventListener(
    "input",
    () => {
      setDirty(true);

      $("#drawerTitle").textContent =
        String(
          $("#nameEs").value || ""
        ).trim() || "Nuevo producto";
    }
  );

  $("#productForm")?.addEventListener(
    "change",
    () => {
      setDirty(true);
    }
  );

  $("#imageUrl")?.addEventListener(
    "input",
    updateImagePreview
  );

  $("#categoryForm")?.addEventListener(
    "submit",
    saveCategory
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }

      const categoryModal =
        $("#categoryModal");

      const productDrawer =
        $("#productDrawer");

      if (
        categoryModal &&
        !categoryModal.hidden
      ) {
        closeCategoryModal();
        return;
      }

      if (
        productDrawer &&
        productDrawer.getAttribute(
          "aria-hidden"
        ) === "false"
      ) {
        closeProductDrawer();
        return;
      }

      closeMobileSidebar();
    }
  );

  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!state.dirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }
  );

  window.addEventListener(
    "pagehide",
    () => {
      state.pin = "";
    }
  );

  $("#pinInput")?.focus();

  updateSyncStatus();
}

init();