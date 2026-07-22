import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizePhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return "";
}

function smsSafeAscii(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReviewUrl(value: unknown) {
  const url = String(value || "")
    .trim()
    .replace(/\s+/g, "");

  if (!url) {
    return "";
  }

  if (!/^https?:\/\//i.test(url)) {
    console.warn(
      "REVIEW_URL no comienza con http:// o https://",
    );

    return "";
  }

  return url;
}

function buildReadyMessage(
  order: Record<string, unknown>,
) {
  const language =
    order.language === "en" ? "en" : "es";

  const name = smsSafeAscii(
    order.customer_name || "",
  );

  const publicId = smsSafeAscii(
    order.public_id || order.id || "",
  );

  const reviewUrl = cleanReviewUrl(
    Deno.env.get("REVIEW_URL"),
  );

  if (language === "en") {
    return smsSafeAscii(
      `Hi${name ? ` ${name}` : ""}, your order ${publicId} from El Fogon D' Geny is ready. Pick it up at the truck window.${
        reviewUrl
          ? ` If you enjoyed the food, please leave us a positive review: ${reviewUrl}`
          : ""
      } Thank you.`,
    );
  }

  return smsSafeAscii(
    `Hola${name ? ` ${name}` : ""}, tu pedido ${publicId} de El Fogon D' Geny esta listo. Recogelo en la ventanilla.${
      reviewUrl
        ? ` Si te gusto la comida, no olvides dejarnos una resena positiva: ${reviewUrl}`
        : ""
    } Gracias.`,
  );
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(
    error || "Error desconocido",
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS_HEADERS,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: "method_not_allowed",
      },
      405,
    );
  }

  try {
    const body = await request
      .json()
      .catch(() => null);

    if (!body) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_json",
        },
        400,
      );
    }

    const expectedPin = String(
      Deno.env.get("ADMIN_PIN") || "",
    ).trim();

    if (!expectedPin) {
      console.error(
        "Falta el Secret ADMIN_PIN.",
      );

      return jsonResponse(
        {
          ok: false,
          error: "missing_admin_pin_secret",
        },
        500,
      );
    }

    if (
      String(body.adminPin || "") !==
      expectedPin
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_admin_pin",
        },
        401,
      );
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      console.error(
        "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.",
      );

      return jsonResponse(
        {
          ok: false,
          error:
            "missing_supabase_server_secrets",
        },
        500,
      );
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const orderId = String(
      body.orderId || "",
    ).trim();

    const publicId = Number(
      body.publicId,
    );

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    let orderQuery = supabase
      .from("orders")
      .select("*");

    if (uuidPattern.test(orderId)) {
      orderQuery = orderQuery.eq(
        "id",
        orderId,
      );
    } else if (
      Number.isInteger(publicId) &&
      publicId > 0
    ) {
      orderQuery = orderQuery.eq(
        "public_id",
        publicId,
      );
    } else if (
      /^\d+$/.test(orderId)
    ) {
      orderQuery = orderQuery.eq(
        "public_id",
        Number(orderId),
      );
    } else {
      return jsonResponse(
        {
          ok: false,
          error:
            "missing_valid_order_id",
        },
        400,
      );
    }

    const {
      data: order,
      error: orderError,
    } = await orderQuery.maybeSingle();

    if (orderError) {
      console.error(
        "No se pudo leer el pedido:",
        orderError,
      );

      return jsonResponse(
        {
          ok: false,
          error: "order_read_failed",
          detail: orderError.message,
        },
        500,
      );
    }

    if (!order) {
      return jsonResponse(
        {
          ok: false,
          error: "order_not_found",
        },
        404,
      );
    }

    const readyAt =
      new Date().toISOString();

    const {
      data: updatedOrder,
      error: updateError,
    } = await supabase
      .from("orders")
      .update({
        status: "ready",
        ready_at: readyAt,
        updated_at: readyAt,
      })
      .eq("id", order.id)
      .select("*")
      .single();

    if (updateError) {
      console.error(
        "No se pudo marcar el pedido listo:",
        updateError,
      );

      return jsonResponse(
        {
          ok: false,
          error:
            "order_update_failed",
          detail: updateError.message,
        },
        500,
      );
    }

    const phone = normalizePhone(
      updatedOrder.customer_phone,
    );

    const message = buildReadyMessage(
      updatedOrder,
    );

    if (!phone) {
      console.warn(
        "Pedido listo sin SMS: telefono invalido.",
        updatedOrder.id,
      );

      return jsonResponse({
        ok: true,
        status: "ready",
        order: {
          id: updatedOrder.id,
          publicId:
            updatedOrder.public_id,
        },
        sms: {
          queued: false,
          reason: "invalid_phone",
        },
      });
    }

    if (!message) {
      return jsonResponse({
        ok: true,
        status: "ready",
        order: {
          id: updatedOrder.id,
          publicId:
            updatedOrder.public_id,
        },
        sms: {
          queued: false,
          reason: "empty_message",
        },
      });
    }

    const idempotencyKey =
      `order-ready:${updatedOrder.id}`;

    const queueRow = {
      order_id: String(
        updatedOrder.public_id ||
          updatedOrder.id,
      ),
      phone,
      body: message,
      idempotency_key:
        idempotencyKey,
      status: "pending",
    };

    const {
      data: queuedSms,
      error: queueError,
    } = await supabase
      .from("sms_queue")
      .insert(queueRow)
      .select("id,status")
      .single();

    if (queueError) {
      if (
        queueError.code === "23505"
      ) {
        const {
          data: existingSms,
          error: existingError,
        } = await supabase
          .from("sms_queue")
          .select("id,status")
          .eq(
            "idempotency_key",
            idempotencyKey,
          )
          .maybeSingle();

        if (existingError) {
          console.error(
            "El SMS ya existia, pero no se pudo consultar:",
            existingError,
          );

          return jsonResponse({
            ok: true,
            status: "ready",
            order: {
              id: updatedOrder.id,
              publicId:
                updatedOrder.public_id,
            },
            sms: {
              queued: true,
              alreadyQueued: true,
              reason:
                "duplicate_protected",
            },
          });
        }

        return jsonResponse({
          ok: true,
          status: "ready",
          order: {
            id: updatedOrder.id,
            publicId:
              updatedOrder.public_id,
          },
          sms: {
            queued: true,
            alreadyQueued: true,
            queueId:
              existingSms?.id ||
              null,
            queueStatus:
              existingSms?.status ||
              null,
          },
        });
      }

      console.error(
        "Pedido listo, pero no se pudo crear sms_queue:",
        queueError,
      );

      return jsonResponse({
        ok: true,
        status: "ready",
        order: {
          id: updatedOrder.id,
          publicId:
            updatedOrder.public_id,
        },
        sms: {
          queued: false,
          reason:
            "queue_insert_failed",
          detail:
            queueError.message,
        },
      });
    }

    console.log(
      "Pedido listo y SMS en cola:",
      {
        orderId:
          updatedOrder.id,
        publicId:
          updatedOrder.public_id,
        queueId:
          queuedSms.id,
        messageLength:
          message.length,
        language:
          updatedOrder.language === "en"
            ? "en"
            : "es",
      },
    );

    return jsonResponse({
      ok: true,
      status: "ready",
      order: {
        id: updatedOrder.id,
        publicId:
          updatedOrder.public_id,
      },
      sms: {
        queued: true,
        alreadyQueued: false,
        queueId:
          queuedSms.id,
        queueStatus:
          queuedSms.status,
        messageLength:
          message.length,
      },
    });
  } catch (error) {
    console.error(
      "rapid-action error:",
      error,
    );

    return jsonResponse(
      {
        ok: false,
        error:
          "unhandled_function_error",
        detail: errorText(error),
      },
      500,
    );
  }
});
