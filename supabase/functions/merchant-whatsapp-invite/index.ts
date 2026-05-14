// Authenticated merchant: create a short JOIN code and return a wa.me link for WhatsApp-first signup.
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEYS (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy),
//          TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getServiceRoleKey } from "../_shared/serviceRoleKey.ts";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function randomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function waMeNumber(from: string): string {
  const n = from.replace(/^whatsapp:/i, "").replace(/\s/g, "");
  return n.startsWith("+") ? n.slice(1) : n;
}

Deno.serve(async (req) => {
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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "Missing service key (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY)." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM") || "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: uData, error: uErr } = await userClient.auth.getUser();
  const uid = uData?.user?.id;
  if (uErr || !uid) {
    return new Response(JSON.stringify({ error: "Invalid session." }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: prof } = await userClient.from("profiles").select("role, can_post_deals").eq("id", uid).maybeSingle();
  const allowed = prof?.role === "admin" || prof?.can_post_deals === true;
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Posting is not enabled for your account." }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (!from) {
    return new Response(JSON.stringify({ error: "TWILIO_WHATSAPP_FROM is not set on this function." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(supabaseUrl, serviceKey);
  const { data: existing } = await svc
    .from("merchant_whatsapp_invites")
    .select("code")
    .eq("merchant_id", uid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let code = existing?.code || "";
  if (!code) {
    code = randomCode();
    for (let i = 0; i < 8; i += 1) {
      const { error } = await svc.from("merchant_whatsapp_invites").insert({ code, merchant_id: uid });
      if (!error) break;
      code = randomCode();
      if (i === 7) {
        return new Response(JSON.stringify({ error: "Could not generate invite code." }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }
  }

  const num = waMeNumber(from);
  const text = encodeURIComponent(`JOIN ${code}`);
  const waLink = `https://wa.me/${num}?text=${text}`;

  return new Response(JSON.stringify({ ok: true, code, waLink }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
