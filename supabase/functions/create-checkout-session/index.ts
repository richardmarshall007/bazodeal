// Creates a Stripe Checkout Session from the caller's Supabase cart (RLS-enforced).
// Secrets: STRIPE_SECRET_KEY, PUBLIC_SITE_URL
// Optional: STRIPE_CURRENCY (default ttd)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const finalPrice = (retail: number, discountPct: number) =>
  Math.round(retail * (1 - discountPct / 100) * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
  const currency = (Deno.env.get("STRIPE_CURRENCY") || "ttd").toLowerCase();

  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY is not set on this project." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!siteUrl) {
    return new Response(
      JSON.stringify({ error: "Set PUBLIC_SITE_URL (or SITE_URL) to your live site origin for Stripe redirects." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired session." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: rows, error: cartErr } = await supabase
    .from("cart_items")
    .select("id, qty, deal:deals(*)")
    .eq("user_id", user.id);

  if (cartErr) {
    return new Response(JSON.stringify({ error: cartErr.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const items = (rows || []).filter((r: { deal?: unknown }) => r.deal);
  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "Your cart is empty." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  for (const row of items as Array<{ qty: number; deal: Record<string, unknown> }>) {
    const d = row.deal;
    const retail = Number(d.retail_price);
    const discountPct = Number(d.discount_pct);
    const title = String(d.title || "Deal");
    const dealId = String(d.id);
    const stock = d.stock != null ? Number(d.stock) : 99;

    if (!Number.isFinite(retail) || retail <= 0 || !Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) {
      return new Response(JSON.stringify({ error: `Invalid pricing for “${title}”.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!d.approved) {
      return new Response(JSON.stringify({ error: `“${title}” is no longer available.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const expRaw = d.expires_at;
    if (expRaw) {
      const exp = new Date(String(expRaw));
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() < start.getTime()) {
        return new Response(JSON.stringify({ error: `“${title}” has expired.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (Number.isFinite(stock) && stock < row.qty) {
      return new Response(JSON.stringify({ error: `Not enough stock for “${title}”.` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const unit = finalPrice(retail, discountPct);
    const unitCents = Math.round(unit * 100);
    if (unitCents < 50) {
      return new Response(JSON.stringify({ error: `Amount too small for “${title}” (Stripe minimums).` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    line_items.push({
      quantity: row.qty,
      price_data: {
        currency,
        unit_amount: unitCents,
        product_data: {
          name: title,
          metadata: {
            deal_id: dealId,
            retail_price: retail.toFixed(2),
            discount_pct: discountPct.toFixed(2),
          },
        },
      },
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      line_items,
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
