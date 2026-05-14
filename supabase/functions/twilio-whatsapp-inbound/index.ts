// Twilio WhatsApp inbound: JOIN <code> → ask email → ask name → create Supabase user + merchant_follow.
// Twilio Console → WhatsApp sandbox / number → "When a message comes in" → POST this function URL
//   Add query: ?secret=YOUR_VALUE matching Supabase secret WHATSAPP_INBOUND_WEBHOOK_SECRET
// Secrets: SUPABASE_URL, SUPABASE_SECRET_KEYS (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy),
//          WHATSAPP_INBOUND_WEBHOOK_SECRET,
//          TWILIO_WHATSAPP_FROM (optional, for friendly copy only — replies use same thread)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getServiceRoleKey } from "../_shared/serviceRoleKey.ts";

function twiml(message: string) {
  const esc = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

function normalizeFrom(raw: string): string | null {
  const s = (raw || "").replace(/^whatsapp:/i, "").trim();
  if (!s.startsWith("+")) return null;
  const rest = s.slice(1).replace(/\D/g, "");
  if (rest.length < 10) return null;
  if (rest.length === 10 && rest.startsWith("868")) return `+1${rest}`;
  if (rest.length === 11 && rest.startsWith("1868")) return `+${rest}`;
  return `+${rest}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return new Response("twilio-whatsapp-inbound ok", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = Deno.env.get("WHATSAPP_INBOUND_WEBHOOK_SECRET") || "";
  const url = new URL(req.url);
  if (!secret || url.searchParams.get("secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    return twiml("Server misconfigured (missing Supabase URL or secret key — use hosted defaults or set SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY).");
  }

  const svc = createClient(supabaseUrl, serviceKey);

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return twiml("Bad request.");
  }

  const form = new URLSearchParams(bodyText);
  const fromRaw = form.get("From") || "";
  const body = (form.get("Body") || "").trim();

  const phone = normalizeFrom(fromRaw);
  if (!phone) {
    return twiml("Could not read your WhatsApp number. Try again from the same device.");
  }

  const joinMatch = body.match(/^join\s+([a-z0-9]+)\s*$/i);
  if (joinMatch) {
    const code = joinMatch[1].toLowerCase();
    const { data: inv, error: invErr } = await svc
      .from("merchant_whatsapp_invites")
      .select("merchant_id")
      .eq("code", code)
      .maybeSingle();
    if (invErr || !inv?.merchant_id) {
      return twiml("That store code is invalid or expired. Ask the merchant for a new WhatsApp signup link.");
    }
    const { data: store } = await svc.from("profiles").select("name").eq("id", inv.merchant_id).maybeSingle();
    const storeName = store?.name || "the store";

    await svc.from("whatsapp_signup_states").upsert(
      {
        phone_e164: phone,
        merchant_id: inv.merchant_id,
        step: 1,
        pending_email: null,
        pending_name: null,
        created_user_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_e164" },
    );

    return twiml(`You're signing up for ${storeName} on Bazodeal. What's your email address?`);
  }

  const { data: state, error: stErr } = await svc.from("whatsapp_signup_states").select("*").eq("phone_e164", phone).maybeSingle();
  if (stErr || !state) {
    return twiml('To start, open the link from the merchant QR and send the message that begins with "JOIN " (or type JOIN followed by your store code).');
  }

  if (state.created_user_id) {
    return twiml("You're already set up on Bazodeal. Open the site and sign in with your email (use Forgot password if you need a new password).");
  }

  if (state.step === 1) {
    const email = body.toLowerCase().trim();
    if (!EMAIL_RE.test(email)) {
      return twiml("Please send a valid email address (example: you@gmail.com).");
    }
    await svc
      .from("whatsapp_signup_states")
      .update({
        pending_email: email,
        step: 2,
        updated_at: new Date().toISOString(),
      })
      .eq("phone_e164", phone);
    return twiml("Got it. What's your full name?");
  }

  if (state.step === 2) {
    const name = body.replace(/\s+/g, " ").trim();
    if (name.length < 2) {
      return twiml("Please send your full name (at least 2 characters).");
    }
    const email = (state.pending_email || "").trim();
    const merchantId = state.merchant_id as string;
    if (!email || !merchantId) {
      return twiml("Something went wrong. Send JOIN <code> again to restart.");
    }

    const password = `${crypto.randomUUID()}Aa1!`;

    const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      }),
    });

    if (!adminRes.ok) {
      const errText = await adminRes.text();
      console.error("admin createUser:", adminRes.status, errText.slice(0, 400));
      if (adminRes.status === 422 && /already|registered|exists/i.test(errText)) {
        return twiml("That email already has a Bazodeal account. Open bazodeal.com and sign in — you can still follow this store from your account.");
      }
      return twiml("We couldn't finish signup right now. Try again in a minute or contact support.");
    }

    const created = await adminRes.json();
    const userId = created?.user?.id as string | undefined;
    if (!userId) {
      return twiml("Signup partially failed. Please try again.");
    }

    await svc.from("profiles").update({ name, phone }).eq("id", userId);

    const { error: folErr } = await svc.from("merchant_follows").insert({
      follower_id: userId,
      merchant_id: merchantId,
      source: "whatsapp",
      whatsapp_opt_in: true,
    });
    if (folErr && folErr.code !== "23505") {
      console.error("merchant_follows insert:", folErr);
    }

    await svc
      .from("whatsapp_signup_states")
      .update({
        step: 3,
        pending_name: name,
        created_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("phone_e164", phone);

    return twiml(
      `Welcome to Bazodeal, ${name.split(" ")[0]}! You're following this store. Open bazodeal.com, sign in with this email, and use Forgot password to set your password.`,
    );
  }

  return twiml("You're done! Open bazodeal.com and sign in with your email.");
});
