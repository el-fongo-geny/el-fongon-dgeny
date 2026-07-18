import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gateway-device",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Error desconocido");
}

function routeFromRequest(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const marker = "/sms-gateway";
  const index = pathname.indexOf(marker);
  if (index < 0) return pathname || "/";
  const route = pathname.slice(index + marker.length);
  return route || "/";
}

function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

function secureEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function serverClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return "";
}

function smsSafeAscii(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 155)
    .trim();
}

function readyMessage(order: Record<string, unknown>): string {
  const language = order.language === "en" ? "en" : "es";
  const name = smsSafeAscii(order.customer_name || "");
  const publicId = smsSafeAscii(order.public_id || order.id || "");

  if (language === "en") {
    return smsSafeAscii(
      `Hi${name ? ` ${name}` : ""}, your order ${publicId} from El Fogon D' Geny is ready. Please pick it up at the truck window. Thank you.`,
    );
  }

  return smsSafeAscii(
    `Hola${name ? ` ${name}` : ""}, tu pedido ${publicId} de El Fogon D' Geny esta listo. Recogelo en la ventanilla. Gracias.`,
  );
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_json");
  }
  return body as Record<string, unknown>;
}

function requireGateway(request: Request): Response | null {
  const expected = String(Deno.env.get("SMS_GATEWAY_TOKEN") || "").trim();
  if (!expected) return json({ ok: false, error: "missing_sms_gateway_token_secret" }, 500);
  if (!secureEqual(bearerToken(request), expected)) {
    return json({ ok: false, error: "invalid_gateway_token" }, 401);
  }
  return null;
}

async function handleOrderReady(request: Request): Promise<Response> {
  const body = await readJson(request);
  const expectedPin = String(Deno.env.get("ADMIN_PIN") || "").trim();
  if (!expectedPin) return json({ ok: false, error: "missing_admin_pin_secret" }, 500);
  if (!secureEqual(String(body.adminPin || ""), expectedPin)) {
    return json({ ok: false, error: "invalid_admin_pin" }, 401);
  }

  const supabase = serverClient();
  const orderId = String(body.orderId || "").trim();
  const publicId = Number(body.publicId);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let query = supabase.from("orders").select("*");
  if (uuidPattern.test(orderId)) query = query.eq("id", orderId);
  else if (Number.isInteger(publicId) && publicId > 0) query = query.eq("public_id", publicId);
  else if (/^\d+$/.test(orderId)) query = query.eq("public_id", Number(orderId));
  else return json({ ok: false, error: "missing_valid_order_id" }, 400);

  const { data: order, error: orderError } = await query.maybeSingle();
  if (orderError) return json({ ok: false, error: "order_read_failed", detail: orderError.message }, 500);
  if (!order) return json({ ok: false, error: "order_not_found" }, 404);

  const readyAt = new Date().toISOString();
  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update({ status: "ready", ready_at: readyAt, updated_at: readyAt })
    .eq("id", order.id)
    .select("*")
    .single();

  if (updateError) {
    return json({ ok: false, error: "order_update_failed", detail: updateError.message }, 500);
  }

  const phone = normalizePhone(updatedOrder.customer_phone);
  const bodyText = readyMessage(updatedOrder);
  if (!phone) {
    return json({
      ok: true,
      status: "ready",
      order: { id: updatedOrder.id, publicId: updatedOrder.public_id },
      sms: { queued: false, reason: "invalid_phone" },
    });
  }

  const idempotencyKey = `order-ready:${updatedOrder.id}`;
  const queueRow = {
    order_id: String(updatedOrder.public_id || updatedOrder.id),
    phone,
    body: bodyText,
    idempotency_key: idempotencyKey,
    status: "pending",
  };

  const { data: queued, error: queueError } = await supabase
    .from("sms_queue")
    .insert(queueRow)
    .select("id,status")
    .single();

  if (queueError) {
    if (queueError.code === "23505") {
      const { data: existing, error: existingError } = await supabase
        .from("sms_queue")
        .select("id,status")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingError) {
        return json({
          ok: true,
          status: "ready",
          order: { id: updatedOrder.id, publicId: updatedOrder.public_id },
          sms: { queued: true, alreadyQueued: true, reason: "duplicate_protected" },
        });
      }

      return json({
        ok: true,
        status: "ready",
        order: { id: updatedOrder.id, publicId: updatedOrder.public_id },
        sms: {
          queued: true,
          alreadyQueued: true,
          queueId: existing?.id || null,
          queueStatus: existing?.status || null,
        },
      });
    }

    return json({
      ok: true,
      status: "ready",
      order: { id: updatedOrder.id, publicId: updatedOrder.public_id },
      sms: { queued: false, reason: "queue_insert_failed", detail: queueError.message },
    });
  }

  return json({
    ok: true,
    status: "ready",
    order: { id: updatedOrder.id, publicId: updatedOrder.public_id },
    sms: {
      queued: true,
      alreadyQueued: false,
      queueId: queued.id,
      queueStatus: queued.status,
    },
  });
}

