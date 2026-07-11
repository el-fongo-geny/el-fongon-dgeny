import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function env(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

function getServiceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "{}";

  try {
    const secretKeys = JSON.parse(secretKeysRaw);
    return secretKeys.default || "";
  } catch (_) {
    return "";
  }
}

function californiaTimeParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    dateText: `${get("month")}/${get("day")}/${get("year")}`
  };
}

function titleCase(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function labelFromAvailabilityKey(key: string) {
  const parts = String(key || "").split(":");

  if (parts[0] === "product") {
    return titleCase(parts[1] || key);
  }

  if (parts[0] === "option") {
    const group = titleCase(parts[1] || "opción");
    const name = titleCase(parts[2] || key);
    return `${name} (${group})`;
  }

  if (parts[0] === "extra") {
    return `${titleCase(parts[1] || key)} (Extra)`;
  }

  if (parts[0] === "remove") {
    return `${titleCase(parts[1] || key)} (Quitar ingrediente)`;
  }

  return titleCase(key);
}

function buildMissingList(rows: Array<{ product_id: string }>) {
  return rows
    .map((row) => `- ${labelFromAvailabilityKey(row.product_id)}`)
    .join("\n");
}

async function sendWhatsAppMissingReport(dateText: string, missingList: string) {
  const accessToken = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = env("WHATSAPP_GRAPH_VERSION", "v21.0");
  const templateName = env("WHATSAPP_TEMPLATE_MISSING_REPORT", "reporte_faltantes_es");
  const templateLang = env("WHATSAPP_TEMPLATE_MISSING_LANG", "es");
  const to = env("DAILY_MISSING_PHONE", "16507855425");

  if (!accessToken) throw new Error("Falta WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId) throw new Error("Falta WHATSAPP_PHONE_NUMBER_ID");

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: templateLang
        },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: dateText },
              { type: "text", text: missingList }
            ]
          }
        ]
      }
    })
  });

  const resultText = await response.text();

  if (!response.ok) {
    throw new Error(`WhatsApp error ${response.status}: ${resultText}`);
  }

  try {
    return JSON.parse(resultText);
  } catch (_) {
    return { raw: resultText };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS_HEADERS
    });
  }

  try {
    if (req.method !== "POST") {
      return Response.json(
        { ok: false, error: "Method not allowed" },
        { status: 405, headers: CORS_HEADERS }
      );
    }

    const expectedSecret = env("CRON_SECRET");
    const receivedSecret = req.headers.get("x-cron-secret") || "";

    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return Response.json(
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const body = await req.json().catch(() => ({}));
    const force = Boolean(body.force);

    const california = californiaTimeParts();

    if (!force && california.hour !== 22) {
      return Response.json(
        {
          ok: true,
          skipped: true,
          reason: "No son las 10 PM en California",
          california
        },
        { headers: CORS_HEADERS }
      );
    }

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = getServiceRoleKey();

    if (!supabaseUrl) throw new Error("Falta SUPABASE_URL");
    if (!serviceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEYS");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: rows, error: fetchError } = await supabase
      .from("product_availability")
      .select("product_id, available, missing_reported_at, updated_at")
      .eq("available", false)
      .is("missing_reported_at", null)
      .order("updated_at", { ascending: true });

    if (fetchError) throw fetchError;

    const missingRows = rows || [];

    if (!missingRows.length) {
      return Response.json(
        {
          ok: true,
          sent: false,
          message: "No hay nuevos faltantes sin reportar."
        },
        { headers: CORS_HEADERS }
      );
    }

    const missingList = buildMissingList(missingRows);

    const whatsappResult = await sendWhatsAppMissingReport(
      california.dateText,
      missingList
    );

    const productIds = missingRows.map((row) => row.product_id);
    const reportedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("product_availability")
      .update({ missing_reported_at: reportedAt })
      .in("product_id", productIds);

    if (updateError) throw updateError;

    return Response.json(
      {
        ok: true,
        sent: true,
        count: missingRows.length,
        reportedAt,
        productIds,
        whatsappResult
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
});