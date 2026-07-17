/*
  supabase-client.js
  Capa de conexión directa entre GitHub Pages y Supabase.
*/
(function () {
  "use strict";

  const cfg = window.FOGON_SUPABASE || {};
  const placeholders = new Set([
    "",
    "jjfxjfkomcjgmhjzhwmc",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqZnhqZmtvbWNqZ21oanpod21jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDI4MzYsImV4cCI6MjA5OTExODgzNn0.IDw7xJrgxvvi1_u-hI8lybsw5sMNSQN1lNUreCLUvb0"
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
    counter: cfg.tables?.counter || "order_counter"
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
      orderType: row.order_type || row.raw?.orderType || (Array.isArray(row.items) && row.items[0]?.orderType) || "",
      status,
      language: row.language || row.raw?.language || "es",
      acceptedAt: row.accepted_at || (status === "accepted" ? updatedAt : null),
      readyAt: row.ready_at || (status === "ready" ? updatedAt : null),
      kitchenDone: Boolean(row.kitchen_done),
      kitchenHidden: Boolean(row.kitchen_hidden),
      whatsappSent: Boolean(row.whatsapp_sent),
      cloverSynced: Boolean(row.clover_synced),
      cloverOrderId: row.clover_order_id || null
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
    const items = (order.items || []).map((item, index) => index === 0
      ? { ...item, orderType: order.orderType || "" }
      : item);
    const payload = {
      public_id: publicId,
      customer_name: String(order.customer?.name || "").trim(),
      customer_phone: String(order.customer?.phone || "").trim(),
      language: order.language || "es",
      payment_method: order.paymentMethod || order.payment_method || "",
      status: order.status || "new",
      subtotal: moneyNumber(totals.subtotal),
      tax: moneyNumber(totals.tax),
      total: moneyNumber(totals.total),
      items
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
    deleteOrder,
    clearOrders,
    fetchAvailability,
    setAvailability,
    subscribeOrders,
    subscribeAvailability
  };
})();
