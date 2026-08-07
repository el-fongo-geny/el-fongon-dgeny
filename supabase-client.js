/*
  supabase-client.js
  Capa de conexión directa entre GitHub Pages y Supabase.
*/
(function () {
  "use strict";

  const cfg = window.FOGON_SUPABASE || {};
  const placeholders = new Set([
    "",
    "PEGA_AQUI_TU_SUPABASE_API_URL",
    "PEGA_AQUI_TU_SUPABASE_ANON_PUBLIC_KEY"
  ]);

  function isReady() {
    return Boolean(
      window.supabase &&
      cfg.url &&
      cfg.anonKey &&
      !placeholders.has(cfg.url) &&
      !placeholders.has(cfg.anonKey)
    );
  }

  const client = isReady()
    ? window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

  const tables = {
    orders: cfg.tables?.orders || "orders",
    availability: cfg.tables?.availability || "product_availability",
    counter: cfg.tables?.counter || "order_counter",
    settings: cfg.tables?.settings || "menu_settings"
  };

  const functions = {
    nextOrderId: cfg.functions?.nextOrderId || "next_order_public_id"
  };

  function moneyNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  }

  function toOrder(row) {
    if (!row) return null;
    const publicId = row.public_id == null ? row.id : row.public_id;
    const status = row.status || "new";
    const updatedAt = row.updated_at || row.created_at || new Date().toISOString();
    return {
      id: String(publicId),
      databaseId: row.id,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt,
      customer: {
        name: row.customer_name || row.customer?.name || row.raw?.customer?.name || "",
        phone: row.customer_phone || row.customer?.phone || row.raw?.customer?.phone || ""
      },
      items: Array.isArray(row.items) ? row.items : (row.raw?.items || []),
      totals: {
        subtotal: moneyNumber(row.subtotal ?? row.totals?.subtotal ?? row.raw?.totals?.subtotal),
        tax: moneyNumber(row.tax ?? row.totals?.tax ?? row.raw?.totals?.tax),
        total: moneyNumber(row.total ?? row.totals?.total ?? row.raw?.totals?.total)
      },
      paymentMethod: row.payment_method || row.raw?.paymentMethod || "",
      paymentStatus: row.payment_status || row.raw?.paymentStatus || "pending",
      paymentStartedAt: row.payment_started_at || row.raw?.paymentStartedAt || null,
      paymentCompletedAt: row.payment_completed_at || row.raw?.paymentCompletedAt || null,
      paymentError: row.payment_error || row.raw?.paymentError || "",
      cloverPaymentId: row.clover_payment_id || row.raw?.cloverPaymentId || null,
      cloverExternalPaymentId: row.clover_external_payment_id || row.raw?.cloverExternalPaymentId || null,
      checkoutMode: row.checkout_mode || row.raw?.checkoutMode || "pay_at_counter",
      kioskId: row.kiosk_id || row.raw?.kioskId || "",
      kitchenVisible: row.kitchen_visible !== false,
      hiddenForAll: Boolean(row.hidden_for_all),
      hiddenAt: row.hidden_at || row.raw?.hiddenAt || null,
      status,
      language: row.language || row.raw?.language || "es",
      acceptedAt: row.accepted_at || (status === "accepted" ? updatedAt : null),
      readyAt: row.ready_at || (status === "ready" ? updatedAt : null),
      kitchenDone: Boolean(row.kitchen_done),
      kitchenHidden: Boolean(row.kitchen_hidden),
      whatsappSent: Boolean(row.whatsapp_sent),
      cloverSynced: Boolean(row.clover_synced),
      cloverOrderId: row.clover_order_id || null,
      twilioMessageSid: row.twilio_message_sid || null,
      twilioStatus: row.twilio_status || "",
      twilioErrorCode: row.twilio_error_code || null,
      twilioErrorMessage: row.twilio_error_message || null,
      twilioSentAt: row.twilio_sent_at || null,
      twilioDeliveredAt: row.twilio_delivered_at || null,
      twilioLastAttemptAt: row.twilio_last_attempt_at || null,
      twilioAttempts: Number(row.twilio_attempts || 0)
    };
  }

  async function nextPublicId() {
    if (!client) throw new Error("Supabase no está configurado.");
    const { data, error } = await client.rpc(functions.nextOrderId);
    if (error) throw error;
    const value = Number(data);
    if (!Number.isFinite(value) || value < 1) {
      throw new Error("Supabase no devolvió un número de pedido válido.");
    }
    return value;
  }

  async function createOrder(order) {
    if (!client) throw new Error("Supabase no está configurado.");
    const publicId = await nextPublicId();
    const totals = order.totals || {};
    const payload = {
      public_id: publicId,
      customer_name: String(order.customer?.name || "").trim(),
      customer_phone: String(order.customer?.phone || "").trim(),
      language: order.language || "es",
      payment_method: order.paymentMethod || order.payment_method || "",
      status: order.status || "new",
      payment_status: order.paymentStatus || "pending",
      checkout_mode: order.checkoutMode || "pay_at_counter",
      kiosk_id: order.kioskId || "",
      kitchen_visible:
        order.checkoutMode === "pay_at_counter"
          ? true
          : order.paymentStatus === "paid",
      subtotal: moneyNumber(totals.subtotal),
      tax: moneyNumber(totals.tax),
      total: moneyNumber(totals.total),
      items: order.items || []
    };

    const { data, error } = await client
      .from(tables.orders)
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;
    return toOrder(data);
  }

  async function fetchOrders() {
    if (!client) return [];
    const { data, error } = await client
      .from(tables.orders)
      .select("*")
      .eq("hidden_for_all", false)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(toOrder).filter(Boolean);
  }

  function numericOrderId(orderId) {
    const n = Number(orderId);
    return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
  }

  async function updateOrderStatus(orderId, status, extra) {
    if (!client) return null;
    const payload = { status, updated_at: new Date().toISOString() };
    if (extra?.whatsappSent != null) payload.whatsapp_sent = Boolean(extra.whatsappSent);
    if (extra?.cloverOrderId != null) payload.clover_order_id = String(extra.cloverOrderId);

    let query = client.from(tables.orders).update(payload).select("*");
    const publicId = numericOrderId(orderId);
    query = publicId ? query.eq("public_id", publicId) : query.eq("id", orderId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(toOrder).filter(Boolean)[0] || null;
  }


  async function updateKioskPayment(orderId, details = {}) {
    if (!client) throw new Error("Supabase no está configurado.");

    const payload = {
      updated_at: new Date().toISOString()
    };

    if (details.status != null) payload.status = String(details.status);
    if (details.paymentStatus != null) payload.payment_status = String(details.paymentStatus);
    if (details.paymentStartedAt != null) payload.payment_started_at = details.paymentStartedAt;
    if (details.paymentCompletedAt != null) payload.payment_completed_at = details.paymentCompletedAt;
    if (details.paymentError != null) payload.payment_error = String(details.paymentError || "");
    if (details.cloverPaymentId != null) payload.clover_payment_id = String(details.cloverPaymentId || "");
    if (details.cloverExternalPaymentId != null) payload.clover_external_payment_id = String(details.cloverExternalPaymentId || "");
    if (details.kioskId != null) payload.kiosk_id = String(details.kioskId || "");
    if (details.checkoutMode != null) payload.checkout_mode = String(details.checkoutMode || "");

    const finalPaymentStatus =
      String(details.paymentStatus || "").toLowerCase();

    if (details.checkoutMode != null || details.paymentStatus != null) {
      const finalCheckoutMode = String(
        details.checkoutMode || "pay_before_kitchen"
      ).toLowerCase();

      payload.kitchen_visible =
        finalCheckoutMode === "pay_before_kitchen"
          ? finalPaymentStatus === "paid"
          : true;
    }

    let query = client.from(tables.orders).update(payload).select("*");
    const publicId = numericOrderId(orderId);
    query = publicId ? query.eq("public_id", publicId) : query.eq("id", orderId);

    const { data, error } = await query.single();
    if (error) throw error;
    return toOrder(data);
  }

  async function deleteOrder(orderId) {
    if (!client) return;
    let query = client.from(tables.orders).delete();
    const publicId = numericOrderId(orderId);
    query = publicId ? query.eq("public_id", publicId) : query.eq("id", orderId);
    const { error } = await query;
    if (error) throw error;
  }

  async function clearOrders() {
    if (!client) return;
    const { error } = await client
      .from(tables.orders)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
  }


  async function hideOrderForAll(orderId) {
    if (!client) {
      throw new Error("Supabase no está configurado.");
    }

    const payload = {
      hidden_for_all: true,
      hidden_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    let query = client
      .from(tables.orders)
      .update(payload)
      .select("id, public_id, hidden_for_all");

    const publicId = numericOrderId(orderId);
    query = publicId
      ? query.eq("public_id", publicId)
      : query.eq("id", orderId);

    const { data, error } = await query;

    if (error) throw error;

    const updated = Array.isArray(data) ? data[0] : data;

    if (!updated || updated.hidden_for_all !== true) {
      throw new Error("Supabase no confirmó hidden_for_all=true.");
    }

    return updated;
  }

  async function fetchAvailability() {
    if (!client) return {};
    const { data, error } = await client
      .from(tables.availability)
      .select("product_id, available");
    if (error) throw error;
    const map = {};
    (data || []).forEach((row) => {
      map[row.product_id] = row.available !== false;
    });
    return map;
  }

  async function setAvailability(productId, available) {
    if (!client) return;
    const { error } = await client
      .from(tables.availability)
      .upsert({
        product_id: productId,
        available: Boolean(available),
        updated_at: new Date().toISOString()
      }, { onConflict: "product_id" });
    if (error) throw error;
  }


  async function fetchMenuSettings() {
    if (!client) return {};
    const { data, error } = await client
      .from(tables.settings)
      .select("settings")
      .eq("id", "public")
      .maybeSingle();

    if (error) throw error;
    return data?.settings || {};
  }

  function subscribeOrders(callback) {
    if (!client) return null;
    const channel = client
      .channel("fogon-orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: tables.orders }, callback)
      .subscribe();
    return channel;
  }

  function subscribeAvailability(callback) {
    if (!client) return null;
    const channel = client
      .channel("fogon-availability-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: tables.availability }, callback)
      .subscribe();
    return channel;
  }

  window.FOGON_DB = {
    isReady,
    client,
    tables,
    functions,
    toOrder,
    createOrder,
    fetchOrders,
    updateOrderStatus,
    updateKioskPayment,
    deleteOrder,
    clearOrders,
    hideOrderForAll,
    fetchAvailability,
    setAvailability,
    fetchMenuSettings,
    subscribeOrders,
    subscribeAvailability
  };
})();
