// Fetches an HTML page (server-side) and returns candidate promo lines (keywords: discount, deal, …)
// plus image URLs (og:image, twitter:image, <img src>) paired to rows in order. Authenticated only.
// Deploy: supabase functions deploy deal-sourcer-scan

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KEYWORD_RE =
  /\b(deal|deals|discount|discounted|offer|offers|sale|on sale|save|promo|promotion|clearance|special|%\s*off|percent\s+off|price drop)\b/i;

function stripTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

type Candidate = {
  id: string;
  title: string;
  snippet: string;
  linkUrl: string | null;
  imageUrl: string | null;
};

function resolveHref(href: string, baseOrigin: string, basePath: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith("data:") || h.startsWith("javascript:") || h.startsWith("mailto:")) return null;
  try {
    const u = new URL(h, baseOrigin + basePath);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href.split("#")[0];
  } catch {
    return null;
  }
}

/** Collect likely product/hero images (og/twitter first, then <img src>). */
function extractPageImages(html: string, baseOrigin: string, basePath: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const u = resolveHref(raw, baseOrigin, basePath);
    if (!u || seen.has(u)) return;
    const low = u.toLowerCase();
    if (low.includes("data:image")) return;
    // skip common tracking / spacer patterns
    if (/\b1x1\b|\bspacer\b|\bblank\b|\btracking\b|\bpixel\b/i.test(u)) return;
    if (!/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u) && !/\/image\//i.test(u) && !/cdn/i.test(u)) {
      // allow og URLs without extension
      if (!low.includes("og") && !low.includes("image") && !low.includes("photo") && !low.includes("media")) return;
    }
    seen.add(u);
    out.push(u);
  };

  const og =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  if (og) push(og[1]);

  const tw =
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i.exec(html);
  if (tw) push(tw[1]);

  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    push(m[1]);
    if (out.length >= 40) break;
  }

  return out.slice(0, 24);
}

function extractCandidates(html: string, baseOrigin: string, basePath: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const pushUnique = (titleRaw: string, snippetRaw: string, linkUrl: string | null) => {
    const title = norm(titleRaw).slice(0, 160);
    const snippet = norm(snippetRaw).slice(0, 520);
    if (title.length < 8 && snippet.length < 20) return;
    const blob = `${title} ${snippet}`;
    if (!KEYWORD_RE.test(blob)) return;
    const key = blob.slice(0, 96).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const displayTitle = title.length >= 8 ? title : snippet.slice(0, 160);
    out.push({
      id: crypto.randomUUID(),
      title: displayTitle,
      snippet: snippet || displayTitle,
      linkUrl,
      imageUrl: null,
    });
  };

  let m: RegExpExecArray | null;
  const hre = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  while ((m = hre.exec(html)) !== null) {
    const text = stripTags(m[1]);
    pushUnique(text, text, null);
    if (out.length >= 45) break;
  }

  const are = /<a[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = are.exec(html)) !== null) {
    const href = m[1].trim();
    if (href.startsWith("javascript:") || href.startsWith("mailto:") || href === "#") continue;
    const inner = stripTags(m[2]);
    if (inner.length < 12) continue;
    let abs: string | null = null;
    try {
      const u = new URL(href, baseOrigin + basePath);
      if (u.protocol === "http:" || u.protocol === "https:") abs = u.href.split("#")[0];
    } catch {
      abs = null;
    }
    pushUnique(inner, inner, abs);
    if (out.length >= 55) break;
  }

  const coarseBlocks = html.split(/<\/(?:p|li|div|article|section)>/i);
  for (const chunk of coarseBlocks) {
    if (out.length >= 50) break;
    const text = stripTags(chunk);
    if (text.length < 35 || text.length > 900) continue;
    if (!KEYWORD_RE.test(text)) continue;
    const line = text.slice(0, 220);
    pushUnique(line, text, null);
  }

  return out.slice(0, 36);
}

/** Best-effort: pair promo rows with page images in order (og/hero first, then document images). */
function attachImagesToCandidates(candidates: Candidate[], pageImages: string[]) {
  if (!pageImages.length) return;
  for (let i = 0; i < candidates.length; i++) {
    if (pageImages[i]) candidates[i].imageUrl = pageImages[i];
  }
}

function assertSafeUrl(raw: string): URL {
  const u = new URL(raw.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("That host is not allowed.");
  }
  if (host === "0.0.0.0" || host === "[::1]" || host === "::1") throw new Error("That host is not allowed.");

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = +ipv4[1];
    const b = +ipv4[2];
    if (a === 127 || a === 10 || a === 0) throw new Error("That host is not allowed.");
    if (a === 169 && b === 254) throw new Error("That host is not allowed.");
    if (a === 192 && b === 168) throw new Error("That host is not allowed.");
    if (a === 172 && b >= 16 && b <= 31) throw new Error("That host is not allowed.");
  }
  return u;
}

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

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) {
    return new Response(JSON.stringify({ error: "url is required." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let target: URL;
  try {
    target = assertSafeUrl(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const MAX_CHARS = 650_000;
  let html: string;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 14000);
    const res = await fetch(target.href, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": "BazodealDealSourcer/1.0 (+https://www.bazodeal.com)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(tid);
    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: `Could not load page (HTTP ${res.status}). Use a public page URL.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml") && !ct.includes("text/plain")) {
      return new Response(
        JSON.stringify({ error: "That URL did not return a readable web page." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    html = (await res.text()).slice(0, MAX_CHARS);
  } catch (e) {
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? "Request timed out." : e.message) : String(e);
    return new Response(JSON.stringify({ error: `Could not fetch URL: ${msg}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const basePath = target.pathname.replace(/\/[^/]*$/, "/");
  const pageImages = extractPageImages(html, target.origin, basePath || "/");
  const candidates = extractCandidates(html, target.origin, basePath || "/");
  attachImagesToCandidates(candidates, pageImages);
  const warning =
    candidates.length === 0
      ? "No deal-style lines found (keywords: discount, deal, offer, sale, save, promo, % off). Many social sites block imports — try your public shop or blog URL, or a page that lists promotions in text."
      : null;

  return new Response(JSON.stringify({ candidates, sourceUrl: target.href, warning }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
