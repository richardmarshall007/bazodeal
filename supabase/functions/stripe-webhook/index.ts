// Stripe webhook: on successful Checkout, create order + line items and clear cart.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SECRET_KEYS (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { getServiceRoleKey } from "../_shared/serviceRoleKey.ts";

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = getServiceRoleKey();

  if (!stripeKey || !webhookSecret || !serviceKey) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Webhook signature verification failed: ${msg}`, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.supabase_user_id || session.client_reference_id;
  if (!userId) {
    return new Response("Missing user reference on session", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price.product"],
  });

  if (full.id) {
    const { data: existing } = await admin
      .from("orders")
      .select("id")
      .eq("stripe_checkout_session_id", full.id)
      .maybeSingle();
    if (existing?.id) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const lines = full.line_items?.data || [];
  if (lines.length === 0) {
    return new Response("No line items", { status: 400 });
  }

  const amountTotal = (full.amount_total ?? 0) / 100;
  const { data: order, error: oErr } = await admin
    .from("orders")
    .insert({
      user_id: userId,
      total: amountTotal,
      status: "processing",
      stripe_checkout_session_id: full.id,
    })
    .select("id")
    .single();

  if (oErr || !order) {
    console.error("Order insert failed:", oErr);
    return new Response(oErr?.message || "Order insert failed", { status: 500 });
  }

  const orderItems: Array<{
    order_id: string;
    deal_id: string;
    deal_title: string;
    qty: number;
    unit_price: number;
    retail_price: number;
    discount_pct: number;
  }> = [];

  for (const li of lines) {
    const qty = li.quantity ?? 1;
    const product = li.price?.product;
    const meta =
      product && typeof product !== "string" && "metadata" in product
        ? (product as Stripe.Product).metadata
        : {};
    const dealId = meta?.deal_id;
    if (!dealId) {
      console.error("Line item missing deal_id metadata", li.id);
      await admin.from("orders").delete().eq("id", order.id);
      return new Response("Line item missing deal_id", { status: 500 });
    }
    const title =
      product && typeof product !== "string" && "name" in product
        ? (product as Stripe.Product).name || "Deal"
        : li.description || "Deal";
    const unitGross = (li.amount_subtotal ?? 0) / 100 / qty;
    const retail = Number(meta.retail_price ?? 0);
    const discountPct = Number(meta.discount_pct ?? 0);

    orderItems.push({
      order_id: order.id,
      deal_id: dealId,
      deal_title: title,
      qty,
      unit_price: Math.round(unitGross * 100) / 100,
      retail_price: Number.isFinite(retail) ? retail : 0,
      discount_pct: Number.isFinite(discountPct) ? discountPct : 0,
    });
  }

  const { error: oiErr } = await admin.from("order_items").insert(orderItems);
  if (oiErr) {
    console.error("order_items insert failed:", oiErr);
    await admin.from("orders").delete().eq("id", order.id);
    return new Response(oiErr.message, { status: 500 });
  }

  await admin.from("cart_items").delete().eq("user_id", userId);

  for (const row of orderItems) {
    const { data: dealRow } = await admin.from("deals").select("stock").eq("id", row.deal_id).maybeSingle();
    const current = dealRow?.stock;
    if (typeof current === "number" && current >= row.qty) {
      await admin.from("deals").update({ stock: current - row.qty }).eq("id", row.deal_id);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
