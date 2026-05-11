/**
 * Same-origin proxy for Deal Sourcer → Supabase Edge Function.
 * Deploy on Vercel: the browser calls https://YOUR_DOMAIN/api/deal-sourcer-scan
 * and this handler forwards to https://YOUR_PROJECT.supabase.co/functions/v1/deal-sourcer-scan
 * (avoids “Failed to fetch” when clients block or fail cross-origin requests to *.supabase.co).
 *
 * Env (Vercel project): same as the app — VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY,
 * or SUPABASE_URL + SUPABASE_ANON_KEY.
 */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, apikey");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(
    /\/$/,
    "",
  );
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      error:
        "Server missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_*) on Vercel for this project.",
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

  const target = `${supabaseUrl}/functions/v1/deal-sourcer-scan`;
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
