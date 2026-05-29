/**
 * Client-side guards against javascript: / data: image XSS and oversized text fields.
 * SQL injection is mitigated by Supabase PostgREST (parameterized queries) + RLS — not here.
 */

const BLOCKED_HOSTS = new Set(["javascript", "data", "vbscript"]);

/** Allow only http(s) URLs safe to use in img src, links, and stored image fields. */
export function isSafeHttpUrl(raw) {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s || s.length > 2048) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (!host || BLOCKED_HOSTS.has(host)) return false;
    if (typeof window !== "undefined" && window.location?.protocol === "https:" && u.protocol === "http:") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function sanitizeHttpUrl(raw) {
  return isSafeHttpUrl(raw) ? raw.trim() : null;
}

export function clipText(raw, maxLen) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, maxLen);
}

export function sanitizeImageUrlList(urls, max = 8) {
  if (!Array.isArray(urls)) return [];
  const out = [];
  for (const u of urls) {
    const safe = sanitizeHttpUrl(u);
    if (safe && !out.includes(safe)) out.push(safe);
    if (out.length >= max) break;
  }
  return out;
}