async function handleHeartbeat(request: Request): Promise<Response> {
  const denied = requireGateway(request);
  if (denied) return denied;
  const body = await readJson(request);
  const deviceId = String(body.deviceId || request.headers.get("x-gateway-device") || "").trim();
  if (!deviceId) return json({ ok: false, error: "missing_device_id" }, 400);

  const supabase = serverClient();
  const { error } = await supabase.from("sms_gateway_devices").upsert({
    device_id: deviceId,
    manufacturer: String(body.manufacturer || "").slice(0, 120),
    model: String(body.model || "").slice(0, 120),
    android_version: String(body.androidVersion || "").slice(0, 40),
    app_version: String(body.appVersion || "").slice(0, 40),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "device_id" });

  if (error) return json({ ok: false, error: "heartbeat_failed", detail: error.message }, 500);
  return json({ ok: true });
}

async function handleClaim(request: Request): Promise<Response> {
  const denied = requireGateway(request);
  if (denied) return denied;
  const body = await readJson(request);
  const deviceId = String(body.deviceId || request.headers.get("x-gateway-device") || "").trim();
  if (!deviceId) return json({ ok: false, error: "missing_device_id" }, 400);

  const supabase = serverClient();
  await supabase.rpc("fail_stale_processing_sms");
  const { data, error } = await supabase.rpc("claim_next_sms", { p_device_id: deviceId });
  if (error) return json({ ok: false, error: "claim_failed", detail: error.message }, 500);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ ok: true, message: null });
  return json({
    ok: true,
    message: {
      id: row.id,
      orderId: row.order_id,
      phone: row.phone,
      body: row.body,
    },
  });
}

async function handleResult(request: Request): Promise<Response> {
  const denied = requireGateway(request);
  if (denied) return denied;
  const body = await readJson(request);
  const deviceId = String(body.deviceId || request.headers.get("x-gateway-device") || "").trim();
  const messageId = String(body.messageId || "").trim();
  if (!deviceId) return json({ ok: false, error: "missing_device_id" }, 400);
  if (!messageId) return json({ ok: false, error: "missing_message_id" }, 400);

  const sent = body.status === "sent";
  const now = new Date().toISOString();
  const update = sent
    ? { status: "sent", sent_at: now, error_code: null, last_error: null, updated_at: now }
    : {
        status: "error",
        sent_at: null,
        error_code: Number.isFinite(Number(body.errorCode)) ? Number(body.errorCode) : null,
        last_error: String(body.errorMessage || "Error de envío informado por Android.").slice(0, 1000),
        updated_at: now,
      };

  const supabase = serverClient();
  const { data, error } = await supabase
    .from("sms_queue")
    .update(update)
    .eq("id", messageId)
    .eq("claimed_by", deviceId)
    .select("id,status")
    .maybeSingle();

  if (error) return json({ ok: false, error: "result_update_failed", detail: error.message }, 500);
  if (!data) return json({ ok: false, error: "message_not_claimed_by_device" }, 409);
  return json({ ok: true, messageId: data.id, status: data.status });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  const route = routeFromRequest(request);
  try {
    if (request.method === "GET" && (route === "/" || route === "/health")) {
      return json({ ok: true, service: "sms-gateway", smsGateway: true, orderReady: true });
    }
    if (request.method === "POST" && route === "/api/order-ready") return await handleOrderReady(request);
    if (request.method === "POST" && route === "/api/sms-gateway/heartbeat") return await handleHeartbeat(request);
    if (request.method === "POST" && route === "/api/sms-gateway/claim") return await handleClaim(request);
    if (request.method === "POST" && route === "/api/sms-gateway/result") return await handleResult(request);
    return json({ ok: false, error: "route_not_found", route }, 404);
  } catch (error) {
    console.error("sms-gateway error:", error);
    return json({ ok: false, error: "unhandled_service_error", detail: errorText(error) }, 500);
  }
});
