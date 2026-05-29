/** Allowed browser origins for Vercel API route proxies (not open CORS). */

const DEFAULT_ORIGINS = [
  "https://www.bazodeal.com",
  "https://bazodeal.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowedOrigins() {
  const extra = (process.env.BAZODEAL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function applyApiCors(req, res) {
  const origin = req.headers.origin;
  const allowed = allowedOrigins();
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, apikey");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}
