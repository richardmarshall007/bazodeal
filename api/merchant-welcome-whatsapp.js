/**
 * Same-origin proxy for merchant-welcome-whatsapp Edge Function (Vercel).
 * Env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or SUPABASE_*).
 */

import { applyApiCors } from "./_lib/cors.js";

const proc = typeof globalThis !== "undefined" ? globalThis.process : undefined;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    applyApiCors(req, res);
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = String(proc?.env?.VITE_SUPABASE_URL || proc?.env?.SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = proc?.env?.VITE_SUPABASE_ANON_KEY || proc?.env?.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      error: "Server missing Supabase env for function proxy.",
    });
  }

  const authHeader = req.headers.authorization;
  let body = req.body;
  if (body == null) body = {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const target = `${supabaseUrl}/functions/v1/merchant-welcome-whatsapp`;
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });

    const ct = upstream.headers.get("content-type") || "application/json";
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", ct);
    return res.send(text);
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : "Proxy could not reach Supabase Edge Functions",
    });
  }
}
