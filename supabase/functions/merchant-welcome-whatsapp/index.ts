// Sends a one-time WhatsApp welcome after a customer joins via a merchant QR (Twilio).
// Secrets (Supabase Edge Function): TWILIO_*; service access via SUPABASE_SECRET_KEYS or legacy SUPABASE_SERVICE_ROLE_KEY.
// If Twilio is not configured, returns { ok: true, skipped: true } so signup never fails.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getServiceRoleKey } from "../_shared/serviceRoleKey.ts";
import { corsHeaders } from "../_shared/cors.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeWhatsAppE164(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const rest = s.slice(1).replace(/\D/g, "");
    if (rest.length < 10) return null;
    // Trinidad & Tobago (NANP): +1 868 xxx xxxx — never use +868… (invalid CC).
    if (rest.length === 11 && rest.startsWith("1868")) return `+${rest}`;
    if (rest.length === 10 && rest.startsWith("868")) return `+1${rest}`;
    return `+${rest}`;
  }
  const digits = s.replace(/\D/g, "");
  // 10-digit 868… is local TT format under country code 1.
  if (digits.length === 10 && digits.startsWith("868")) return `+1${digits}`;
  if (digits.length === 10) return `+1${digits}`; // fallback NA
  if (digits.length === 11 && digits.startsWith("1868")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header." }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Invalid session." }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: { merchant_id?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const merchantId = typeof body.merchant_id === "string" ? body.merchant_id.trim() : "";
  if (!merchantId || !UUID_RE.test(merchantId)) {
    return new Response(JSON.stringify({ error: "merchant_id must be a UUID." }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (merchantId === user.id) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "self" }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: prof, error: pErr } = await userClient
    .from("profiles")
    .select("phone,name")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr || !prof?.phone?.trim()) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_phone" }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const to = normalizeWhatsAppE164(prof.phone);
  if (!to) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "invalid_phone" }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const serviceKey = getServiceRoleKey();
  let storeName = "this store on Bazodeal";
  if (serviceKey) {
    const svc = createClient(supabaseUrl, serviceKey);
    const { data: m } = await svc.from("profiles").select("name").eq("id", merchantId).maybeSingle();
    if (m?.name) storeName = m.name;
  } else {
    const { data: m2 } = await userClient.from("profiles").select("name").eq("id", merchantId).maybeSingle();
    if (m2?.name) storeName = m2.name;
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM");
  if (!sid || !token || !from) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "twilio_not_configured" }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const first = (prof.name || "there").split(/\s+/)[0];
  const text =
    `Hi ${first}! Thanks for joining Bazodeal through *${storeName}*. You'll hear about their deals here. ` +
    `Reply STOP anytime to opt out of WhatsApp from this flow.`;

  const twUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = btoa(`${sid}:${token}`);
  const form = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    To: `whatsapp:${to}`,
    Body: text,
  });

  const tw = await fetch(twUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!tw.ok) {
    const errText = await tw.text();
    console.error("Twilio WhatsApp error:", tw.status, errText.slice(0, 500));
    return new Response(JSON.stringify({ ok: false, error: "Twilio rejected the message. Check FROM number and sandbox allow-list." }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, sent: true }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
