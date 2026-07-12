import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

type Json = Record<string, unknown>;

type OrderRow = {
  id: string;
  public_id: number;
  customer_name: string;
  customer_phone: string;
  language: string | null;
  payment_method: string | null;
  status: string | null;
  whatsapp_sent?: boolean | null;
  whatsapp_sent_at?: string | null;
  clover_synced?: boolean | null;
  clover_order_id?: string | null;
  subtotal: number | string | null;
  tax: number | string | null;
  total: number | string | null;
  items: unknown;
  created_at: string;
  updated_at?: string | null;
};

type FunctionResult = {
  ok: boolean;
  orderId?: string;
  publicId?: number;
  status?: string;
  clover: {
    skipped: boolean;
    synced: boolean;
    orderId: string | null;
    error?: string;
  };
  whatsapp: {
    skipped: boolean;
    sent: boolean;
    messageId: string | null;
    error?: string;
  };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsHeaders
  });
}

function env(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

function cents(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function money(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function cleanPhone(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function itemName(item: unknown) {
  const i = (item || {}) as Json;
  return String(i.name || i.productName || i.es || i.en || "Producto");
}

function itemQuantity(item: unknown) {
  const i = (item || {}) as Json;
  const q = Number(i.quantity || 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function itemLineTotal(item: unknown) {
  const i = (item || {}) as Json;
  const qty = itemQuantity(item);
  const direct = Number(i.lineTotal ?? i.total ?? i.price ?? i.unitPrice ?? i.basePrice ?? 0);
  const safe = Number.isFinite(direct) ? direct : 0;
  return safe * qty;
}

function itemNotes(item: unknown) {
  const i = (item || {}) as Json;
  const parts: string[] = [];

  const selections = Array.isArray(i.selections) ? i.selections : [];
  for (const selection of selections) {
    const s = (selection || {}) as Json;
    const group = String(s.group || "Opción");
    const name = String(s.name || "");
    if (name) parts.push(`${group}: ${name}`);
  }

  const extras = Array.isArray(i.extras) ? i.extras : [];
  for (const extra of extras) {
    const e = (extra || {}) as Json;
    const name = String(e.name || "");
    if (name) parts.push(`Extra: ${name}`);
  }

  const removables = Array.isArray(i.removables) ? i.removables : [];
  for (const remove of removables) {
    if (remove) parts.push(String(remove));
  }

  if (i.notes) parts.push(`Nota: ${String(i.notes)}`);
  return parts.join(" | ");
}

function getCloverBaseUrl() {
  const cloverEnv = env("CLOVER_ENV", "sandbox").toLowerCase().trim();
  if (cloverEnv === "production" || cloverEnv === "prod") return "https://api.clover.com";
  return "https://apisandbox.dev.clover.com";
}

async function cloverRequest(path: string, init: RequestInit = {}) {
  const token = env("CLOVER_ACCESS_TOKEN");
  const url = `${getCloverBaseUrl()}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`Clover ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }

  return data as Json | null;
}

async function syncCloverOrder(order: OrderRow) {
  const merchantId = env("CLOVER_MERCHANT_ID");
  const token = env("CLOVER_ACCESS_TOKEN");

  if (!merchantId || !token) {
    return { skipped: true, synced: false, orderId: null as string | null };
  }

  if (order.clover_order_id) {
    return { skipped: false, synced: true, orderId: order.clover_order_id };
  }

  const created = await cloverRequest(`/v3/merchants/${encodeURIComponent(merchantId)}/orders`, {
    method: "POST",
    body: JSON.stringify({
      note: `Pedido web #${order.public_id} - ${order.customer_name || "Cliente"}`
    })
  });

  const cloverOrderId = String(created?.id || "");
  if (!cloverOrderId) throw new Error("Clover creó una orden sin ID.");

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = itemQuantity(item);
    const lineName = `${qty}x ${itemName(item)}`;
    const note = itemNotes(item);
    const linePrice = cents(itemLineTotal(item));

    await cloverRequest(`/v3/merchants/${encodeURIComponent(merchantId)}/orders/${encodeURIComponent(cloverOrderId)}/line_items`, {
      method: "POST",
      body: JSON.stringify({
        name: note ? `${lineName} — ${note}` : lineName,
        price: linePrice
      })
    });
  }

  return { skipped: false, synced: true, orderId: cloverOrderId };
}

async function sendWhatsApp(order: OrderRow) {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");

  if (!token || !phoneNumberId) {
    return { skipped: true, sent: false, messageId: null as string | null };
  }

  if (order.whatsapp_sent) {
    return { skipped: false, sent: true, messageId: null as string | null };
  }

  const to = cleanPhone(order.customer_phone);
  if (!to) throw new Error("El pedido no tiene teléfono válido para WhatsApp.");

  const lang = (order.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
  const templateName = lang === "en"
    ? env("WHATSAPP_TEMPLATE_EN", "order_ready_en")
    : env("WHATSAPP_TEMPLATE_ES", "pedido_listo_es");
  const languageCode = lang === "en"
    ? env("WHATSAPP_LANGUAGE_EN", "en_US")
    : env("WHATSAPP_LANGUAGE_ES", "es");

  const graphVersion = env("WHATSAPP_GRAPH_VERSION", "v23.0");
  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: order.customer_name || "Cliente" },
              { type: "text", text: String(order.public_id) },
              { type: "text", text: money(order.total) }
            ]
          }
        ]
      }
    })
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`WhatsApp ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }

  const messageId = Array.isArray((data as Json)?.messages)
    ? String((((data as Json).messages as Json[])[0] || {}).id || "")
    : "";

  return { skipped: false, sent: true, messageId: messageId || null };
}

async function findOrder(supabaseAdmin: ReturnType<typeof createClient>, body: Json) {
  const table = env("ORDERS_TABLE", "orders");
  const rawOrderId = String(body.orderId || "").trim();
  const publicId = Number(body.publicId || rawOrderId);

  let query = supabaseAdmin.from(table).select("*");

  if (rawOrderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrderId)) {
    query = query.eq("id", rawOrderId);
  } else if (Number.isInteger(publicId) && publicId > 0) {
    query = query.eq("public_id", publicId);
  } else if (rawOrderId) {
    query = query.eq("id", rawOrderId);
  } else {
    throw new Error("Falta orderId o publicId.");
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Pedido no encontrado.");
  return data as OrderRow;
}

async function updateOrder(supabaseAdmin: ReturnType<typeof createClient>, order: OrderRow, result: FunctionResult) {
  const table = env("ORDERS_TABLE", "orders");
  const payload: Json = {
    status: "ready",
    ready_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    clover_synced: Boolean(result.clover.synced || order.clover_synced),
    clover_order_id: result.clover.orderId || order.clover_order_id || null,
    whatsapp_sent: Boolean(result.whatsapp.sent || order.whatsapp_sent),
    whatsapp_sent_at: result.whatsapp.sent ? new Date().toISOString() : order.whatsapp_sent_at || null
  };

  const { error } = await supabaseAdmin
    .from(table)
    .update(payload)
    .eq("id", order.id);

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Método no permitido." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({})) as Json;
    const requiredPin = env("ADMIN_PIN", "5425");
    const receivedPin = String(body.adminPin || req.headers.get("x-admin-pin") || "").trim();

    if (requiredPin && receivedPin !== requiredPin) {
      return jsonResponse({ ok: false, error: "PIN no autorizado." }, 401);
    }

    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ ok: false, error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Secrets." }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const order = await findOrder(supabaseAdmin, body);

    const result: FunctionResult = {
      ok: true,
      orderId: order.id,
      publicId: order.public_id,
      status: "ready",
      clover: { skipped: false, synced: false, orderId: null },
      whatsapp: { skipped: false, sent: false, messageId: null }
    };

    try {
      result.clover = await syncCloverOrder(order);
    } catch (error) {
      result.clover = {
        skipped: false,
        synced: false,
        orderId: order.clover_order_id || null,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    try {
      result.whatsapp = await sendWhatsApp(order);
    } catch (error) {
      result.whatsapp = {
        skipped: false,
        sent: false,
        messageId: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    await updateOrder(supabaseAdmin, order, result);

    return jsonResponse(result, 200);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
