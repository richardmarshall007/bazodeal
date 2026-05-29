/** CORS for browser-facing Edge Functions — restrict to Bazodeal origins when configured. */

const DEFAULT_ORIGINS = [
  "https://www.bazodeal.com",
  "https://bazodeal.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowedOrigins(): Set<string> {
  const extra = (Deno.env.get("BAZODEAL_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = allowedOrigins();
  const allowOrigin =
    origin && allowed.has(origin) ? origin : allowed.has("https://www.bazodeal.com") ? "https://www.bazodeal.com" : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers["Vary"] = "Origin";
  }
  return headers;
}
