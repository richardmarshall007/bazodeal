// src/App.jsx — Bazodeal (Supabase edition, final)
// npm install @supabase/supabase-js

import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { supabase } from "./lib/supabaseClient";
import bazodealLogo from "./assets/bazodeal.png";

// ── Constants ────────────────────────────────────────────────
const INTERESTS  = ["Electronics","Fashion","Home & Garden","Sports","Beauty","Travel","Food & Drink","Toys","Books","Automotive","Health","Jewellery","Outdoors","Gaming","Pets"];
const CATEGORIES = ["All","Electronics","Fashion","Home & Garden","Sports","Beauty","Travel","Food & Drink","Toys","Books","Automotive","Health","Jewellery","Outdoors","Gaming","Pets"];
const MONTHS     = [{v:"01",l:"January"},{v:"02",l:"February"},{v:"03",l:"March"},{v:"04",l:"April"},{v:"05",l:"May"},{v:"06",l:"June"},{v:"07",l:"July"},{v:"08",l:"August"},{v:"09",l:"September"},{v:"10",l:"October"},{v:"11",l:"November"},{v:"12",l:"December"}];
const YEARS      = Array.from({length:70},(_,i)=>(2006-i).toString());
const GENDERS    = ["Male","Female","Non-binary","Prefer not to say"];
const EMOJIS     = ["🛍️","📱","👗","🏠","⚽","💄","✈️","🍕","🧸","📚","🚗","💊","💍","🏕️","🎮","🐾","🎵","🍫","🏋️","🖥️"];
const TODAY      = new Date().toISOString().split("T")[0];
const MAX_DEAL_IMAGES = 8;
/** Session + URL param `?m=<uuid>`: merchant to follow after signup / login. */
const QR_MERCHANT_STORAGE = "bazodeal-join-merchant";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readInitialJoinMerchantId() {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("m");
    if (q && UUID_RE.test(q)) {
      sessionStorage.setItem(QR_MERCHANT_STORAGE, q);
      return q;
    }
  } catch {
    /* noop */
  }
  try {
    const s = sessionStorage.getItem(QR_MERCHANT_STORAGE);
    if (s && UUID_RE.test(s)) return s;
  } catch {
    /* noop */
  }
  return null;
}

/** Extra sentence for signup/login toast after merchant-welcome-whatsapp Edge Function. */
function whatsappJoinSuffix(whatsapp) {
  if (!whatsapp) return "";
  if (whatsapp === "sent") return " Check WhatsApp for a short welcome from Bazodeal.";
  if (whatsapp === "skipped_twilio") {
    return " WhatsApp is not configured on the server — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM on the merchant-welcome-whatsapp function and redeploy.";
  }
  if (whatsapp === "skipped_phone") {
    return " WhatsApp was skipped — use a valid mobile (Trinidad: +18681234567).";
  }
  if (whatsapp === "error") return " WhatsApp could not be sent — check the browser console and Twilio.";
  return "";
}

const finalPrice = d => +(+d.retail_price * (1 - +d.discount_pct / 100)).toFixed(2);
const savings    = d => +(+d.retail_price - finalPrice(d)).toFixed(2);
const fmt        = n => `TT$${Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

/** For `<input type="datetime-local" />` from ISO string */
const toDatetimeLocalValue = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Short display for event start (and optional end) in local time */
const formatEventRange = (startsAt, endsAt) => {
  const s = new Date(startsAt);
  if (Number.isNaN(s.getTime())) return "";
  const opt = { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  let out = s.toLocaleString(undefined, opt);
  if (endsAt) {
    const e = new Date(endsAt);
    if (!Number.isNaN(e.getTime())) out += ` → ${e.toLocaleString(undefined, opt)}`;
  }
  return out;
};

/** Discount % for DB from retail + deal (sale) price; null if invalid. */
const discountPctFromRetailSale = (retailStr, saleStr) => {
  const retail = parseFloat(String(retailStr ?? "").replace(/,/g, ""));
  const sale = parseFloat(String(saleStr ?? "").replace(/,/g, ""));
  if (!Number.isFinite(retail) || retail <= 0) return null;
  if (!Number.isFinite(sale) || sale <= 0) return null;
  if (sale >= retail) return null;
  const pct = (1 - sale / retail) * 100;
  if (pct <= 0 || pct >= 100) return null;
  return Math.round(pct * 100) / 100;
};

/** All image URLs in gallery order (first = listing / hero cover). */
const dealGallery = (deal) => {
  if (!deal) return [];
  let raw = deal.image_urls;
  if (raw == null) raw = [];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      raw = Array.isArray(p) ? p : [];
    } catch {
      raw = [];
    }
  }
  const fromJson = Array.isArray(raw) ? raw.filter((u) => typeof u === "string" && u.trim()) : [];
  if (fromJson.length) return [...new Set(fromJson)];
  if (deal.image_url) return [deal.image_url];
  return [];
};

const dealCoverUrl = (deal) => dealGallery(deal)[0] || null;

/** Vite env values are strings; accept common truthy spellings from hosts (e.g. Vercel). */
const envFlagTrue = (v) => {
  if (v == null || v === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
};

/** Supabase `functions.invoke` wraps network vs HTTP failures — surface useful text. */
const formatEdgeInvokeError = (error) => {
  if (!error) return "Unknown error.";
  const name = error.name || "";
  const ctx = error.context;
  const ctxMsg =
    ctx instanceof Error ? (ctx.message || String(ctx)) :
    typeof ctx === "string" ? ctx :
    typeof ctx?.message === "string" ? ctx.message : "";
  if (name === "FunctionsFetchError") {
    const detail = ctxMsg ? ` (${ctxMsg})` : "";
    return `Could not reach Supabase${detail}. Common fixes: (1) Deploy deal-sourcer-scan and redeploy the site so /api/deal-sourcer-scan (Vercel proxy) is live. (2) In Vercel → Settings → Environment Variables, add the same VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY the build uses (needed for the serverless proxy too). (3) Allow *.supabase.co in privacy tools if you rely on direct browser calls.`;
  }
  if (name === "FunctionsRelayError") {
    return `Supabase relay error${ctxMsg ? `: ${ctxMsg}` : ""}. Try again or check Edge Function logs in the dashboard.`;
  }
  if (name === "FunctionsHttpError") {
    const res = error.context;
    // Proxy path uses a plain Error with only `message` set (no Response in context).
    if (!(res instanceof Response) && typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    const st = res && typeof res.status === "number" ? res.status : null;
    return st
      ? `The Edge Function returned HTTP ${st}. If no detail line appears below, deploy deal-sourcer-scan, confirm VITE_SUPABASE_URL matches that project, and sign in again.`
      : "The Edge Function returned a non-success HTTP status. Deploy deal-sourcer-scan and sign in again if needed.";
  }
  return error.message || String(error);
};

/** Supabase puts the raw `Response` on `FunctionsHttpError.context`; read body for a useful message. */
async function functionsHttpErrorUserMessage(error) {
  if (!error || error.name !== "FunctionsHttpError") return "";
  const res = error.context;
  if (!(res instanceof Response)) return "";
  const status = res.status;
  let snippet = "";
  try {
    const text = await res.clone().text();
    if (text) {
      try {
        const j = JSON.parse(text);
        snippet =
          (typeof j.error === "string" && j.error.trim()) ||
          (typeof j.message === "string" && j.message.trim()) ||
          (typeof j.msg === "string" && j.msg.trim()) ||
          text.trim().slice(0, 280);
      } catch {
        snippet = text.trim().slice(0, 280);
      }
    }
  } catch {
    /* ignore */
  }
  const hint =
    status === 401
      ? " Try signing out and back in, or confirm this app’s Supabase URL/key is the same project as your account."
      : status === 404
        ? " Deploy: npx supabase functions deploy deal-sourcer-scan — function name must match exactly."
        : status >= 500
          ? " Check Supabase → Edge Functions → deal-sourcer-scan → Logs."
          : "";
  if (snippet) return `HTTP ${status}: ${snippet}${hint ? ` — ${hint}` : ""}`;
  return `HTTP ${status}.${hint ? ` ${hint}` : ""} (Empty response body.)`;
}
const isDealActive = (deal) => !deal.expires_at || new Date(deal.expires_at).getTime() >= new Date().setHours(0, 0, 0, 0);
/** Calendar date in user's local TZ (YYYY-MM-DD) */
const localDateKey = (iso) => {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayLocalKey = () => {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const day = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
/** Hero slideshow: today's listings first (newest first), then all live deals by recency — max FEATURE_SLIDE_COUNT */
const FEATURE_SLIDE_COUNT = 10;
function buildFeaturedSlideshow(liveDeals) {
  const tk = todayLocalKey();
  const todayFirst = [...liveDeals].filter(d => localDateKey(d.created_at) === tk)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const recentRest = [...liveDeals].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const seen = new Set();
  const out = [];
  for (const d of [...todayFirst, ...recentRest]) {
    if (!d?.id || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
    if (out.length >= FEATURE_SLIDE_COUNT) break;
  }
  return out;
}

/** Station webpage (listen in-browser on their player) — change when switching stations */
const RADIO_PAGE_URL = import.meta.env.VITE_RADIO_STATION_URL || "https://www.radio-trinidad.com/hott-93";
/** Direct HTTPS stream played inside Bazodeal — set alongside page URL when switching stations */
const RADIO_STREAM_URL =
  import.meta.env.VITE_RADIO_STREAM_URL ||
  "https://ice41.securenetsystems.net/HOTT93";
/** Start stream after the site finishes loading (`VITE_RADIO_AUTOPLAY=false` to disable). Browsers may block until user interacts. */
const RADIO_AUTOPLAY_ON_LOAD = import.meta.env.VITE_RADIO_AUTOPLAY !== "false";
const withTimeout = (promise, ms, timeoutMessage) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms)),
  ]);
/** Fit entire image inside a fixed frame (letterbox / pillarbox), pad with app background — no cropping. */
const fitPadImageFile = async (file) => {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read selected image."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Invalid image file."));
    image.src = dataUrl;
  });

  const targetW = 1200;
  const targetH = 800;
  const padRgb = "#0F0E13";

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not initialize image editor.");

  const scale = Math.min(targetW / img.width, targetH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (targetW - drawW) / 2;
  const y = (targetH - drawH) / 2;

  ctx.fillStyle = padRgb;
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, x, y, drawW, drawH);

  const toBlob = (type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  const targetMaxBytes = 400 * 1024;
  const mimeType = "image/webp";
  let quality = 0.85;
  let blob = await toBlob(mimeType, quality);

  while (blob && blob.size > targetMaxBytes && quality > 0.55) {
    quality -= 0.1;
    blob = await toBlob(mimeType, quality);
  }

  if (!blob) {
    blob = await toBlob("image/jpeg", 0.8);
  }
  if (!blob) throw new Error("Could not process image.");

  const safeName = (file.name || "deal-image").replace(/\.[^/.]+$/, "");
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${safeName}-deal.${extension}`, { type: blob.type });
};

// ── CSS ──────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito+Sans:wght@300;400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08070A;--bg2:#0F0E13;--bg3:#16141C;--card:#130F1A;
  --border:#221E2E;--border2:#2E2840;
  --primary:#FF3D00;--pri-dim:rgba(255,61,0,.12);
  --gold:#FFD000;--gold-bg:rgba(255,208,0,.12);
  --flame-yellow:#FFD000;--flame-orange:#FF3D00;--flame-amber:#FF9100;
  --green:#00E676;--green-bg:rgba(0,230,118,.08);
  --red:#FF1744;--red-bg:rgba(255,23,68,.08);
  --pink:#FF4081;
  --text:#F0EAF8;--text2:#9A8FB0;--text3:#5A5070;
  --radius:10px;--radius-lg:18px;--radius-xl:24px;
}
html,body,#root{min-height:100vh;background:var(--bg)}
body{font-family:'Nunito Sans',sans-serif;color:var(--text);overflow-x:hidden}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:linear-gradient(180deg,var(--flame-orange),var(--flame-amber));border-radius:4px;opacity:.55}

.hdr{position:sticky;top:0;z-index:200;background:rgba(8,7,10,.88);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,61,0,.35);box-shadow:0 1px 0 rgba(255,208,0,.08);min-height:48px;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 14px}
.logo{display:flex;align-items:center;cursor:pointer;user-select:none;line-height:0;flex-shrink:0}
.logo img{display:block;height:clamp(72px,11vw,128px);width:auto;max-width:min(72vw,420px);object-fit:contain}
.nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;min-width:0}
.nav-filter-select{width:auto;min-width:min(112px,28vw);max-width:min(44vw,200px);margin:0;padding:6px 28px 6px 10px;font-size:12px;font-weight:700;line-height:1.2}

.btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-family:'Nunito Sans';font-weight:700;font-size:13px;letter-spacing:.4px;transition:all .18s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn-ghost{background:transparent;color:var(--text2);border:1px solid var(--border2)}
.btn-ghost:hover{border-color:var(--flame-yellow);color:var(--flame-yellow)}
.btn-pri{background:var(--primary);color:#fff}
.btn-pri:hover{background:#ff5722;transform:translateY(-1px);box-shadow:0 6px 20px rgba(255,61,0,.35)}
.btn-gold{background:var(--gold);color:#08070A;font-weight:800}
.btn-gold:hover{background:#ffc629;transform:translateY(-1px)}
.btn-red{background:var(--red-bg);color:var(--red);border:1px solid rgba(255,23,68,.25)}
.btn-red:hover{background:var(--red);color:#fff}
.btn-green{background:var(--green-bg);color:var(--green);border:1px solid rgba(0,230,118,.25)}
.btn-sm{padding:6px 12px;font-size:12px}.btn-lg{padding:13px 28px;font-size:15px}.btn-full{width:100%}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important}

.ticker{background:linear-gradient(90deg,var(--flame-yellow),var(--flame-orange),var(--flame-amber),var(--flame-orange),var(--flame-yellow));padding:7px 0;overflow:hidden;white-space:nowrap;box-shadow:0 4px 24px rgba(255,61,0,.15)}
.ticker-inner{display:inline-block;animation:tick 35s linear infinite;font-size:12px;font-weight:700;letter-spacing:1.5px;color:#fff;text-transform:uppercase}
@keyframes tick{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

.hero{padding:28px 24px 28px;text-align:center;background:radial-gradient(ellipse 65% 45% at 50% -10%,rgba(255,208,0,.14) 0%,rgba(255,61,0,.1) 38%,transparent 72%)}
.hero h1{font-family:'Bebas Neue';font-size:clamp(52px,9vw,108px);letter-spacing:5px;line-height:.95;color:var(--text)}
.hero h1 em{background:linear-gradient(105deg,var(--flame-yellow),#fff4b0,var(--flame-orange));-webkit-background-clip:text;background-clip:text;color:transparent;font-style:normal;display:block}
.hero p{color:var(--text2);font-size:15px;margin-top:14px;max-width:420px;margin-inline:auto;line-height:1.6}
.hero-spotlight-wrap{display:flex;justify-content:center;margin:0 auto 20px;width:100%;max-width:1000px;padding:0 4px}
.hero-spotlight{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;display:flex;width:100%;align-items:stretch;text-align:left;box-shadow:0 16px 48px rgba(0,0,0,.35);transition:border .22s}
.hero-spotlight:hover{border-color:rgba(255,61,0,.35)}
.hero-spotlight-img{flex:1 1 min(520px,58%);min-width:0;background:var(--bg2);position:relative;display:flex;align-items:center;justify-content:center;align-self:auto;aspect-ratio:4/3;min-height:min(320px,50vw)}
.hero-slide-today{position:absolute;top:12px;left:12px;z-index:3;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;background:rgba(255,184,0,.2);color:var(--gold);border:1px solid rgba(255,184,0,.35);padding:5px 10px;border-radius:8px;backdrop-filter:blur(6px)}
.hero-spotlight-img img{width:100%;height:100%;object-fit:contain;object-position:center;display:block}
.hero-spotlight-body{padding:14px 16px 18px;flex:0 0 min(284px,32%);display:flex;flex-direction:column;gap:8px;border-left:1px solid var(--border);justify-content:flex-start}
.hero-spot-pricing{margin-top:4px;margin-bottom:0;padding-top:10px}
.hero-spotlight-actions{margin-top:auto;padding-top:10px}
.hero-spotlight-k{font-size:10px;font-weight:800;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:-2px}
.hero-spotlight-title{font-family:'Bebas Neue';font-size:clamp(20px,3vw,30px);letter-spacing:1.5px;line-height:1.05;color:var(--text)}
.hero-merchant{padding:10px 0 8px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.hero-merchant-lbl{font-size:10px;font-weight:800;color:var(--gold);text-transform:uppercase;letter-spacing:2px;display:block;margin-bottom:4px}
.hero-merchant-name{font-size:17px;font-weight:800;color:var(--text);line-height:1.25;letter-spacing:.3px;display:block;text-shadow:0 1px 0 rgba(0,0,0,.25)}
.hero-spotlight-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:8px}
.hero-spotlight .pricing{border-top:none;padding-top:8px;margin-top:0}
.hero-spotlight .final-price{font-size:26px;line-height:1}
.hero-spotlight .retail-price{font-size:11px}
.hero-spotlight .savings-tag{font-size:10px;line-height:1.3}
.hero-carousel{position:relative;margin:0 auto}
.hero-carousel-hoverzone:hover .hero-carousel-nav{opacity:1}
.hero-carousel-viewport{overflow:hidden;border-radius:var(--radius-xl)}
.hero-carousel-track{display:flex;width:100%;transition:transform 0.65s cubic-bezier(0.4, 0.1, 0.2, 1)}
.hero-carousel-slide{flex:0 0 100%;width:100%;min-width:0}
.hero-carousel-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:4;width:40px;height:40px;border-radius:50%;border:1px solid var(--border2);background:rgba(8,7,10,.82);color:var(--text);font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .2s;border:none;opacity:0}
.hero-carousel-nav:hover{background:rgba(255,61,0,.35);border-color:var(--primary)}
.hero-carousel-prev{left:8px}
.hero-carousel-next{right:8px}
.hero-carousel-dots{display:flex;justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap;padding:0 8px}
.hero-carousel-dot{width:9px;height:9px;border-radius:50%;border:none;padding:0;cursor:pointer;background:var(--border2);transition:transform .18s, background .18s}
.hero-carousel-dot:hover{background:var(--text3);transform:scale(1.1)}
.hero-carousel-dot.on{background:var(--primary);transform:scale(1.25)}
.hero-carousel-caption{font-size:12px;color:var(--text2);margin-top:8px;font-weight:600}
.carousel-music{border:1px solid var(--border2);border-radius:8px;padding:8px 12px;display:inline-flex;align-items:center;gap:6px;color:var(--text2);text-decoration:none;font-family:'Nunito Sans',sans-serif;font-weight:700;font-size:13px;line-height:1}
.carousel-music:hover{border-color:var(--primary);color:var(--text)}
.carousel-music.on{border-color:rgba(0,230,118,.35);color:var(--green)}
.radio-nav-wrap{display:flex;align-items:center;gap:6px;flex-shrink:0}
.radio-page-link{font-size:11px;font-weight:700;color:var(--text3);padding:6px 8px;text-decoration:none;border-radius:8px;white-space:nowrap}
.radio-page-link:hover{color:var(--gold)}
@media (max-width:640px){
  .hero-spotlight{flex-direction:column}
  .hero-spotlight-img{flex:0 0 auto;width:100%;aspect-ratio:1/1;min-height:220px;border-bottom:1px solid var(--border)}
  .hero-spotlight-body{flex:none;width:100%;max-width:none;border-left:none;padding:14px 16px}
}
.hero-stats{display:flex;justify-content:center;gap:clamp(20px,4vw,48px);margin-top:12px;margin-bottom:8px;flex-wrap:wrap}
.hero-stat{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:14px 16px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-lg);min-width:min(154px,30vw)}
.hero-stat-l{order:-1;font-size:13px;line-height:1.2;color:var(--text);font-weight:800;text-transform:uppercase;letter-spacing:2.2px;text-shadow:0 1px 0 rgba(0,0,0,.3)}
.hero-stat-n{font-family:'Bebas Neue';font-size:clamp(30px,4.8vw,44px);letter-spacing:2px;color:var(--gold);line-height:1}
.hero-stat.hero-stat-wide{min-width:min(184px,86vw)}

.pill{padding:5px 14px;border-radius:100px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-family:'Nunito Sans';font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .18s;letter-spacing:.3px}
.pill:hover{border-color:var(--flame-yellow);color:var(--flame-yellow)}.pill.active{background:linear-gradient(135deg,var(--flame-orange),#e63d00);border-color:var(--flame-orange);color:#fff;box-shadow:0 4px 16px rgba(255,61,0,.3)}

.grid{padding:10px 24px 60px;display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px;position:relative}

.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;display:flex;flex-direction:column;transition:border-color .22s, transform .28s cubic-bezier(0.34,1.45,0.64,1), box-shadow .28s ease;position:relative;z-index:1}
.grid .card:hover{border-color:rgba(255,208,0,.45);transform:translateY(-8px);box-shadow:0 20px 48px rgba(0,0,0,.55),0 0 0 1px rgba(255,61,0,.2),0 0 36px rgba(255,145,0,.12);overflow:visible;z-index:25}
.card-img{height:160px;display:flex;align-items:center;justify-content:center;font-size:68px;background:var(--bg3);position:relative;overflow:hidden}
.grid .card:hover .card-img{overflow:visible}
.card-img img{width:100%;height:100%;object-fit:contain;object-position:center;display:block;transition:transform .32s cubic-bezier(0.34,1.45,0.64,1), filter .28s ease;transform-origin:center center;will-change:transform}
.grid .card:hover .card-img img{transform:scale(1.14) translateZ(0);filter:drop-shadow(0 16px 32px rgba(0,0,0,.5))}
.card-img .emoji-fallback{font-size:68px;display:inline-block;transition:transform .32s cubic-bezier(0.34,1.45,0.64,1), filter .28s ease;transform-origin:center center}
.grid .card:hover .card-img .emoji-fallback{transform:scale(1.14) translateZ(0);filter:drop-shadow(0 16px 32px rgba(0,0,0,.45))}
.disc-badge{position:absolute;top:10px;right:10px;background:linear-gradient(145deg,var(--flame-yellow),var(--flame-orange));color:#08070A;font-family:'Bebas Neue';font-size:26px;letter-spacing:1px;padding:3px 10px 1px;border-radius:8px;line-height:1.1;text-align:center;z-index:2;box-shadow:0 4px 14px rgba(255,61,0,.35);pointer-events:none;transition:transform .32s cubic-bezier(0.34,1.45,0.64,1)}
.grid .card:hover .disc-badge{transform:scale(1.06) translateZ(0)}
.disc-badge small{display:block;font-family:'Nunito Sans';font-size:9px;font-weight:800;letter-spacing:1px;margin-top:-2px;opacity:.9}
.deal-img-logo-mark{position:absolute;bottom:8px;right:10px;width:clamp(26px,7vw,38px);height:auto;max-height:40px;object-fit:contain;pointer-events:none;z-index:2;opacity:.94;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
html[data-theme="light"] .deal-img-logo-mark{filter:drop-shadow(0 1px 2px rgba(0,0,0,.22))}
.card-body{padding:14px;flex:1;display:flex;flex-direction:column;gap:6px}
.card-cat{font-size:10px;font-weight:800;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px}
.card-title{font-size:15px;font-weight:800;color:var(--text);line-height:1.3}
.card-merch{margin-top:2px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;line-height:1.35;border-left:3px solid var(--primary);padding:6px 0 6px 10px;margin-left:0;background:rgba(255,184,0,.06);border-radius:0 8px 8px 0}
.card-merch-l{font-size:10px;font-weight:800;color:var(--gold);text-transform:uppercase;letter-spacing:2px;line-height:1}
.card-merch-n{font-size:13px;font-weight:800;color:var(--text);flex:1;min-width:0}
.card-desc{font-size:12px;color:var(--text2);line-height:1.5;margin-top:2px}
.pricing{margin-top:auto;padding-top:12px;border-top:1px solid var(--border)}
.retail-price{font-size:12px;color:var(--text3);text-decoration:line-through;font-weight:600}
.final-price{font-family:'Bebas Neue';font-size:30px;color:var(--green);letter-spacing:1px;line-height:1.05}
.savings-tag{font-size:11px;color:var(--primary);font-weight:800;margin-top:1px}
.stock-info{font-size:10px;color:var(--text3);margin-top:3px}
.card-actions{padding:10px 14px;display:flex;gap:8px;border-top:1px solid var(--border)}
.like-btn{background:transparent;border:1px solid var(--border2);border-radius:8px;padding:7px 11px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;color:var(--text2);transition:all .18s;font-family:'Nunito Sans';font-weight:700}
.like-btn:hover{border-color:var(--pink);color:var(--pink)}
.like-btn.liked{border-color:var(--pink);color:var(--pink);background:rgba(255,64,129,.1)}
.add-btn{flex:1;justify-content:center}

.overlay{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto}
.modal{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-xl);width:100%;max-width:460px;padding:32px;box-shadow:0 24px 60px rgba(0,0,0,.7);animation:up .22s ease;margin:auto}
@keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.modal-title{font-family:'Bebas Neue';font-size:34px;letter-spacing:2px;margin-bottom:6px}
.modal-sub{color:var(--text2);font-size:13px;margin-bottom:22px;line-height:1.5}

.fg{margin-bottom:14px}
.fg label{display:block;font-size:11px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px}
.inp{width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:10px 13px;color:var(--text);font-family:'Nunito Sans';font-size:14px;outline:none;transition:border .18s;-webkit-appearance:none;appearance:none}
.inp:focus{border-color:var(--primary)}.inp::placeholder{color:var(--text3)}
input[type="date"].inp{color-scheme:dark;cursor:pointer}
input[type="date"].inp::-webkit-calendar-picker-indicator{filter:invert(0.7);cursor:pointer}
select.inp{cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239A8FB0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
textarea.inp{resize:vertical;line-height:1.5}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}

.img-upload-area{border:2px dashed var(--border2);border-radius:var(--radius-lg);padding:20px;text-align:center;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;min-height:120px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px}
.img-upload-area:hover{border-color:var(--primary);background:var(--pri-dim)}
.img-upload-area.has-image{padding:0;border-style:solid;background:var(--bg3)}
.img-upload-area img{width:100%;height:160px;object-fit:contain;object-position:center;border-radius:calc(var(--radius-lg) - 2px);display:block}
.img-upload-label{font-size:12px;color:var(--text2);font-weight:700}
.img-upload-hint{font-size:11px;color:var(--text3)}
.img-change-btn{position:absolute;bottom:8px;right:8px;background:rgba(8,7,10,.85);border:1px solid var(--border2);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;color:var(--text2);cursor:pointer;font-family:'Nunito Sans';z-index:2}
.img-change-btn:hover{border-color:var(--primary);color:var(--text)}

.int-grid{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.int-pill{padding:4px 10px;border-radius:100px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;font-family:'Nunito Sans';transition:all .15s;letter-spacing:.2px}
.int-pill.on{background:var(--gold-bg);border-color:var(--gold);color:var(--gold)}

.price-preview{background:var(--pri-dim);border:1px solid rgba(255,61,0,.25);border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.price-preview strong{color:var(--green);font-size:20px;font-family:'Bebas Neue';letter-spacing:1px}

.modal-foot{display:flex;gap:8px;margin-top:20px}
.modal-switch{font-size:13px;color:var(--text2);text-align:center;margin-top:14px}
.modal-switch button{background:none;border:none;color:var(--primary);cursor:pointer;font-weight:800;font-family:'Nunito Sans';font-size:13px}
.err-box{background:var(--red-bg);border:1px solid rgba(255,23,68,.3);border-radius:8px;padding:10px 13px;font-size:13px;color:var(--red);margin-bottom:14px;font-weight:600}

.page{padding:36px 24px 60px;max-width:820px;margin:0 auto}
.page-title{font-family:'Bebas Neue';font-size:52px;letter-spacing:3px;margin-bottom:24px}
.cart-item{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:10px;transition:border .2s}
.cart-item:hover{border-color:var(--border2)}
.cart-emo{font-size:38px;min-width:48px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg3);overflow:hidden;flex-shrink:0}
.cart-emo img{width:100%;height:100%;object-fit:contain;object-position:center}
.cart-info{flex:1;min-width:0}
.cart-info h3{font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cart-info p{font-size:12px;color:var(--text2);margin-top:2px}
.qty-ctrl{display:flex;align-items:center;gap:6px}
.qty-btn{width:28px;height:28px;border-radius:6px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;font-family:'Nunito Sans';font-weight:700;transition:all .15s}
.qty-btn:hover{border-color:var(--primary);color:var(--primary)}
.qty-val{font-size:14px;font-weight:800;min-width:24px;text-align:center}
.cart-line-total{font-size:15px;font-weight:800;min-width:90px;text-align:right;color:var(--green)}
.summary-box{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-top:16px}
.sum-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:var(--text2);border-bottom:1px solid var(--border)}
.sum-row:last-of-type{border-bottom:none}
.sum-total{display:flex;justify-content:space-between;padding:14px 0 0;font-size:22px;font-weight:800}
.sum-total span:last-child{color:var(--green);font-family:'Bebas Neue';font-size:28px;letter-spacing:1px}

.empty{text-align:center;padding:80px 16px;color:var(--text2)}
.empty-emo{font-size:60px;margin-bottom:16px}
.empty h3{font-family:'Bebas Neue';font-size:36px;letter-spacing:2px;color:var(--text);margin-bottom:8px}
.empty p{font-size:14px;max-width:280px;margin:0 auto 24px}

.sourcer-hint{font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:20px;max-width:620px}
.sourcer-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;margin-bottom:10px}
.sourcer-note{font-size:11px;color:var(--text3);margin-top:16px;line-height:1.5;max-width:560px}
.sourcer-scan-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:18px}
.sourcer-url-inp{flex:1;min-width:min(100%,260px)}
.sourcer-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:12px;transition:border .18s}
.sourcer-card:hover{border-color:var(--border2)}
.sourcer-card-head{display:flex;gap:12px;align-items:flex-start}
.sourcer-cb{margin-top:3px;width:18px;height:18px;cursor:pointer;accent-color:var(--primary);flex-shrink:0}
.sourcer-card-title{font-weight:800;font-size:14px;color:var(--text);line-height:1.35}
.sourcer-card-sn{font-size:12px;color:var(--text2);margin-top:6px;line-height:1.45}
.sourcer-card-link{font-size:11px;margin-top:8px}
.sourcer-card-link a{color:var(--gold);font-weight:700}
.sourcer-thumb{width:76px;height:76px;border-radius:10px;overflow:hidden;border:1px solid var(--border2);background:var(--bg3);flex-shrink:0;align-self:flex-start}
.sourcer-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.sourcer-thumb-ph{font-size:10px;color:var(--text3);padding:8px;text-align:center;line-height:1.3}
.sourcer-draft-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
@media(max-width:520px){.sourcer-draft-grid{grid-template-columns:1fr}}
.sourcer-warn{font-size:13px;color:var(--gold);margin-bottom:14px;line-height:1.5;max-width:560px}
.sourcer-err{font-size:13px;color:var(--red);margin-bottom:14px;font-weight:600;line-height:1.45;white-space:pre-wrap;max-width:min(720px,100%)}
.home-sourcer-cta{text-align:center;margin:0 auto 22px;padding:0 16px;max-width:min(640px,94vw)}
.home-sourcer-cta .btn{margin-inline:4px}
.home-sourcer-sub{font-size:12px;color:var(--text2);margin-top:10px;line-height:1.5;max-width:36em;margin-inline:auto}
.admin-concurrent-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border2)}
.admin-concurrent-lbl{font-size:11px;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.5px}
.admin-concurrent-inp{width:72px;padding:6px 8px;font-size:13px}

.dash{padding:36px 24px 60px;max-width:960px;margin:0 auto}
.dash-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px;flex-wrap:wrap;gap:12px}
.dash-head h1{font-family:'Bebas Neue';font-size:48px;letter-spacing:3px}
.deal-form{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);padding:26px;margin-bottom:28px}
.deal-form h3{font-family:'Bebas Neue';font-size:26px;letter-spacing:1px;color:var(--gold);margin-bottom:18px}
.stats-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px}
.stat-card-n{font-family:'Bebas Neue';font-size:32px;letter-spacing:1px;color:var(--gold)}
.stat-card-l{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;margin-top:2px;font-weight:700}
.admin-list{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden}
.admin-list-title{font-family:'Bebas Neue';font-size:28px;letter-spacing:1px;margin-bottom:14px}
.admin-row{padding:14px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);transition:background .15s}
.admin-row:last-child{border-bottom:none}.admin-row:hover{background:var(--bg3)}
.admin-emo{font-size:24px;min-width:40px;width:40px;height:40px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.admin-emo img{width:100%;height:100%;object-fit:contain;object-position:center}
.admin-info{flex:1;min-width:0}
.admin-info h4{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-info p{font-size:11px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px}
.badge-live{background:var(--green-bg);color:var(--green);border:1px solid rgba(0,230,118,.2)}
.badge-pend{background:var(--gold-bg);color:var(--gold);border:1px solid rgba(255,184,0,.2)}
.badge-admin{background:rgba(255,61,0,.12);color:var(--primary);border:1px solid rgba(255,61,0,.25)}
.admin-actions{display:flex;gap:6px;flex-shrink:0}
.admin-list-members{overflow:visible}
.admin-row-members{flex-wrap:wrap;align-items:flex-start}
.admin-row-members .admin-actions{width:100%;display:flex;flex-direction:row;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;padding-top:10px;margin-top:4px;border-top:1px solid var(--border)}
.admin-members-hint{font-size:13px;color:var(--text2);line-height:1.45;margin:-8px 0 14px;max-width:720px}

.avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--primary),#ff5722);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;cursor:pointer;transition:transform .18s;flex-shrink:0}
.avatar:hover{transform:scale(1.08)}
.dropdown-wrap{position:relative}
.dropdown{position:absolute;top:42px;right:0;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:6px;min-width:200px;z-index:300;animation:up .18s ease;box-shadow:0 16px 40px rgba(0,0,0,.6)}
.dd-name{font-size:12px;font-weight:800;color:var(--text);padding:8px 12px 2px}
.dd-email{font-size:11px;color:var(--text3);padding:0 12px 8px;border-bottom:1px solid var(--border)}
.dd-item{padding:9px 12px;border-radius:8px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;color:var(--text2);transition:all .15s;font-weight:600;margin-top:2px}
.dd-item:hover{background:var(--bg3);color:var(--text)}
.dd-item.danger{color:var(--red)}.dd-item.danger:hover{background:var(--red-bg)}

.notif{position:fixed;bottom:20px;right:20px;z-index:999;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:13px 18px;font-size:13px;font-weight:700;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:up .25s ease;max-width:300px;display:flex;align-items:center;gap:8px}
.notif.success{border-color:rgba(0,230,118,.3);background:rgba(0,230,118,.05)}
.notif.error{border-color:rgba(255,23,68,.3);background:rgba(255,23,68,.05)}
.notif.info{border-color:rgba(255,208,0,.28);background:rgba(255,208,0,.07)}

.grid-deal-card{cursor:pointer;outline:none}
.grid-deal-card:focus-visible{box-shadow:0 0 0 2px var(--gold)}
.deal-detail-overlay{position:fixed;inset:0;z-index:460;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:20px 16px 32px;overflow-y:auto}
.deal-detail-panel{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-xl);width:100%;max-width:520px;margin-top:8px;box-shadow:0 24px 60px rgba(0,0,0,.75);position:relative}
.deal-detail-close{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:10px;border:1px solid var(--border2);background:var(--bg3);color:var(--text);font-size:22px;line-height:1;cursor:pointer;font-weight:700;z-index:2;display:flex;align-items:center;justify-content:center}
.deal-detail-close:hover{border-color:var(--primary);color:var(--gold)}
.deal-detail-head{padding:20px 48px 12px 18px;border-bottom:1px solid var(--border)}
.deal-detail-head h2{font-family:'Bebas Neue';font-size:28px;letter-spacing:1px;line-height:1.1;color:var(--text)}
.deal-detail-meta{font-size:12px;color:var(--text2);margin-top:8px;font-weight:700}
.deal-detail-gallery{padding:14px 16px 8px;display:flex;flex-direction:column;gap:12px;max-height:min(52vh,420px);overflow-y:auto}
.deal-detail-gallery img{width:100%;height:auto;display:block;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--bg3)}
.deal-detail-body{padding:0 18px 18px}
.deal-detail-actions{padding:14px 18px;display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid var(--border)}
.deal-img-strip{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center}
.deal-img-thumb{position:relative;width:72px;height:72px;border-radius:10px;overflow:hidden;border:1px solid var(--border2);background:var(--bg3);flex-shrink:0}
.deal-img-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.deal-img-thumb-rm{position:absolute;top:2px;right:2px;width:22px;height:22px;border-radius:6px;border:none;background:rgba(8,7,10,.85);color:var(--text);font-size:14px;line-height:1;cursor:pointer;font-weight:800}
.deal-img-add{font-size:12px;font-weight:700;color:var(--text2)}

.cart-fab{position:relative}
.cart-badge{position:absolute;top:-7px;right:-7px;background:var(--primary);color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center}
.divider{height:1px;background:var(--border);margin:20px 0}
.spin{display:inline-block;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:16px;color:var(--text2);font-size:14px}

html[data-theme="light"]{
  --bg:#ffffff;--bg2:#f7f7f9;--bg3:#ececf2;--card:#ffffff;
  --border:#e2e0ea;--border2:#d4d0de;
  --pri-dim:rgba(255,61,0,.1);
  --green-bg:rgba(0,230,118,.1);
  --red-bg:rgba(255,23,68,.08);
  --text:#14121a;--text2:#4f4b5c;--text3:#7a7588;
}
html[data-theme="light"] .hdr{background:rgba(255,255,255,.94);border-bottom-color:rgba(255,61,0,.25);box-shadow:0 1px 0 rgba(255,208,0,.2)}
html[data-theme="light"] .hero-carousel-nav{background:rgba(255,255,255,.95);color:var(--text)}
html[data-theme="light"] .hero-merchant-name{text-shadow:none}
html[data-theme="light"] .dropdown{box-shadow:0 16px 40px rgba(0,0,0,.12)}
html[data-theme="light"] .deal-detail-overlay{background:rgba(20,18,26,.45)}
html[data-theme="light"] .deal-detail-panel{box-shadow:0 24px 48px rgba(0,0,0,.12)}
html[data-theme="light"] .grid .card:hover{box-shadow:0 20px 40px rgba(0,0,0,.1),0 0 0 1px rgba(255,61,0,.12)}
html[data-theme="light"] .disc-badge{box-shadow:0 4px 12px rgba(255,61,0,.25)}
html[data-theme="light"] .img-change-btn,
html[data-theme="light"] .deal-img-thumb-rm{background:rgba(255,255,255,.92);color:var(--text)}
html[data-theme="light"] .notif{box-shadow:0 8px 28px rgba(0,0,0,.12)}
html[data-theme="light"] .notif.success{background:rgba(0,230,118,.08)}
html[data-theme="light"] .notif.error{background:rgba(255,23,68,.06)}
html[data-theme="light"] .notif.info{background:rgba(255,208,0,.1)}

.posting-gate{margin:0 0 20px;padding:14px 16px;border-radius:var(--radius-lg);border:1px solid rgba(255,184,0,.35);background:var(--gold-bg);color:var(--text);font-size:14px;line-height:1.45;font-weight:700}
.events-page{max-width:820px;margin:0 auto;padding:28px 24px 60px}
.events-page-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;margin-bottom:22px}
.events-list{display:flex;flex-direction:column;gap:14px}
.event-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;display:grid;grid-template-columns:1fr auto;gap:14px;align-items:start}
.event-card-past{opacity:.78}
.event-card-img{max-width:min(100%,280px);width:100%;border-radius:10px;border:1px solid var(--border2);display:block}
.event-when{font-size:12px;font-weight:800;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.event-title{font-family:'Bebas Neue';font-size:26px;letter-spacing:1px;line-height:1.05;color:var(--text)}
.event-venue{font-size:13px;color:var(--text2);margin-top:6px}
.event-desc{font-size:14px;color:var(--text2);margin-top:10px;line-height:1.5;white-space:pre-wrap}
.event-form{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;margin-bottom:24px}
.event-form h3{font-family:'Bebas Neue';font-size:24px;letter-spacing:1px;margin-bottom:12px}
@media(max-width:700px){.event-card{grid-template-columns:1fr}}
`;

// ── DealForm — outside main component to prevent cursor-jump remounts ────────
function DealForm({
  dealF, setDealF, imagePreviews, onImagesChange, onRemoveImage, posting, onPost, title, btnLabel, btnClass,
}) {
  const previewPct = discountPctFromRetailSale(dealF.retailPrice, dealF.salePrice);
  const showPreview = previewPct != null;
  const hasImages = imagePreviews.length > 0;

  return (
    <div className="deal-form">
      <h3>{title}</h3>

      <div className="fg">
        <label>Deal images</label>
        <p style={{ fontSize:11, color:"var(--text3)", marginBottom:8 }}>
          First image is the cover on listings; add more — shoppers see them when they open the deal and scroll.
        </p>
        {!hasImages ? (
          <div className="img-upload-area">
            <div style={{ fontSize:28 }}>🖼️</div>
            <div className="img-upload-label">Click to upload (you can pick several)</div>
            <div className="img-upload-hint">JPG, PNG or WEBP · Up to {MAX_DEAL_IMAGES} files · Max 5MB each</div>
            <input
              id="deal-img-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={onImagesChange}
              style={{ position:"absolute", inset:0, opacity:0, cursor:"pointer", width:"100%", height:"100%" }}
            />
          </div>
        ) : (
          <div>
            <div className="deal-img-strip">
              {imagePreviews.map((src, i) => (
                <div key={`${src}-${i}`} className="deal-img-thumb">
                  <img src={src} alt={`Preview ${i + 1}`} />
                  <button type="button" className="deal-img-thumb-rm" onClick={() => onRemoveImage(i)} aria-label={`Remove image ${i + 1}`}>×</button>
                </div>
              ))}
              {imagePreviews.length < MAX_DEAL_IMAGES && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf:"center" }}
                  onClick={() => document.getElementById("deal-img-input-more")?.click()}
                >
                  + Add more
                </button>
              )}
            </div>
            <input
              id="deal-img-input-more"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={onImagesChange}
              style={{ display:"none" }}
            />
            <p style={{ fontSize:11, color:"var(--text3)", marginTop:8 }}>
              Full images are letterboxed to fit. Order left-to-right: first = listing cover.
            </p>
          </div>
        )}
      </div>

      <div className="row2">
        <div className="fg">
          <label>Deal Title *</label>
          <input className="inp" placeholder="e.g. Sony WH-1000XM5" value={dealF.title}
            onChange={e => setDealF(p => ({ ...p, title: e.target.value }))} />
        </div>
        <div className="fg">
          <label>Category</label>
          <select className="inp" value={dealF.category}
            onChange={e => setDealF(p => ({ ...p, category: e.target.value }))}>
            {INTERESTS.map(i => <option key={i}>{i}</option>)}
          </select>
        </div>
      </div>

      <div className="row2">
        <div className="fg">
          <label>Retail Price (TT$) *</label>
          <input className="inp" type="number" min="0" step="0.01" placeholder="0.00" value={dealF.retailPrice}
            onChange={e => setDealF(p => ({ ...p, retailPrice: e.target.value }))} />
        </div>
        <div className="fg">
          <label>Deal price (TT$) *</label>
          <input className="inp" type="number" min="0" step="0.01" placeholder="Sale price" value={dealF.salePrice}
            onChange={e => setDealF(p => ({ ...p, salePrice: e.target.value }))} />
        </div>
      </div>

      {showPreview && (
        <div className="price-preview">
          <span>Discount:</span>
          <strong>{previewPct}%</strong>
          <span style={{ color:"var(--text3)" }}>(deal {fmt(+dealF.salePrice)} · was {fmt(+dealF.retailPrice)})</span>
          <span style={{ marginLeft:"auto", color:"var(--primary)", fontWeight:800 }}>
            Save {fmt(+dealF.retailPrice - +dealF.salePrice)}
          </span>
        </div>
      )}

      <div className="row2">
        <div className="fg">
          <label>Stock Quantity</label>
          <input className="inp" type="number" min="1" placeholder="99" value={dealF.stock}
            onChange={e => setDealF(p => ({ ...p, stock: e.target.value }))} />
        </div>
        <div className="fg">
          <label>Expiry Date</label>
          <input className="inp" type="date" min={TODAY} max="2099-12-31" value={dealF.expires}
            onChange={e => setDealF(p => ({ ...p, expires: e.target.value }))} />
        </div>
      </div>

      <div className="fg">
        <label>Emoji Icon (fallback if no image)</label>
        <div className="int-grid">
          {EMOJIS.map(e => (
            <button key={e} className={`int-pill ${dealF.emoji === e ? "on" : ""}`}
              onClick={() => setDealF(p => ({ ...p, emoji: e }))} style={{ fontSize:16 }}>{e}</button>
          ))}
        </div>
      </div>

      <div className="fg">
        <label>Description</label>
        <textarea className="inp" rows={3} placeholder="Describe the deal…" value={dealF.description}
          onChange={e => setDealF(p => ({ ...p, description: e.target.value }))} />
      </div>

      <button className={`btn ${btnClass} btn-lg`} disabled={posting} onClick={onPost}>
        {posting ? <><span className="spin">⏳</span> Uploading…</> : btnLabel}
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function Bazodeal() {
  const [view, setView]               = useState(() => {
    if (typeof window === "undefined") return "home";
    const h = window.location.hash.replace(/^#/, "");
    if (h === "deal-sourcer") return "sourcer";
    if (h === "events") return "events";
    return "home";
  });
  const [auth, setAuth]               = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile]         = useState(null);
  const [deals, setDeals]             = useState([]);
  const [events, setEvents]           = useState([]);
  const [allUsers, setAllUsers]       = useState([]);
  const [cart, setCart]               = useState([]);
  const [liked, setLiked]             = useState(new Set());
  const [filterCat, setFilterCat]     = useState("All");
  const [filterMerchantId, setFilterMerchantId] = useState("");
  const [sourcerPageUrl, setSourcerPageUrl]   = useState("");
  const [sourcerFetchBusy, setSourcerFetchBusy] = useState(false);
  const [sourcerFetchErr, setSourcerFetchErr] = useState("");
  const [sourcerFetchWarn, setSourcerFetchWarn] = useState(null);
  const [sourcerSourceUrl, setSourcerSourceUrl] = useState("");
  const [sourcerCandidates, setSourcerCandidates] = useState([]);
  const [sourcerSelected, setSourcerSelected] = useState(() => new Set());
  const [sourcerDrafts, setSourcerDrafts] = useState({});
  const [dropdown, setDropdown]       = useState(false);
  const [notif, setNotif]             = useState(null);
  const [formErr, setFormErr]         = useState("");
  const [loading, setLoading]         = useState(true);
  const [posting, setPosting]         = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [adminActionId, setAdminActionId] = useState(null);
  const [adminPostingAuthId, setAdminPostingAuthId] = useState(null);
  const [adminConcurrentLimitId, setAdminConcurrentLimitId] = useState(null);
  const [concurrentDrafts, setConcurrentDrafts] = useState({});
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("bazodeal-theme") === "dark" ? "dark" : "light";
  });
  const [imageDraftFiles, setImageDraftFiles] = useState([]);
  const [imageDraftPreviews, setImageDraftPreviews] = useState([]);
  const [dealDetail, setDealDetail] = useState(null);
  const [heroSlideIdx, setHeroSlideIdx] = useState(0);
  const [heroCarouselPaused, setHeroCarouselPaused] = useState(false);
  const [radioStreamPlaying, setRadioStreamPlaying] = useState(false);
  const radioAudioRef = useRef(null);
  const [loginF, setLoginF] = useState({ email:"", password:"" });
  const [regF,   setRegF]   = useState({ email:"", password:"", name:"", phone:"", dobMonth:"", dobYear:"", gender:"", interests:[], whatsappOptIn: true });
  const [dealF,  setDealF]  = useState({ title:"", category:"Electronics", retailPrice:"", salePrice:"", emoji:"🛍️", description:"", stock:"", expires:"" });
  const [eventF, setEventF] = useState({ title:"", description:"", venue:"", starts_at:"", ends_at:"", image_url:"" });
  const [eventImageFile, setEventImageFile] = useState(null);
  const [eventImagePreview, setEventImagePreview] = useState("");
  const [qrInviteMerchantId, setQrInviteMerchantId] = useState(() => readInitialJoinMerchantId());
  const [qrInviteMerchantName, setQrInviteMerchantName] = useState("");
  const [followedMerchants, setFollowedMerchants] = useState([]);
  const [merchantJoinQrDataUrl, setMerchantJoinQrDataUrl] = useState("");
  const [waInviteLink, setWaInviteLink] = useState("");
  const [waInviteQrDataUrl, setWaInviteQrDataUrl] = useState("");
  const [waInviteBusy, setWaInviteBusy] = useState(false);
  /** True while merchant-whatsapp-invite is in flight (including silent auto-fetch). */
  const [waInviteFetchPending, setWaInviteFetchPending] = useState(false);
  const qrRegisterAutoOpened = useRef(false);

  // ── Helpers ──────────────────────────────────────────────
  const pop = (msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const toggleRadioStream = async () => {
    const a = radioAudioRef.current;
    if (!a || !RADIO_STREAM_URL) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    try {
      a.volume = 0.42;
      await a.play();
    } catch {
      pop(
        "Radio could not start in this browser. Use “Page” to listen on the station site.",
        "error"
      );
    }
  };

  const resetDealForm = () => {
    setDealF({ title:"", category:"Electronics", retailPrice:"", salePrice:"", emoji:"🛍️", description:"", stock:"", expires:"" });
    imageDraftPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
    setImageDraftFiles([]);
    setImageDraftPreviews([]);
  };

  // ── Data Fetchers ────────────────────────────────────────
  const fetchDeals = useCallback(async () => {
    try {
      const { data, error } = await withTimeout(
        supabase.from("deals").select("*").order("created_at", { ascending: false }),
        12000,
        "Loading deals timed out. Check your network and Supabase status."
      );
      if (error) {
        console.error("Fetch deals error:", error);
        pop(`Could not load deals: ${error.message}`, "error");
        return;
      }
      setDeals(data || []);
    } catch (err) {
      pop(err.message || "Could not load deals.", "error");
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const { data, error } = await withTimeout(
        supabase.from("events").select("*").order("starts_at", { ascending: true }),
        12000,
        "Loading events timed out."
      );
      if (error) {
        console.error("Fetch events error:", error);
        setEvents([]);
        return;
      }
      setEvents(data || []);
    } catch (err) {
      console.error(err);
      setEvents([]);
    }
  }, []);

  const fetchProfile = useCallback(async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data);
    return data;
  }, []);

  const ensureProfile = useCallback(async (user, fallback = {}) => {
    if (!user?.id) return null;
    const baseName =
      fallback.name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "Bazodeal User";

    const payload = {
      id: user.id,
      name: baseName,
      phone: fallback.phone || null,
      dob_month: fallback.dobMonth || null,
      dob_year: fallback.dobYear || null,
      gender: fallback.gender || null,
      interests: fallback.interests || [],
      role: "user",
    };

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) {
      console.error("Ensure profile error:", error);
      return null;
    }
    return fetchProfile(user.id);
  }, [fetchProfile]);

  const fetchCart = useCallback(async (uid) => {
    const { data } = await supabase
      .from("cart_items")
      .select("*, deal:deals(*)")
      .eq("user_id", uid);
    setCart(data || []);
  }, []);

  const fetchLikes = useCallback(async (uid) => {
    const { data } = await supabase.from("likes").select("deal_id").eq("user_id", uid);
    setLiked(new Set((data || []).map(l => l.deal_id)));
  }, []);

  const fetchMerchantFollows = useCallback(async (uid) => {
    const { data, error } = await supabase.from("merchant_follows").select("merchant_id").eq("follower_id", uid);
    if (error) {
      console.warn("merchant_follows:", error.message);
      setFollowedMerchants([]);
      return;
    }
    setFollowedMerchants((data || []).map((r) => r.merchant_id));
  }, []);

  // Uses profiles_with_email view to include email in admin panel
  const fetchAllUsers = useCallback(async () => {
    const { data } = await supabase
      .from("profiles_with_email")
      .select("*")
      .order("created_at", { ascending: false });
    setAllUsers(data || []);
  }, []);

  const canPostDeals = useMemo(
    () => Boolean(profile?.role === "admin" || profile?.can_post_deals === true),
    [profile],
  );

  const setUserCanPost = useCallback(
    async (userId, nextValue) => {
      setAdminPostingAuthId(userId);
      const { error } = await supabase.from("profiles").update({ can_post_deals: nextValue }).eq("id", userId);
      setAdminPostingAuthId(null);
      if (error) {
        pop("Could not update posting permission: " + error.message, "error");
        return;
      }
      await fetchAllUsers();
      if (currentUser?.id === userId) {
        await fetchProfile(userId);
      }
      pop(nextValue ? "This member can post deals." : "Posting permission revoked.", "success");
    },
    [fetchAllUsers, fetchProfile, currentUser?.id, pop],
  );

  const setUserConcurrentLimit = useCallback(
    async (userId) => {
      const u = allUsers.find((x) => x.id === userId);
      const raw =
        concurrentDrafts[userId] !== undefined
          ? concurrentDrafts[userId]
          : String(Math.max(1, parseInt(String(u?.concurrent_deals_limit ?? 1), 10) || 1));
      const parsed = parseInt(String(raw).trim(), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        pop("Enter a whole number from 1 to 99 for concurrent deals.", "error");
        return;
      }
      const limit = Math.min(99, parsed);
      const prev = Math.max(1, parseInt(String(u?.concurrent_deals_limit ?? 1), 10) || 1);
      if (limit === prev) {
        setConcurrentDrafts((d) => {
          const next = { ...d };
          delete next[userId];
          return next;
        });
        pop("No change to save.", "info");
        return;
      }
      setAdminConcurrentLimitId(userId);
      const { error } = await supabase.from("profiles").update({ concurrent_deals_limit: limit }).eq("id", userId);
      setAdminConcurrentLimitId(null);
      if (error) {
        pop("Could not update concurrent deals limit: " + error.message, "error");
        return;
      }
      setConcurrentDrafts((d) => {
        const next = { ...d };
        delete next[userId];
        return next;
      });
      await fetchAllUsers();
      if (currentUser?.id === userId) await fetchProfile(userId);
      pop(`Max concurrent live deals set to ${limit}.`, "success");
    },
    [allUsers, concurrentDrafts, fetchAllUsers, fetchProfile, currentUser?.id, pop],
  );

  const clearJoinMerchantTracking = useCallback(() => {
    setQrInviteMerchantId(null);
    setQrInviteMerchantName("");
    try {
      sessionStorage.removeItem(QR_MERCHANT_STORAGE);
    } catch { /* noop */ }
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("m")) {
        u.searchParams.delete("m");
        window.history.replaceState(null, "", u.pathname + u.search + (u.hash || ""));
      }
    } catch { /* noop */ }
  }, []);

  const tryInvokeMerchantWhatsapp = async (merchantId, accessTokenOverride) => {
    if (!merchantId) return null;
    try {
      let token = typeof accessTokenOverride === "string" && accessTokenOverride.trim()
        ? accessTokenOverride.trim()
        : null;
      if (!token) {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token || null;
      }
      if (!token) return null;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const body = { merchant_id: merchantId };
      let { data, error } = await supabase.functions.invoke("merchant-welcome-whatsapp", {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
      });
      const proxyEnabled = envFlagTrue(import.meta.env.VITE_MERCHANT_WHATSAPP_PROXY ?? "true");
      const fetchLikelyFailed =
        error?.name === "FunctionsFetchError" ||
        (error?.context instanceof Error && /failed\s+to\s+fetch/i.test(error.context.message));
      if (error && proxyEnabled && typeof window !== "undefined" && fetchLikelyFailed) {
        const proxied = await fetch(`${window.location.origin}/api/merchant-welcome-whatsapp`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(anonKey ? { apikey: anonKey } : {}),
          },
          body: JSON.stringify(body),
        });
        const text = await proxied.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = { error: text?.slice(0, 200) };
        }
        data = parsed;
        error = proxied.ok ? null : new Error(typeof parsed?.error === "string" ? parsed.error : "WhatsApp send failed");
      }
      if (error) {
        console.warn("merchant-welcome-whatsapp:", error.message || error);
        return "error";
      }
      if (data?.sent) return "sent";
      if (data?.skipped && data?.reason) {
        const r = data.reason;
        if (r === "twilio_not_configured") return "skipped_twilio";
        if (r === "no_phone" || r === "invalid_phone") return "skipped_phone";
        if (r === "self") return "skipped_self";
        return "skipped_other";
      }
      return null;
    } catch (e) {
      console.warn("merchant-welcome-whatsapp", e);
      return "error";
    }
  };

  const completeMerchantJoin = async (userId, { whatsappOptIn, accessToken } = {}) => {
    let stored = null;
    try {
      stored = sessionStorage.getItem(QR_MERCHANT_STORAGE);
    } catch { /* noop */ }
    const fromState = qrInviteMerchantId;
    const mid =
      (fromState && UUID_RE.test(fromState) ? fromState : null) ||
      (stored && UUID_RE.test(stored) ? stored : null);
    if (!mid || !UUID_RE.test(mid) || mid === userId) {
      clearJoinMerchantTracking();
      return null;
    }
    const { data: mp, error: pe } = await supabase.from("profiles").select("id,name").eq("id", mid).maybeSingle();
    if (pe || !mp?.id) {
      clearJoinMerchantTracking();
      pop("That store signup link is not valid anymore.", "error");
      return null;
    }
    const row = {
      follower_id: userId,
      merchant_id: mid,
      source: "qr",
      whatsapp_opt_in: Boolean(whatsappOptIn),
    };
    const { error: insErr } = await supabase.from("merchant_follows").insert(row);
    const alreadyFollowing = insErr?.code === "23505";
    if (insErr && !alreadyFollowing) {
      console.error(insErr);
      pop(insErr.message || "Could not save store follow.", "error");
      clearJoinMerchantTracking();
      return null;
    }
    await fetchMerchantFollows(userId);
    let whatsappStatus = null;
    if (!alreadyFollowing && Boolean(whatsappOptIn)) {
      whatsappStatus = await tryInvokeMerchantWhatsapp(mid, accessToken);
    }
    const storeName = mp.name || "this store";
    clearJoinMerchantTracking();
    qrRegisterAutoOpened.current = false;
    return { storeName, whatsapp: whatsappStatus };
  };

  useEffect(() => {
    if (!qrInviteMerchantId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset store label when invite cleared
      setQrInviteMerchantName("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("profiles").select("name").eq("id", qrInviteMerchantId).maybeSingle();
      if (!cancelled) setQrInviteMerchantName(data?.name || "This store");
    })();
    return () => {
      cancelled = true;
    };
  }, [qrInviteMerchantId]);

  useEffect(() => {
    if (loading || currentUser || !qrInviteMerchantId) return;
    if (qrRegisterAutoOpened.current) return;
    qrRegisterAutoOpened.current = true;
    setAuth("register");
  }, [loading, currentUser, qrInviteMerchantId]);

  // ── Bootstrap ────────────────────────────────────────────
  useEffect(() => {
    const hydrateUser = async (user) => {
      setCurrentUser(user);
      let profileResult = await withTimeout(
        fetchProfile(user.id),
        8000,
        "Loading profile timed out."
      ).catch(() => null);

      if (!profileResult) {
        profileResult = await withTimeout(
          ensureProfile(user),
          8000,
          "Creating profile timed out."
        ).catch(() => null);
      }

      Promise.allSettled([
        withTimeout(fetchCart(user.id), 8000, "Loading cart timed out."),
        withTimeout(fetchLikes(user.id), 8000, "Loading likes timed out."),
        withTimeout(fetchMerchantFollows(user.id), 8000, "Loading follows timed out."),
        profileResult?.role === "admin"
          ? withTimeout(fetchAllUsers(), 8000, "Loading members timed out.")
          : Promise.resolve(),
      ]);
    };

    withTimeout(
      supabase.auth.getSession(),
      8000,
      "Supabase session request timed out."
    ).then(async ({ data: { session }, error }) => {
      if (error) {
        console.error("Session error:", error);
        pop(`Supabase auth error: ${error.message}`, "error");
      } else if (session?.user) {
        await hydrateUser(session.user);
      }
      setLoading(false);
    }).catch(err => {
      console.error("Supabase error:", err);
      pop(`Supabase connection error: ${err.message || "Unknown error"}`, "error");
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          hydrateUser(session.user);
        } else {
          setCurrentUser(null); setProfile(null); setCart([]); setLiked(new Set()); setFollowedMerchants([]);
        }
      }
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    fetchDeals();
    fetchEvents();

    return () => { subscription.unsubscribe(); };
  }, [fetchDeals, fetchEvents, fetchProfile, fetchCart, fetchLikes, fetchMerchantFollows, fetchAllUsers, ensureProfile]);

  // Strip Chromium "scroll to text fragment" links (#:~:text=...) — they look broken in the bar and jump the page.
  const stripTextFragmentHash = useCallback(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hash;
    if (h && h.includes(":~:text")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useLayoutEffect(() => {
    stripTextFragmentHash();
  }, [stripTextFragmentHash]);

  // Deep link for production: www.bazodeal.com/#deal-sourcer
  useEffect(() => {
    const onHash = () => {
      stripTextFragmentHash();
      const raw = window.location.hash.replace(/^#/, "");
      if (raw === "deal-sourcer") setView("sourcer");
      else if (raw === "events") setView("events");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [stripTextFragmentHash]);

  useEffect(() => {
    if (view !== "sourcer" && window.location.hash === "#deal-sourcer") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (view !== "events" && window.location.hash === "#events") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [view]);

  // Deal Sourcer is account-only — pull-from-URL postings use your merchant identity.
  useEffect(() => {
    if (loading) return;
    if (view !== "sourcer" || currentUser) return;
    const t = window.setTimeout(() => {
      setView("home");
      if (window.location.hash === "#deal-sourcer") {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      setAuth("login");
      pop("Sign in to use Deal Sourcer — import promotions from your website or page into your Bazodeal listings.", "info");
    }, 0);
    return () => window.clearTimeout(t);
  }, [loading, view, currentUser]);

  useEffect(() => {
    if (!dealDetail) return;
    const onKey = (e) => {
      if (e.key === "Escape") setDealDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dealDetail]);

  // Stripe return URLs: ?checkout=success | ?checkout=cancel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("checkout");
    if (!c) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url.pathname + (url.search || ""));
    const t = window.setTimeout(() => {
      if (c === "success") {
        pop("Payment received! Your order is confirmed.");
        void supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user) void fetchCart(session.user.id);
        });
        void fetchDeals();
      } else if (c === "cancel") {
        pop("Checkout was cancelled.", "error");
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [fetchCart, fetchDeals]);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("bazodeal-theme", theme);
    } catch { /* noop */ }
  }, [theme]);

  // ── Image Handling ───────────────────────────────────────
  const handleDealImagesChange = (e) => {
    const incoming = [...(e.target.files || [])];
    e.target.value = "";
    if (incoming.length === 0) return;
    const nextFiles = [...imageDraftFiles];
    for (const file of incoming) {
      if (nextFiles.length >= MAX_DEAL_IMAGES) {
        pop(`You can attach at most ${MAX_DEAL_IMAGES} images.`, "error");
        break;
      }
      if (file.size > 5 * 1024 * 1024) {
        pop(`${file.name || "A file"} is over 5MB — skipped.`, "error");
        continue;
      }
      nextFiles.push(file);
    }
    if (nextFiles.length === imageDraftFiles.length) return;
    imageDraftPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
    setImageDraftFiles(nextFiles);
    setImageDraftPreviews(nextFiles.map((f) => URL.createObjectURL(f)));
  };

  const removeDealImageAt = (index) => {
    const u = imageDraftPreviews[index];
    if (u) try { URL.revokeObjectURL(u); } catch { /* noop */ }
    setImageDraftFiles((f) => f.filter((_, i) => i !== index));
    setImageDraftPreviews((p) => p.filter((_, i) => i !== index));
  };

  const handleEventImageChange = (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      pop("Image must be 5MB or smaller.", "error");
      return;
    }
    setEventImagePreview((prev) => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* noop */ }
      return URL.createObjectURL(file);
    });
    setEventImageFile(file);
  };

  const removeEventImage = () => {
    setEventImagePreview((prev) => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* noop */ }
      return "";
    });
    setEventImageFile(null);
  };

  const uploadDealImagesToStorage = async (files) => {
    if (!files.length || !currentUser) return [];
    const urls = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      let processedImageFile;
      try {
        processedImageFile = await fitPadImageFile(file);
      } catch (err) {
        pop(err.message || "Could not process image.", "error");
        return [];
      }
      const ext = processedImageFile.name.split(".").pop();
      const fileName = `${currentUser.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      try {
        const uploadResult = await withTimeout(
          supabase.storage.from("deal-images").upload(fileName, processedImageFile, { upsert: true }),
          15000,
          "Image upload timed out. Check Storage bucket policies and try again."
        );
        if (uploadResult.error) {
          pop("Image upload failed: " + uploadResult.error.message, "error");
          return [];
        }
        const { data: { publicUrl } } = supabase.storage.from("deal-images").getPublicUrl(fileName);
        urls.push(publicUrl);
      } catch (err) {
        pop(err.message || "Image upload failed unexpectedly.", "error");
        return [];
      }
    }
    return urls;
  };

  /** Insert one deal row; retries with fewer image columns when the schema is older. */
  const persistDealInsert = async (payload) => {
    let attempt = { ...payload };
    let error;
    let strippedImage = false;
    for (let pass = 0; pass < 3; pass += 1) {
      const res = await supabase.from("deals").insert(attempt);
      error = res.error ?? null;
      if (!error) return { error: null, strippedImage };
      const msg = (error.message || "").toLowerCase();
      if (pass === 0 && msg.includes("image_urls")) {
        delete attempt.image_urls;
        strippedImage = true;
        continue;
      }
      if (pass === 1 && msg.includes("image_url")) {
        delete attempt.image_url;
        strippedImage = true;
        continue;
      }
      break;
    }
    return { error, strippedImage };
  };

  // ── Auth ─────────────────────────────────────────────────
  const doLogin = async () => {
    setFormErr(""); setPosting(true);
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email: loginF.email, password: loginF.password });
    setPosting(false);
    if (error) { setFormErr(error.message); return; }
    setAuth(null);
    setLoginF({ email:"", password:"" });
    const uid = authData?.user?.id;
    let welcome = "Welcome back! 🔥";
    if (uid) {
      const join = await completeMerchantJoin(uid, {
        whatsappOptIn: true,
        accessToken: authData?.session?.access_token,
      });
      if (join?.storeName) {
        welcome = `Welcome back! You're now following ${join.storeName}.${whatsappJoinSuffix(join.whatsapp)}`;
      }
    }
    pop(welcome);
  };

  const doRegister = async () => {
    setFormErr(""); setPosting(true);
    const { email, password, name, phone, dobMonth, dobYear, gender, interests, whatsappOptIn } = regF;
    if (!name || !email || !password) {
      setFormErr("Full name, email and password are required.");
      setPosting(false); return;
    }
    if (qrInviteMerchantId && whatsappOptIn && !phone?.trim()) {
      setFormErr("Add your mobile number (with country code if outside Trinidad) so we can send WhatsApp updates from this store.");
      setPosting(false);
      return;
    }
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (error) {
      const alreadyRegistered =
        error.message?.toLowerCase().includes("already registered") ||
        error.message?.toLowerCase().includes("already been registered");

      if (alreadyRegistered) {
        const loginAttempt = await supabase.auth.signInWithPassword({ email, password });
        if (!loginAttempt.error && loginAttempt.data?.user) {
          await ensureProfile(loginAttempt.data.user, { name, phone, dobMonth, dobYear, gender, interests });
          const uid = loginAttempt.data.user.id;
          const followed = await completeMerchantJoin(uid, {
            whatsappOptIn,
            accessToken: loginAttempt.data.session?.access_token,
          });
          setPosting(false);
          setAuth(null);
          setRegF({ email:"", password:"", name:"", phone:"", dobMonth:"", dobYear:"", gender:"", interests:[], whatsappOptIn: true });
          pop(
            followed?.storeName
              ? `Welcome back! You're now following ${followed.storeName}.${whatsappJoinSuffix(followed.whatsapp)}`
              : "Welcome back! Account already existed, so we signed you in.",
          );
          return;
        }
        setFormErr("This email is already registered. Please sign in or reset your password.");
        setPosting(false);
        return;
      }

      setFormErr(error.message);
      setPosting(false);
      return;
    }
    let followedName = null;
    if (data.user) {
      const ensured = await ensureProfile(data.user, { name, phone, dobMonth, dobYear, gender, interests });
      const profileError = !ensured ? { message: "Could not create profile row." } : null;
      if (profileError) {
        console.error("Profile upsert error:", profileError);
        setFormErr("Profile creation failed: " + profileError.message);
        setPosting(false);
        return;
      }
      followedName = await completeMerchantJoin(data.user.id, {
        whatsappOptIn,
        accessToken: data.session?.access_token,
      });
    }
    setPosting(false);
    setAuth(null);
    setRegF({ email:"", password:"", name:"", phone:"", dobMonth:"", dobYear:"", gender:"", interests:[], whatsappOptIn: true });
    pop(
      followedName?.storeName
        ? `You're in! You're following ${followedName.storeName}.${whatsappJoinSuffix(followedName.whatsapp)}`
        : "You're in! Welcome to Bazodeal 🎉",
    );
  };

  const doLogout = async () => {
    await supabase.auth.signOut();
    setDropdown(false); setView("home");
    qrRegisterAutoOpened.current = false;
    pop("Logged out. See you next time!");
  };

  // ── Deals ────────────────────────────────────────────────
  const toggleLike = async (dealId) => {
    if (!currentUser) { setAuth("login"); return; }
    const isLiked = liked.has(dealId);
    setLiked(prev => { const n = new Set(prev); isLiked ? n.delete(dealId) : n.add(dealId); return n; });
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, like_count: d.like_count + (isLiked ? -1 : 1) } : d));
    if (isLiked) {
      await supabase.from("likes").delete().eq("user_id", currentUser.id).eq("deal_id", dealId);
    } else {
      await supabase.from("likes").insert({ user_id: currentUser.id, deal_id: dealId });
    }
  };

  const addToCart = async (deal) => {
    if (!currentUser) { setAuth("login"); return; }
    const existing = cart.find(i => i.deal_id === deal.id);
    if (existing) {
      await supabase.from("cart_items").update({ qty: existing.qty + 1 }).eq("id", existing.id);
    } else {
      await supabase.from("cart_items").insert({ user_id: currentUser.id, deal_id: deal.id, qty: 1 });
    }
    await fetchCart(currentUser.id);
    pop("Added to cart! 🛒");
  };

  const updateQty = async (itemId, delta) => {
    const item = cart.find(i => i.id === itemId);
    if (!item || item.qty + delta < 1) return;
    await supabase.from("cart_items").update({ qty: item.qty + delta }).eq("id", itemId);
    await fetchCart(currentUser.id);
  };

  const removeFromCart = async (itemId) => {
    await supabase.from("cart_items").delete().eq("id", itemId);
    await fetchCart(currentUser.id);
  };

  const postDeal = async () => {
    const { title, retailPrice, salePrice, description, stock, expires, emoji, category } = dealF;
    const computedPct = discountPctFromRetailSale(retailPrice, salePrice);
    if (!title || !retailPrice || !salePrice) { pop("Title, retail price, and deal price are required.", "error"); return; }
    if (computedPct == null) {
      pop("Deal price must be greater than zero and less than the retail price.", "error");
      return;
    }
    if (!canPostDeals) {
      pop("Your account is not approved to post deals yet. An admin must enable posting for your account first.", "error");
      return;
    }
    
    // Concurrency limit: non-admin merchants can only have up to `profiles.concurrent_deals_limit`
    // active deals at a time (active = approved + not expired).
    if (profile?.role !== "admin") {
      const todayKey = todayLocalKey();
      const limit = Math.max(1, parseInt(profile?.concurrent_deals_limit ?? 1, 10) || 1);
      const { data: activeDeals, error: activeErr } = await supabase
        .from("deals")
        .select("id")
        .eq("merchant_id", currentUser.id)
        .eq("approved", true)
        .or(`expires_at.is.null,expires_at.gte.${todayKey}`);

      if (activeErr) {
        pop("Could not verify active deals right now. Try again.", "error");
        return;
      }

      const activeCount = activeDeals?.length || 0;
      if (activeCount >= limit) {
        pop("You already have an active deal. Please wait until it expires to post another.", "error");
        return;
      }
    }

    setPosting(true);
    const imageWasSelected = imageDraftFiles.length > 0;
    const uploadedUrls = imageWasSelected ? await uploadDealImagesToStorage(imageDraftFiles) : [];
    if (imageWasSelected && uploadedUrls.length !== imageDraftFiles.length) {
      setPosting(false);
      pop("Image upload failed, so the deal was not posted. Fix upload settings and try again.", "error");
      return;
    }
    const image_url = uploadedUrls[0] || null;
    const image_urls = uploadedUrls.length > 0 ? uploadedUrls : null;
    const payload = {
      title,
      merchant_id:   currentUser.id,
      merchant_name: profile?.name || "Merchant",
      category, emoji,
      retail_price:  parseFloat(retailPrice),
      discount_pct:  computedPct,
      description,
      stock:      parseInt(stock) || 99,
      expires_at: expires || null,
      approved:   true,
      image_url,
      image_urls,
    };

    const { error, strippedImage } = await persistDealInsert(payload);

    setPosting(false);
    if (error) {
      pop("Failed to post: " + error.message, "error");
      return;
    }
    if (strippedImage) {
      pop("Deal posted without images. Add image_url and image_urls columns in Supabase (see bazodeal_schema.sql).", "error");
    }
    await fetchDeals();
    resetDealForm();
    pop("Deal is live! ✅");
  };

  const resetEventForm = () => {
    setEventImagePreview((prev) => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* noop */ }
      return "";
    });
    setEventImageFile(null);
    setEventF({ title: "", description: "", venue: "", starts_at: "", ends_at: "", image_url: "" });
  };

  const postEvent = async () => {
    if (!currentUser) {
      setAuth("login");
      return;
    }
    const { title, description, venue, starts_at, ends_at, image_url } = eventF;
    if (!title?.trim()) {
      pop("Event title is required.", "error");
      return;
    }
    if (!starts_at) {
      pop("Start date and time are required.", "error");
      return;
    }
    if (!canPostDeals) {
      pop("Your account is not approved to post deals yet. An admin must enable posting for your account first.", "error");
      return;
    }
    setPosting(true);
    let finalImageUrl = image_url?.trim() || null;
    if (eventImageFile) {
      const uploaded = await uploadDealImagesToStorage([eventImageFile]);
      if (uploaded.length === 0) {
        setPosting(false);
        return;
      }
      finalImageUrl = uploaded[0];
    }
    const startsIso = new Date(starts_at).toISOString();
    const endsIso = ends_at ? new Date(ends_at).toISOString() : null;
    const { error } = await supabase.from("events").insert({
      title: title.trim(),
      description: description?.trim() || null,
      venue: venue?.trim() || null,
      starts_at: startsIso,
      ends_at: endsIso,
      image_url: finalImageUrl,
      organizer_id: currentUser.id,
      organizer_name: profile?.name || "Host",
      approved: true,
    });
    setPosting(false);
    if (error) {
      pop("Failed to create event: " + error.message, "error");
      return;
    }
    await fetchEvents();
    resetEventForm();
    pop("Event created! ✅");
  };

  const deleteEvent = async (ev) => {
    if (!currentUser || !ev?.id) return;
    if (ev.organizer_id !== currentUser.id && profile?.role !== "admin") {
      pop("You can only delete your own events.", "error");
      return;
    }
    if (!window.confirm("Delete this event?")) return;
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) {
      pop("Could not delete: " + error.message, "error");
      return;
    }
    await fetchEvents();
    pop("Event removed.");
  };

  const toggleSourcerRow = (c, willSelect) => {
    if (willSelect) {
      setSourcerSelected((p) => new Set(p).add(c.id));
      setSourcerDrafts((d) => ({
        ...d,
        [c.id]: d[c.id] || {
          title: c.title,
          retailPrice: "",
          salePrice: "",
          category: INTERESTS[0],
        },
      }));
    } else {
      setSourcerSelected((p) => {
        const n = new Set(p);
        n.delete(c.id);
        return n;
      });
      setSourcerDrafts((d) => {
        const next = { ...d };
        delete next[c.id];
        return next;
      });
    }
  };

  const patchSourcerDraft = (id, patch) => {
    setSourcerDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  };

  const scanSourcerUrl = async () => {
    if (!currentUser) { setAuth("login"); return; }
    const raw = sourcerPageUrl.trim();
    if (!raw) { pop("Paste the URL of your website or promotions page.", "error"); return; }
    setSourcerFetchBusy(true);
    setSourcerFetchErr("");
    setSourcerFetchWarn(null);
    setSourcerCandidates([]);
    setSourcerSelected(new Set());
    setSourcerDrafts({});
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        pop("Please sign in again.", "error");
        return;
      }
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const token = session.access_token;
      const payload = { url: raw };
      let data;
      let error;
      const invokeDirect = async () =>
        supabase.functions.invoke("deal-sourcer-scan", {
          body: payload,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(anonKey ? { apikey: anonKey } : {}),
          },
        });

      ({ data, error } = await invokeDirect());

      const proxyEnabled = envFlagTrue(import.meta.env.VITE_DEAL_SOURCER_PROXY ?? "true");
      const fetchLikelyFailed =
        error?.name === "FunctionsFetchError" ||
        (error?.context instanceof Error && /failed\s+to\s+fetch/i.test(error.context.message));

      if (error && proxyEnabled && typeof window !== "undefined" && fetchLikelyFailed) {
        try {
          const proxied = await fetch(`${window.location.origin}/api/deal-sourcer-scan`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              ...(anonKey ? { apikey: anonKey } : {}),
            },
            body: JSON.stringify(payload),
          });
          const text = await proxied.text();
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = { error: text ? text.slice(0, 320) : "Invalid response from /api/deal-sourcer-scan" };
          }
          data = parsed;
          if (proxied.ok) {
            error = null;
          } else {
            const reason =
              parsed && typeof parsed.error === "string"
                ? parsed.error
                : `Proxy returned HTTP ${proxied.status}. Is deal-sourcer-scan deployed?`;
            error = Object.assign(new Error(reason), { name: "FunctionsHttpError" });
          }
        } catch {
          /* keep original error below */
        }
      }

      if (error) {
        let msg = formatEdgeInvokeError(error);
        if (error.name === "FunctionsHttpError") {
          const detail = await functionsHttpErrorUserMessage(error);
          if (detail) msg = `Deal Sourcer — ${detail}`;
        }
        setSourcerFetchErr(msg);
        pop(msg.length > 140 ? "Deal Sourcer could not reach Supabase — see the red message below." : msg, "error");
        return;
      }
      if (data?.error) {
        setSourcerFetchErr(typeof data.error === "string" ? data.error : "Scan failed.");
        return;
      }
      const list = Array.isArray(data?.candidates) ? data.candidates : [];
      setSourcerCandidates(list);
      setSourcerSourceUrl(typeof data?.sourceUrl === "string" ? data.sourceUrl : raw);
      if (data?.warning) setSourcerFetchWarn(data.warning);
      if (list.length) pop(`Found ${list.length} candidate lines — tick the ones to post under your account.`);
    } catch (e) {
      pop(e?.message || "Scan failed.", "error");
    } finally {
      setSourcerFetchBusy(false);
    }
  };

  const postSelectedSourcerDeals = async () => {
    if (!currentUser || !profile) { setAuth("login"); return; }
    if (!canPostDeals) {
      pop("Your account is not approved to post deals yet. An admin must enable posting first.", "error");
      return;
    }
    const ids = [...sourcerSelected];
    if (ids.length === 0) { pop("Select at least one line to post.", "error"); return; }

    for (const id of ids) {
      const dr = sourcerDrafts[id];
      const c = sourcerCandidates.find((x) => x.id === id);
      if (!c || !dr?.title?.trim() || dr.retailPrice === "" || dr.salePrice === "") {
        pop("Each selected row needs a title, retail price, and deal price.", "error");
        return;
      }
      const rp = parseFloat(dr.retailPrice);
      const pct = discountPctFromRetailSale(dr.retailPrice, dr.salePrice);
      if (!Number.isFinite(rp) || rp <= 0 || pct == null) {
        pop("Each row needs a valid retail price and a deal price below retail.", "error");
        return;
      }
    }

    if (profile.role !== "admin") {
      const todayKey = todayLocalKey();
      const limit = Math.max(1, parseInt(profile?.concurrent_deals_limit ?? 1, 10) || 1);
      const { data: activeDeals, error: activeErr } = await supabase
        .from("deals")
        .select("id")
        .eq("merchant_id", currentUser.id)
        .eq("approved", true)
        .or(`expires_at.is.null,expires_at.gte.${todayKey}`);
      if (activeErr) {
        pop("Could not verify active deals. Try again.", "error");
        return;
      }
      const activeCount = activeDeals?.length || 0;
      const room = limit - activeCount;
      if (ids.length > room) {
        pop(
          room <= 0
            ? `You already have the maximum active deals (${limit}) for your account. Wait for one to expire or upgrade your limit.`
            : `Select at most ${room} row(s): your plan allows ${limit} active deal(s), and ${activeCount} are already live.`,
          "error",
        );
        return;
      }
    }

    setPosting(true);
    let posted = 0;
    let strippedAny = false;
    for (const id of ids) {
      const dr = sourcerDrafts[id];
      const c = sourcerCandidates.find((x) => x.id === id);
      const pulledImg = typeof c.imageUrl === "string" && c.imageUrl.trim() ? c.imageUrl.trim() : null;
      const pieces = [
        dr.title.trim(),
        c.snippet && c.snippet !== dr.title.trim() ? String(c.snippet) : null,
        c.linkUrl ? `Link: ${c.linkUrl}` : null,
        pulledImg ? `Image (from page): ${pulledImg}` : null,
        sourcerSourceUrl ? `Imported from: ${sourcerSourceUrl}` : null,
      ].filter(Boolean);
      const payload = {
        title: dr.title.trim().slice(0, 200),
        merchant_id: currentUser.id,
        merchant_name: profile?.name || "Merchant",
        category: dr.category || INTERESTS[0],
        emoji: "🛍️",
        retail_price: parseFloat(dr.retailPrice),
        discount_pct: discountPctFromRetailSale(dr.retailPrice, dr.salePrice),
        description: pieces.join("\n\n"),
        stock: 99,
        expires_at: null,
        approved: true,
        image_url: pulledImg,
        image_urls: pulledImg ? [pulledImg] : null,
      };
      const { error, strippedImage } = await persistDealInsert(payload);
      if (strippedImage) strippedAny = true;
      if (error) {
        pop(`Posting stopped: ${error.message}`, "error");
        setPosting(false);
        return;
      }
      posted += 1;
    }
    setPosting(false);
    if (strippedAny) {
      pop("Some deals posted without image columns — add image_url / image_urls in Supabase (see schema).", "error");
    }
    await fetchDeals();
    setSourcerSelected(new Set());
    setSourcerDrafts({});
    pop(posted === 1 ? "1 deal is now live under your account." : `${posted} deals are now live under your account.`);
    setView("merchant");
  };

  const removeDeal = async (id) => {
    setAdminActionId(id);
    try {
      const { error } = await withTimeout(
        supabase.from("deals").delete().eq("id", id),
        12000,
        "Remove request timed out. Please try again."
      );
      if (error) {
        pop("Remove failed: " + error.message, "error");
        return;
      }
      await fetchDeals();
      pop("Deal removed 🗑️");
    } catch (err) {
      pop(err.message || "Remove failed.", "error");
    } finally {
      setAdminActionId(null);
    }
  };

  const stripeCheckoutEnabled = envFlagTrue(import.meta.env.VITE_USE_STRIPE_CHECKOUT);

  const checkout = async () => {
    if (!currentUser) {
      setAuth("login");
      return;
    }
    const cartTotal = cart.reduce((s, i) => s + finalPrice(i.deal) * i.qty, 0);
    if (cartTotal <= 0) {
      pop("Cart total is zero.", "error");
      return;
    }

    if (stripeCheckoutEnabled) {
      setCheckoutBusy(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          pop("Please sign in again to pay.", "error");
          return;
        }
        const { data, error } = await supabase.functions.invoke("create-checkout-session", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (error) {
          pop(error.message || "Could not start checkout. Deploy Edge Functions and set Stripe secrets.", "error");
          return;
        }
        if (data?.error) {
          pop(typeof data.error === "string" ? data.error : "Could not start checkout.", "error");
          return;
        }
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        pop("Could not start checkout.", "error");
      } catch (e) {
        pop(e?.message || "Could not start checkout.", "error");
      } finally {
        setCheckoutBusy(false);
      }
      return;
    }

    const { data: order, error: oErr } = await supabase
      .from("orders").insert({ user_id: currentUser.id, total: cartTotal }).select().single();
    if (oErr) { pop("Checkout failed. Try again.", "error"); return; }
    await supabase.from("order_items").insert(
      cart.map(i => ({
        order_id: order.id, deal_id: i.deal.id, deal_title: i.deal.title,
        qty: i.qty, unit_price: finalPrice(i.deal),
        retail_price: +i.deal.retail_price, discount_pct: +i.deal.discount_pct,
      }))
    );
    await supabase.from("cart_items").delete().eq("user_id", currentUser.id);
    setCart([]); setView("home");
    pop("Order placed! Your deals are on the way 🎊");
  };

  // ── Computed ─────────────────────────────────────────────
  const cartTotal     = cart.reduce((s, i) => s + finalPrice(i.deal) * i.qty, 0);
  const cartCount     = cart.reduce((s, i) => s + i.qty, 0);
  const cartSavings   = cart.reduce((s, i) => s + savings(i.deal) * i.qty, 0);
  const activeDeals   = deals.filter(isDealActive);
  const liveDeals     = activeDeals;
  const expiredDeals  = deals.filter(d => !isDealActive(d));
  const merchantFilterOptions = useMemo(() => {
    const map = new Map();
    for (const d of deals) {
      if (!isDealActive(d)) continue;
      if (d.merchant_id && d.merchant_name) map.set(d.merchant_id, d.merchant_name);
    }
    return [...map.entries()].sort((a, b) =>
      String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: "base" })
    );
  }, [deals]);
  const filteredDeals = liveDeals.filter((d) => {
    if (filterMerchantId === "__followed__") {
      if (followedMerchants.length === 0) return false;
      if (!followedMerchants.includes(d.merchant_id)) return false;
    } else if (filterMerchantId) {
      if (d.merchant_id !== filterMerchantId) return false;
    }
    return filterCat === "All" || d.category === filterCat;
  });
  const featuredSlides = useMemo(() => buildFeaturedSlideshow(liveDeals), [deals]);
  const totalLiveLikes = liveDeals.reduce((s, d) => s + (+d.like_count || 0), 0);
  const totalPotentialSavings = +liveDeals.reduce((s, d) => s + savings(d), 0).toFixed(2);
  const toggleInterest = i => setRegF(p => ({ ...p, interests: p.interests.includes(i) ? p.interests.filter(x => x !== i) : [...p.interests, i] }));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp slide index when featured set shrinks
    setHeroSlideIdx(i => {
      if (featuredSlides.length === 0) return 0;
      return Math.min(i, featuredSlides.length - 1);
    });
  }, [featuredSlides]);

  useEffect(() => {
    const n = featuredSlides.length;
    if (n <= 1 || heroCarouselPaused) return;
    const t = setInterval(() => setHeroSlideIdx(p => (p + 1) % n), 5500);
    return () => clearInterval(t);
  }, [featuredSlides.length, heroCarouselPaused]);

  useEffect(() => {
    if (loading || !RADIO_STREAM_URL) return undefined;
    const el = radioAudioRef.current;
    if (!el) return undefined;
    const sync = () => setRadioStreamPlaying(!el.paused);
    el.addEventListener("play", sync);
    el.addEventListener("pause", sync);
    sync();

    if (RADIO_AUTOPLAY_ON_LOAD) {
      el.volume = 0.42;
      void el.play().catch(() => {
        /* Unmuted autoplay often blocked until user taps Listen. */
      });
    }

    return () => {
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", sync);
      el.pause();
    };
  }, [loading]);

  useEffect(() => {
    if (view !== "merchant" || !currentUser?.id || !canPostDeals) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hide QR when leaving merchant dashboard
      setMerchantJoinQrDataUrl("");
      return;
    }
    let cancelled = false;
    const origin = typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
    const joinUrl = `${origin}/?m=${encodeURIComponent(currentUser.id)}`;
    import("qrcode")
      .then((QR) => QR.default.toDataURL(joinUrl, { width: 220, margin: 2, color: { dark: "#111111", light: "#ffffff" } }))
      .then((url) => {
        if (!cancelled) setMerchantJoinQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMerchantJoinQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [view, currentUser?.id, canPostDeals]);

  useEffect(() => {
    if (view !== "merchant" || !canPostDeals) {
      setWaInviteLink("");
      setWaInviteQrDataUrl("");
    }
  }, [view, canPostDeals]);

  useEffect(() => {
    if (!waInviteLink) {
      setWaInviteQrDataUrl("");
      return;
    }
    let cancelled = false;
    import("qrcode")
      .then((QR) =>
        QR.default.toDataURL(waInviteLink, { width: 220, margin: 2, color: { dark: "#111111", light: "#ffffff" } }),
      )
      .then((url) => {
        if (!cancelled) setWaInviteQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setWaInviteQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [waInviteLink]);

  const createMerchantWaInvite = useCallback(async (silent = false) => {
    if (!currentUser) return;
    if (!silent) setWaInviteBusy(true);
    setWaInviteFetchPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("merchant-whatsapp-invite", { body: {} });
      if (error) {
        if (!silent) pop(error.message || "Could not create WhatsApp signup link.", "error");
        else waInviteAutoFetched.current = false;
        return;
      }
      if (data?.waLink) {
        setWaInviteLink(data.waLink);
        if (!silent) pop("WhatsApp signup link is ready.", "success");
      } else if (!silent) {
        pop(data?.error || "WhatsApp invite failed.", "error");
      } else {
        waInviteAutoFetched.current = false;
      }
    } catch (e) {
      if (!silent) pop(e?.message || "WhatsApp invite failed.", "error");
      else waInviteAutoFetched.current = false;
    } finally {
      setWaInviteFetchPending(false);
      if (!silent) setWaInviteBusy(false);
    }
  }, [currentUser, pop]);

  const waInviteAutoFetched = useRef(false);
  useEffect(() => {
    if (view !== "merchant" || !canPostDeals || !currentUser?.id) {
      waInviteAutoFetched.current = false;
      return;
    }
    if (waInviteLink || waInviteAutoFetched.current) return;
    waInviteAutoFetched.current = true;
    void createMerchantWaInvite(true);
  }, [view, canPostDeals, currentUser?.id, waInviteLink, createMerchantWaInvite]);

  const DealCardImage = ({ deal }) => {
    const cover = dealCoverUrl(deal);
    return (
      <div className="card-img">
        {cover ? <img src={cover} alt={deal.title} /> : <span className="emoji-fallback">{deal.emoji}</span>}
        <div className="disc-badge">{deal.discount_pct}%<small>OFF</small></div>
        <img src={bazodealLogo} alt="" className="deal-img-logo-mark" decoding="async" aria-hidden />
      </div>
    );
  };

  // ── Loading screen ───────────────────────────────────────
  if (loading) return (
    <div>
      <style>{CSS}</style>
      <div className="hdr"><div className="logo"><img src={bazodealLogo} alt="Bazodeal" decoding="async" /></div></div>
      <div className="loading-screen"><span className="spin" style={{ fontSize:32 }}>🔥</span><span>Loading Bazodeal…</span></div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)" }} onClick={() => setDropdown(false)}>
      <style>{CSS}</style>

      {/* HEADER */}
      <header className="hdr">
        <div className="logo" onClick={() => setView("home")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && setView("home")}><img src={bazodealLogo} alt="Bazodeal" decoding="async" /></div>
        <nav className="nav">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
            aria-pressed={theme === "light"}
            onClick={(e) => {
              e.stopPropagation();
              setTheme((t) => (t === "dark" ? "light" : "dark"));
            }}
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <div className="radio-nav-wrap">
            {RADIO_STREAM_URL ? (
              <>
                <audio ref={radioAudioRef} src={RADIO_STREAM_URL} preload="none" playsInline />
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm carousel-music${radioStreamPlaying ? " on" : ""}`}
                  onClick={e => {
                    e.stopPropagation();
                    void toggleRadioStream();
                  }}
                  aria-pressed={radioStreamPlaying}
                  title={`Play/pause while you browse. Page: ${RADIO_PAGE_URL}. Override stream with VITE_RADIO_STREAM_URL.`}
                >
                  {radioStreamPlaying ? "⏸ Pause" : "▶ Listen"}
                </button>
              </>
            ) : (
              <a
                href={RADIO_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm carousel-music"
                onClick={e => e.stopPropagation()}
                title={`Open station page (${RADIO_PAGE_URL}). Set VITE_RADIO_STREAM_URL to play inside Bazodeal.`}
              >
                📻 Radio
              </a>
            )}
            <a
              href={RADIO_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="radio-page-link"
              onClick={e => e.stopPropagation()}
              title="Official station page (new tab)"
            >
              Page
            </a>
          </div>
          {view === "home" && (
            <>
              <select
                id="filter-category"
                className="inp nav-filter-select"
                aria-label="Category"
                value={filterCat}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setFilterCat(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                id="filter-merchant"
                className="inp nav-filter-select"
                aria-label="Posted by"
                value={filterMerchantId}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setFilterMerchantId(e.target.value)}
              >
                <option value="">All merchants</option>
                {currentUser && followedMerchants.length > 0 ? (
                  <option value="__followed__">Stores I follow</option>
                ) : null}
                {merchantFilterOptions.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              setView("events");
              window.location.hash = "events";
            }}
          >
            📅 Events
          </button>
          {currentUser && profile ? (
            <>
              <button
                type="button"
                className="btn btn-gold btn-sm"
                onClick={e => {
                  e.stopPropagation();
                  setView("sourcer");
                  window.location.hash = "deal-sourcer";
                }}
                title="Import promotions from your own website or page into your Bazodeal listings"
              >
                Deal Sourcer
              </button>
              {profile.role === "admin" && (
                <button className="btn btn-ghost btn-sm" onClick={async () => {
                  setView("admin");
                  const refreshed = await fetchProfile(currentUser.id);
                  if (refreshed?.role === "admin") {
                    fetchAllUsers();
                  } else {
                    pop("This account is not admin yet. Sign out and sign in again.", "error");
                  }
                }}>⚙️ Admin</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setView("merchant")}>
                {profile.role === "admin" ? "📋 Deals" : "🏪 Post Deal"}
              </button>
              <button className="btn btn-ghost btn-sm cart-fab" onClick={() => setView("cart")}>
                🛒 Cart {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
              </button>
              <div className="dropdown-wrap" onClick={e => e.stopPropagation()}>
                <div className="avatar" onClick={() => setDropdown(d => !d)}>{profile.name[0].toUpperCase()}</div>
                {dropdown && (
                  <div className="dropdown">
                    <div className="dd-name">{profile.name}</div>
                    <div className="dd-email">{currentUser.email}</div>
                    <div className="dd-item" onClick={() => { setView("home"); setDropdown(false); }}>🏠 Home</div>
                    <div
                      className="dd-item"
                      onClick={() => {
                        setView("events");
                        setDropdown(false);
                        window.location.hash = "events";
                      }}
                    >📅 Events</div>
                    <div
                      className="dd-item"
                      onClick={() => {
                        setView("sourcer");
                        setDropdown(false);
                        window.location.hash = "deal-sourcer";
                      }}
                    >🌐 Deal Sourcer</div>
                    {profile.role === "admin" && <div className="dd-item" style={{ color:"var(--primary)" }}>⚡ Admin Access</div>}
                    <div className="dd-item danger" onClick={doLogout}>🚪 Log Out</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setAuth("login")}>Sign In</button>
              <button className="btn btn-pri btn-sm" onClick={() => setAuth("register")}>Join Free</button>
            </>
          )}
        </nav>
      </header>

      {/* TICKER */}
      <div className="ticker">
        <span className="ticker-inner">🔥 Up to 60% OFF · New deals every day · Members save more · Free shipping over TT$500 · Flash sales every 24hrs · Trinidad & Tobago's #1 Deal Site · 🔥 Up to 60% OFF · New deals every day ·&nbsp;</span>
      </div>

      {/* ══ HOME ══ */}
      {view === "home" && (
        <>
          <div className="hero">
            {currentUser && profile && (
              <div className="home-sourcer-cta">
                <button
                  type="button"
                  className="btn btn-gold btn-sm"
                  onClick={() => {
                    setView("sourcer");
                    window.location.hash = "deal-sourcer";
                  }}
                >
                  Open Deal Sourcer
                </button>
                <p className="home-sourcer-sub">
                  Scan a public promos page, pick lines, add TT$ prices, and publish under your merchant account.
                </p>
              </div>
            )}
            {featuredSlides.length > 0 ? (
              <div
                className="hero-carousel hero-carousel-hoverzone"
                onMouseEnter={() => setHeroCarouselPaused(true)}
                onMouseLeave={() => setHeroCarouselPaused(false)}
              >
                <div className="hero-carousel-viewport">
                  <div className="hero-carousel-track" style={{ transform:`translateX(-${heroSlideIdx * 100}%)` }}>
                    {featuredSlides.map(deal => (
                      <div key={deal.id} className="hero-carousel-slide">
                        <div className="hero-spotlight-wrap">
                          <div className="hero-spotlight">
                            <div className="hero-spotlight-img">
                              {localDateKey(deal.created_at) === todayLocalKey() && (
                                <span className="hero-slide-today">Today</span>
                              )}
                              {dealCoverUrl(deal) ? (
                                <img src={dealCoverUrl(deal)} alt={deal.title} />
                              ) : (
                                <span style={{ fontSize:96, opacity:0.92 }} aria-hidden="true">{deal.emoji}</span>
                              )}
                              <div className="disc-badge">{deal.discount_pct}%<small>OFF</small></div>
                              <img src={bazodealLogo} alt="" className="deal-img-logo-mark" decoding="async" aria-hidden />
                            </div>
                            <div className="hero-spotlight-body">
                              <div className="hero-spotlight-k">{deal.category}</div>
                              <div className="hero-spotlight-title">{deal.title}</div>
                              <div className="hero-merchant">
                                <span className="hero-merchant-lbl">Posted by</span>
                                <span className="hero-merchant-name">{deal.merchant_name}</span>
                              </div>
                              <div className="pricing hero-spot-pricing">
                                <div className="retail-price">Was {fmt(deal.retail_price)}</div>
                                <div className="final-price">{fmt(finalPrice(deal))}</div>
                                <div className="savings-tag">Save {fmt(savings(deal))} · {deal.discount_pct}% off</div>
                              </div>
                              <div className="hero-spotlight-actions">
                                <button
                                  type="button"
                                  className={`like-btn ${liked.has(deal.id) ? "liked" : ""}`}
                                  onClick={() => toggleLike(deal.id)}
                                >
                                  {liked.has(deal.id) ? "❤️" : "🤍"} {deal.like_count ?? 0}
                                </button>
                                <button type="button" className="btn btn-pri btn-sm" onClick={() => addToCart(deal)}>+ Add to Cart</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {featuredSlides.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="hero-carousel-nav hero-carousel-prev"
                      onClick={e => { e.stopPropagation(); setHeroSlideIdx(i => (i - 1 + featuredSlides.length) % featuredSlides.length); }}
                      aria-label="Previous featured deal"
                    >‹</button>
                    <button
                      type="button"
                      className="hero-carousel-nav hero-carousel-next"
                      onClick={e => { e.stopPropagation(); setHeroSlideIdx(i => (i + 1) % featuredSlides.length); }}
                      aria-label="Next featured deal"
                    >›</button>
                  </>
                )}
                {featuredSlides.length > 1 && (
                  <div className="hero-carousel-dots" role="tablist" aria-label="Choose featured deal">
                    {featuredSlides.map((d, i) => (
                      <button
                        key={d.id}
                        type="button"
                        role="tab"
                        aria-selected={i === heroSlideIdx}
                        className={`hero-carousel-dot ${i === heroSlideIdx ? "on" : ""}`}
                        onClick={e => { e.stopPropagation(); setHeroSlideIdx(i); }}
                        aria-label={`Featured deal ${i + 1} of ${featuredSlides.length}`}
                      />
                    ))}
                  </div>
                )}
                <p className="hero-carousel-caption">
                  {heroSlideIdx + 1} / {featuredSlides.length} · auto-advances every few seconds · hover to pause
                </p>
              </div>
            ) : (
              <p style={{ color:"var(--text2)", fontSize:14, marginBottom:20, maxWidth:420, marginInline:"auto" }}>
                No live deals to feature yet — post one or check back below!
              </p>
            )}
            <div className="hero-stats">
              <div className="hero-stat">
                <div className="hero-stat-l">Live Deals</div>
                <div className="hero-stat-n">{liveDeals.length}</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-l">Total Likes</div>
                <div className="hero-stat-n">{totalLiveLikes.toLocaleString("en-US")}</div>
              </div>
              <div className="hero-stat hero-stat-wide">
                <div className="hero-stat-l">Buy all and save</div>
                <div className="hero-stat-n">{fmt(totalPotentialSavings)}</div>
              </div>
            </div>
          </div>
          <div className="grid">
            {filteredDeals.length === 0 ? (
              <div className="empty" style={{ gridColumn:"1/-1" }}>
                <div className="empty-emo">🛍️</div>
                <h3>
                  {filterMerchantId === "__followed__" && followedMerchants.length === 0
                    ? "No followed stores yet"
                    : "No Deals Yet"}
                </h3>
                <p>
                  {filterMerchantId === "__followed__" && followedMerchants.length === 0
                    ? "Scan a store’s QR code or open their join link to follow them here."
                    : filterMerchantId === "__followed__"
                      ? "No live deals from your followed stores with these filters — try All categories or All merchants."
                      : filterMerchantId
                        ? "No live deals from this merchant with the selected category."
                        : "Check back soon or adjust the filters above."}
                </p>
              </div>
            ) : filteredDeals.map(deal => (
              <div
                key={deal.id}
                className="card grid-deal-card"
                role="button"
                tabIndex={0}
                aria-label={`Open details: ${deal.title}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDealDetail(deal);
                  }
                }}
                onClick={() => setDealDetail(deal)}
              >
                <DealCardImage deal={deal} />
                <div className="card-body">
                  <div className="card-cat">{deal.category}</div>
                  <div className="card-title">{deal.title}</div>
                  <div className="card-merch">
                    <span className="card-merch-l">Posted by</span>
                    <span className="card-merch-n">{deal.merchant_name}</span>
                  </div>
                  <div className="card-desc">{deal.description}</div>
                  <div className="pricing">
                    <div className="retail-price">Was: {fmt(deal.retail_price)}</div>
                    <div className="final-price">{fmt(finalPrice(deal))}</div>
                    <div className="savings-tag">💰 Save {fmt(savings(deal))} · {deal.discount_pct}% OFF</div>
                    <div className="stock-info">{deal.stock} left · {deal.expires_at ? `Expires ${deal.expires_at}` : "Limited time"}</div>
                  </div>
                </div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className={`like-btn ${liked.has(deal.id) ? "liked" : ""}`} onClick={() => toggleLike(deal.id)}>
                    {liked.has(deal.id) ? "❤️" : "🤍"} {deal.like_count}
                  </button>
                  <button type="button" className="btn btn-pri btn-sm add-btn" onClick={() => addToCart(deal)}>+ Add to Cart</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══ DEAL SOURCER (import from your URL → post as your deals — signed-in only) ══ */}
      {view === "sourcer" && currentUser && profile && (
        <div className="page">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginBottom:8 }}>
            <h1 className="page-title" style={{ margin:0 }}>Deal Sourcer</h1>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setView("home");
                if (window.location.hash === "#deal-sourcer") {
                  window.history.replaceState(null, "", window.location.pathname + window.location.search);
                }
              }}
            >
              ← Back to deals
            </button>
          </div>
          <p className="sourcer-hint">
            Enter a public page that lists promotions in text (your site, landing page, or link-in-bio shop). The scan also picks up <strong>images</strong> (Open Graph, Twitter card, then regular <strong>img</strong> URLs) and pairs them with promo rows <strong>in order</strong> — verify the thumbnail matches the deal before you post. Bazodeal scans for wording like&nbsp;
            <em>discount</em>, <em>deal</em>, <em>offer</em>, <em>sale</em>, <em>save</em>, <em>promo</em>, or&nbsp;
            <em>% off</em>, plus a visible savings cue (percent, TT$/money, was/now, etc.). Rows skip footer links like Contact/About and prefer shop/product URLs when the page offers them. Tick the rows you want, add TT$ pricing, then publish — listings use your merchant name.&nbsp;
            Facebook and similar sites often block automated reads; try a publicly readable web page instead.
          </p>
          <div className="sourcer-scan-row">
            <div className="fg sourcer-url-inp" style={{ marginBottom:0 }}>
              <label>Page URL to scan</label>
              <input
                className="inp"
                type="url"
                placeholder="https://yoursite.com/sale or blog post URL"
                value={sourcerPageUrl}
                onChange={(e) => setSourcerPageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && scanSourcerUrl()}
              />
            </div>
            <button
              type="button"
              className="btn btn-pri btn-sm"
              style={{ marginBottom:14 }}
              disabled={sourcerFetchBusy || posting}
              onClick={() => scanSourcerUrl()}
            >
              {sourcerFetchBusy ? <>⏳ Scanning…</> : "Scan page"}
            </button>
          </div>
          {sourcerFetchErr && <div className="sourcer-err">{sourcerFetchErr}</div>}
          {sourcerFetchWarn && <div className="sourcer-warn">{sourcerFetchWarn}</div>}
          {sourcerCandidates.length > 0 && (
            <>
              <p style={{ fontSize:12, color:"var(--text3)", marginBottom:10 }}>
                Showing {sourcerCandidates.length} candidate line(s){sourcerSourceUrl ? <> from&nbsp;
                  <a href={sourcerSourceUrl} target="_blank" rel="noopener noreferrer" style={{ color:"var(--gold)" }}>{sourcerSourceUrl}</a></> : null}.
              </p>
              <div style={{ marginBottom:16 }}>
                {sourcerCandidates.map((c) => {
                  const on = sourcerSelected.has(c.id);
                  const dr = sourcerDrafts[c.id];
                  return (
                    <div key={c.id} className="sourcer-card">
                      <div className="sourcer-card-head">
                        <input
                          type="checkbox"
                          className="sourcer-cb"
                          checked={on}
                          onChange={(e) => toggleSourcerRow(c, e.target.checked)}
                          aria-label={`Select: ${c.title.slice(0, 80)}`}
                        />
                        {c.imageUrl ? (
                          <div className="sourcer-thumb">
                            <img src={c.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          </div>
                        ) : (
                          <div className="sourcer-thumb sourcer-thumb-ph">No image matched</div>
                        )}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="sourcer-card-title">{c.title}</div>
                          {c.snippet && c.snippet !== c.title && (
                            <div className="sourcer-card-sn">{c.snippet}</div>
                          )}
                          {c.linkUrl ? (
                            <div className="sourcer-card-link">
                              <a href={c.linkUrl} target="_blank" rel="noopener noreferrer">Open linked URL</a>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {on && dr ? (
                        <div className="sourcer-draft-grid">
                          <div className="fg" style={{ marginBottom:0, gridColumn:"1/-1" }}>
                            <label>Listing title</label>
                            <input
                              className="inp"
                              value={dr.title}
                              onChange={(e) => patchSourcerDraft(c.id, { title: e.target.value })}
                            />
                          </div>
                          <div className="fg" style={{ marginBottom:0 }}>
                            <label>Retail (TT$)</label>
                            <input
                              className="inp"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Was price"
                              value={dr.retailPrice}
                              onChange={(e) => patchSourcerDraft(c.id, { retailPrice: e.target.value })}
                            />
                          </div>
                          <div className="fg" style={{ marginBottom:0 }}>
                            <label>Deal price (TT$)</label>
                            <input
                              className="inp"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Sale price"
                              value={dr.salePrice}
                              onChange={(e) => patchSourcerDraft(c.id, { salePrice: e.target.value })}
                            />
                          </div>
                          <div className="fg" style={{ marginBottom:0, gridColumn:"1/-1" }}>
                            <label>Category</label>
                            <select
                              className="inp"
                              value={dr.category}
                              onChange={(e) => patchSourcerDraft(c.id, { category: e.target.value })}
                            >
                              {INTERESTS.map((i) => <option key={i}>{i}</option>)}
                            </select>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="sourcer-actions">
                {!canPostDeals && (
                  <p className="sourcer-note" style={{ marginBottom:10, width:"100%" }}>
                    Your account is not approved to publish listings yet. Ask an admin to enable posting, or use the regular deal form once approved.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-gold btn-sm"
                  disabled={posting || sourcerSelected.size === 0 || !canPostDeals}
                  onClick={() => postSelectedSourcerDeals()}
                >
                  {posting ? "Posting…" : `Post selected (${sourcerSelected.size}) to Bazodeal`}
                </button>
              </div>
            </>
          )}
          <p className="sourcer-note">
            Requires the&nbsp;
            <code style={{ fontSize:11, color:"var(--text2)" }}>deal-sourcer-scan</code>
            &nbsp;Edge Function in your Supabase project. You are responsible for content you publish; scan only sites you&apos;re allowed to reuse.
          </p>
        </div>
      )}

      {/* ══ EVENTS ══ */}
      {view === "events" && (
        <div className="events-page page">
          <div className="events-page-head">
            <h1 className="page-title" style={{ margin: 0 }}>📅 Events</h1>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setView("home");
                if (window.location.hash === "#events") {
                  window.history.replaceState(null, "", window.location.pathname + window.location.search);
                }
              }}
            >
              ← Back to deals
            </button>
          </div>
          <p style={{ fontSize: 14, color: "var(--text2)", marginBottom: 20, lineHeight: 1.5 }}>
            Happenings from the Bazodeal community. Anyone approved to post deals can publish an event here.
          </p>

          {!currentUser && (
            <div className="posting-gate" style={{ marginBottom: 20 }}>
              <button type="button" className="btn btn-pri btn-sm" onClick={() => setAuth("login")}>Sign in</button>
              {" "}to create events once an admin has enabled posting for your account.
            </div>
          )}

          {currentUser && profile && canPostDeals && (
            <div className="event-form">
              <h3>Create an event</h3>
              <div className="fg">
                <label>Title</label>
                <input
                  className="inp"
                  value={eventF.title}
                  onChange={(e) => setEventF((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Sidewalk sale — Chaguanas"
                />
              </div>
              <div className="fg">
                <label>Venue (optional)</label>
                <input
                  className="inp"
                  value={eventF.venue}
                  onChange={(e) => setEventF((f) => ({ ...f, venue: e.target.value }))}
                  placeholder="Address or online link"
                />
              </div>
              <div className="fg">
                <label>Description (optional)</label>
                <textarea
                  className="inp"
                  rows={4}
                  value={eventF.description}
                  onChange={(e) => setEventF((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="fg">
                <label>Starts</label>
                <input
                  className="inp"
                  type="datetime-local"
                  value={eventF.starts_at}
                  onChange={(e) => setEventF((f) => ({ ...f, starts_at: e.target.value }))}
                />
              </div>
              <div className="fg">
                <label>Ends (optional)</label>
                <input
                  className="inp"
                  type="datetime-local"
                  value={eventF.ends_at}
                  onChange={(e) => setEventF((f) => ({ ...f, ends_at: e.target.value }))}
                />
              </div>
              <div className="fg">
                <label>Event image (optional)</label>
                <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
                  Upload a flyer or photo — same storage as deal images (JPG, PNG, or WEBP, max 5MB). Letterboxing matches deal uploads.
                </p>
                {!eventImagePreview ? (
                  <div className="img-upload-area" style={{ position: "relative" }}>
                    <div style={{ fontSize: 28 }}>🖼️</div>
                    <div className="img-upload-label">Click to upload one image</div>
                    <div className="img-upload-hint">JPG, PNG or WEBP · Max 5MB</div>
                    <input
                      id="event-img-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleEventImageChange}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                    />
                  </div>
                ) : (
                  <div className="deal-img-strip">
                    <div className="deal-img-thumb">
                      <img src={eventImagePreview} alt="Event preview" />
                      <button type="button" className="deal-img-thumb-rm" onClick={removeEventImage} aria-label="Remove image">
                        ×
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ alignSelf: "center" }}
                      onClick={() => document.getElementById("event-img-input-replace")?.click()}
                    >
                      Replace
                    </button>
                    <input
                      id="event-img-input-replace"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleEventImageChange}
                      style={{ display: "none" }}
                    />
                  </div>
                )}
              </div>
              <div className="fg">
                <label>Image URL (optional)</label>
                <input
                  className="inp"
                  type="url"
                  value={eventF.image_url}
                  onChange={(e) => setEventF((f) => ({ ...f, image_url: e.target.value }))}
                  placeholder="https://… (used only if you do not upload a file above)"
                />
              </div>
              <button type="button" className="btn btn-pri" disabled={posting} onClick={() => void postEvent()}>
                {posting ? "Saving…" : "Publish event"}
              </button>
            </div>
          )}

          {currentUser && profile && !canPostDeals && (
            <div className="posting-gate" style={{ marginBottom: 20 }}>
              Your account is not approved to post deals yet. An admin must enable posting before you can create events.
            </div>
          )}

          <div className="events-list">
            {events.length === 0 ? (
              <div className="empty">
                <div className="empty-emo">📅</div>
                <h3>No events listed yet</h3>
                <p>Check back soon — or post one if you are approved.</p>
              </div>
            ) : (
              events.map((ev) => {
                const now = Date.now();
                const past = ev.ends_at
                  ? new Date(ev.ends_at).getTime() < now
                  : new Date(ev.starts_at).getTime() < now;
                return (
                  <div key={ev.id} className={`event-card${past ? " event-card-past" : ""}`}>
                    <div>
                      <div className="event-when">{formatEventRange(ev.starts_at, ev.ends_at)}</div>
                      <div className="event-title">{ev.title}</div>
                      {ev.venue ? <div className="event-venue">📍 {ev.venue}</div> : null}
                      {ev.description ? <div className="event-desc">{ev.description}</div> : null}
                      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 10 }}>
                        Hosted by {ev.organizer_name || "Host"}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "end" }}>
                      {ev.image_url ? (
                        <img src={ev.image_url} alt="" className="event-card-img" loading="lazy" referrerPolicy="no-referrer" />
                      ) : null}
                      {currentUser && (ev.organizer_id === currentUser.id || profile?.role === "admin") ? (
                        <button type="button" className="btn btn-red btn-sm" onClick={() => void deleteEvent(ev)}>
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ══ CART ══ */}
      {view === "cart" && (
        <div className="page">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginBottom:24 }}>
            <h1 className="page-title" style={{ margin:0 }}>🛒 Cart</h1>
            <button className="btn btn-ghost btn-sm" onClick={() => setView("home")}>← Keep Shopping</button>
          </div>
          {cart.length === 0 ? (
            <div className="empty">
              <div className="empty-emo">🛒</div>
              <h3>Cart is Empty</h3>
              <p>Go grab some wild deals and come back!</p>
              <button className="btn btn-pri" onClick={() => setView("home")}>Browse Deals</button>
            </div>
          ) : (
            <>
              {cart.map(item => (
                <div key={item.id} className="cart-item">
                  <div className="cart-emo">
                    {dealCoverUrl(item.deal) ? <img src={dealCoverUrl(item.deal)} alt={item.deal.title} /> : item.deal.emoji}
                  </div>
                  <div className="cart-info">
                    <h3>{item.deal.title}</h3>
                    <p>
                      {fmt(finalPrice(item.deal))} each &nbsp;·&nbsp;
                      <span style={{ textDecoration:"line-through", color:"var(--text3)" }}>{fmt(item.deal.retail_price)}</span>
                      &nbsp;·&nbsp;
                      <span style={{ color:"var(--primary)", fontWeight:800 }}>{item.deal.discount_pct}% OFF</span>
                    </p>
                  </div>
                  <div className="qty-ctrl">
                    <button className="qty-btn" onClick={() => updateQty(item.id, -1)}>−</button>
                    <span className="qty-val">{item.qty}</span>
                    <button className="qty-btn" onClick={() => updateQty(item.id, 1)}>+</button>
                  </div>
                  <div className="cart-line-total">{fmt(finalPrice(item.deal) * item.qty)}</div>
                  <button className="btn btn-red btn-sm" onClick={() => removeFromCart(item.id)}>×</button>
                </div>
              ))}
              <div className="summary-box">
                {cart.map(item => (
                  <div key={item.id} className="sum-row">
                    <span>{item.deal.title} × {item.qty}</span>
                    <span>{fmt(finalPrice(item.deal) * item.qty)}</span>
                  </div>
                ))}
                <div className="sum-row" style={{ color:"var(--primary)", fontWeight:800 }}>
                  <span>Total Savings</span><span>{fmt(cartSavings)}</span>
                </div>
                <div className="sum-total"><span>Order Total</span><span>{fmt(cartTotal)}</span></div>
              </div>
              {stripeCheckoutEnabled && (
                <p style={{ marginTop:12, fontSize:12, color:"var(--text3)", lineHeight:1.5 }}>
                  Secure card payment via Stripe. Your order is created after payment succeeds.
                </p>
              )}
              <button
                className="btn btn-pri btn-lg btn-full"
                style={{ marginTop:14 }}
                disabled={checkoutBusy}
                onClick={checkout}
              >
                {checkoutBusy ? <><span className="spin">⏳</span> Redirecting…</> : stripeCheckoutEnabled ? `Pay ${fmt(cartTotal)}` : `Checkout — ${fmt(cartTotal)}`}
              </button>
            </>
          )}
        </div>
      )}

      {/* ══ MERCHANT ══ */}
      {view === "merchant" && currentUser && profile && (
        <div className="dash">
          <div className="dash-head">
            <h1>🏪 {profile.role === "admin" ? "Deals Dashboard" : "Post a Deal"}</h1>
            <button className="btn btn-ghost btn-sm" onClick={() => setView("home")}>← Back</button>
          </div>
          {canPostDeals && (
            <div
              className="merchant-join-qr"
              style={{
                marginBottom: 24,
                padding: 18,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "var(--card)",
              }}
            >
              <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, marginBottom: 8 }}>
                WhatsApp-first signup
              </h3>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginBottom: 12 }}>
                Customers scan a QR that opens <strong>WhatsApp</strong> with <code style={{ fontSize: 11 }}>JOIN …</code> pre-filled. They reply with email and name; Bazodeal creates their account and follows your store. Point Twilio &quot;When a message comes in&quot; at the{" "}
                <code style={{ fontSize: 11 }}>twilio-whatsapp-inbound</code> function (see{" "}
                <code style={{ fontSize: 11 }}>scripts/migration-whatsapp-first-signup.sql</code>
                ).
              </p>
              <button
                type="button"
                className="btn btn-gold btn-sm"
                style={{ marginBottom: 14 }}
                disabled={waInviteBusy}
                onClick={() => void createMerchantWaInvite()}
              >
                {waInviteBusy ? "Refreshing…" : "Refresh WhatsApp link & QR"}
              </button>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 220 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: "var(--gold)",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      marginBottom: 6,
                    }}
                  >
                    Scan to sign up (WhatsApp)
                  </div>
                  {waInviteLink && waInviteQrDataUrl ? (
                    <a href={waInviteLink} target="_blank" rel="noopener noreferrer" title="Open WhatsApp">
                      <img
                        src={waInviteQrDataUrl}
                        alt="Scan to open WhatsApp with JOIN code"
                        width={220}
                        height={220}
                        style={{ borderRadius: 12, border: "1px solid var(--border2)", display: "block" }}
                      />
                    </a>
                  ) : waInviteLink ? (
                    <div
                      style={{
                        width: 220,
                        height: 220,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--bg3)",
                        borderRadius: 12,
                        border: "1px dashed var(--border2)",
                        fontSize: 12,
                        color: "var(--text3)",
                        textAlign: "center",
                        padding: 12,
                      }}
                    >
                      Building QR…
                    </div>
                  ) : (
                    <div
                      style={{
                        width: 220,
                        height: 220,
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--bg3)",
                        borderRadius: 12,
                        border: "2px dashed var(--border2)",
                        fontSize: 12,
                        color: "var(--text3)",
                        textAlign: "center",
                        padding: 14,
                        lineHeight: 1.45,
                      }}
                    >
                      <span style={{ fontWeight: 700, color: "var(--text2)", marginBottom: 8, fontSize: 13 }}>WhatsApp signup QR</span>
                      {waInviteFetchPending ? (
                        <span>Fetching your invite link…</span>
                      ) : (
                        <span>
                          Your scannable QR appears here as soon as the wa.me link is ready. If nothing loads, deploy{" "}
                          <code style={{ fontSize: 10 }}>merchant-whatsapp-invite</code> and set{" "}
                          <code style={{ fontSize: 10 }}>TWILIO_WHATSAPP_FROM</code>, then tap refresh.
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {waInviteLink ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--gold)", textTransform: "uppercase", letterSpacing: 1 }}>
                        WhatsApp link
                      </div>
                      <input readOnly className="inp" style={{ marginTop: 6, fontSize: 12 }} value={waInviteLink} />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                        <a className="btn btn-pri btn-sm" href={waInviteLink} target="_blank" rel="noopener noreferrer">
                          Open in WhatsApp
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            void navigator.clipboard.writeText(waInviteLink).then(() => pop("Copied")).catch(() => pop("Could not copy.", "error"));
                          }}
                        >
                          Copy wa.me link
                        </button>
                      </div>
                    </>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 0, lineHeight: 1.55 }}>
                      <strong style={{ color: "var(--text2)" }}>Invite link</strong> loads in the background (or when you tap refresh). When it succeeds, the QR on the left encodes the same wa.me URL so customers can scan instead of tapping.
                    </p>
                  )}
                </div>
              </div>
              <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "22px 0 18px" }} />
              <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, marginBottom: 8 }}>
                Website signup &amp; QR
              </h3>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginBottom: 14 }}>
                Shoppers open Bazodeal in the browser with your store ID, create a free account, and follow you here. Optional one-time WhatsApp welcome if{" "}
                <code style={{ fontSize: 11, color: "var(--text2)" }}>merchant-welcome-whatsapp</code>
                {" "}is deployed with Twilio secrets.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
                {merchantJoinQrDataUrl ? (
                  <img
                    src={merchantJoinQrDataUrl}
                    alt="QR code linking to your Bazodeal store signup"
                    width={220}
                    height={220}
                    style={{ borderRadius: 12, border: "1px solid var(--border2)" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 220,
                      height: 220,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--bg3)",
                      borderRadius: 12,
                      fontSize: 13,
                      color: "var(--text3)",
                    }}
                  >
                    Building QR…
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--gold)", textTransform: "uppercase", letterSpacing: 1 }}>
                    Join link (same as QR)
                  </div>
                  <input
                    readOnly
                    className="inp"
                    style={{ marginTop: 6, fontSize: 12 }}
                    value={`${typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : ""}/?m=${currentUser.id}`}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => {
                      const t = `${window.location.origin.replace(/\/$/, "")}/?m=${currentUser.id}`;
                      void navigator.clipboard.writeText(t).then(() => pop("Link copied")).catch(() => pop("Could not copy link.", "error"));
                    }}
                  >
                    Copy link
                  </button>
                  <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 10, lineHeight: 1.45 }}>
                    This is your <strong>website</strong> join URL only — it does <strong>not</strong> open WhatsApp. For WhatsApp signup, use the <strong>wa.me</strong> link in the &quot;WhatsApp-first signup&quot; section above.
                  </p>
                </div>
              </div>
            </div>
          )}
          {!canPostDeals ? (
            <div className="posting-gate">
              Posting is turned off for new accounts until an admin reviews and approves you. This helps keep Bazodeal free of spam and inappropriate listings.
              You can still browse deals, save favourites, and use your cart. If you need access, contact support or message the site admin.
              <p style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: "var(--text2)", lineHeight: 1.45 }}>
                <strong>WhatsApp-first signup QR</strong> (wa.me + <code style={{ fontSize: 11 }}>JOIN</code> code) appears above once an admin enables posting for your account — same place as your website join QR.
              </p>
            </div>
          ) : (
            <DealForm
              dealF={dealF}
              setDealF={setDealF}
              imagePreviews={imageDraftPreviews}
              onImagesChange={handleDealImagesChange}
              onRemoveImage={removeDealImageAt}
              posting={posting}
              onPost={postDeal}
              title="New Deal Details"
              btnLabel="Submit Deal 🔥"
              btnClass="btn-pri"
            />
          )}
          <h3 className="admin-list-title">My Submitted Deals</h3>
          <div className="admin-list">
            {deals.filter(d => d.merchant_id === currentUser.id).length === 0 ? (
              <div style={{ padding:28, textAlign:"center", color:"var(--text2)", fontSize:14 }}>No deals submitted yet.</div>
            ) : deals.filter(d => d.merchant_id === currentUser.id).map(d => (
              <div key={d.id} className="admin-row">
                <div className="admin-emo">{dealCoverUrl(d) ? <img src={dealCoverUrl(d)} alt={d.title} /> : d.emoji}</div>
                <div className="admin-info">
                  <h4>{d.title}</h4>
                  <p>{fmt(d.retail_price)} → {fmt(finalPrice(d))} ({d.discount_pct}% OFF) · ❤️ {d.like_count}</p>
                </div>
                <span className={`badge ${isDealActive(d) ? "badge-live" : "badge-pend"}`}>{isDealActive(d) ? "Live" : "Expired"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ ADMIN ══ */}
      {view === "admin" && profile?.role === "admin" && (
        <div className="dash">
          <div className="dash-head">
            <h1>⚙️ Admin Panel</h1>
            <button className="btn btn-ghost btn-sm" onClick={() => setView("home")}>← Back</button>
          </div>
          <div className="stats-row">
            <div className="stat-card"><div className="stat-card-n">{deals.length}</div><div className="stat-card-l">Total Deals</div></div>
            <div className="stat-card"><div className="stat-card-n">{liveDeals.length}</div><div className="stat-card-l">Live</div></div>
            <div className="stat-card"><div className="stat-card-n">{expiredDeals.length}</div><div className="stat-card-l">Expired</div></div>
            <div className="stat-card"><div className="stat-card-n">{allUsers.length}</div><div className="stat-card-l">Members</div></div>
          </div>

          <h3 className="admin-list-title">Who can post deals</h3>
          <p className="admin-members-hint">
            New accounts cannot post until you <strong>Allow posting</strong> here. Admins can always post (no concurrent cap in the app). For other members, set <strong>max concurrent live deals</strong> so they can run more than one approved, non-expired listing at a time when allowed.
          </p>
          <div className="admin-list admin-list-members">
            {allUsers.length === 0 ? (
              <div style={{ padding:28, textAlign:"center", color:"var(--text2)", fontSize:14 }}>No members loaded yet. Open this panel again or check Supabase <code style={{ fontSize:12 }}>profiles_with_email</code> and RLS.</div>
            ) : (
              allUsers.map((u) => (
                <div key={u.id} className="admin-row admin-row-members">
                  <div className="avatar" style={{ cursor:"default" }}>{(u.name || "?")[0].toUpperCase()}</div>
                  <div className="admin-info">
                    <h4>
                      {u.name}
                      {u.role === "admin" && <span className="badge badge-admin" style={{ marginLeft:8 }}>Admin</span>}
                    </h4>
                    <p>
                      {u.email}
                      {u.gender ? ` · ${u.gender}` : ""}
                      {u.dob_month ? ` · ${MONTHS.find(m => m.v === u.dob_month)?.l} ${u.dob_year}` : ""}
                      {u.phone ? ` · ${u.phone}` : ""}
                    </p>
                  </div>
                  {u.interests?.length > 0 && (
                    <span style={{ fontSize:11, color:"var(--text3)", flexShrink:0 }}>
                      ❤️ {u.interests.slice(0,3).join(", ")}{u.interests.length > 3 ? ` +${u.interests.length-3}` : ""}
                    </span>
                  )}
                  <div className="admin-actions">
                    {u.role === "admin" ? (
                      <span className="badge badge-admin">Always can post</span>
                    ) : (
                      <>
                        <span className={`badge ${u.can_post_deals ? "badge-live" : "badge-pend"}`}>
                          {u.can_post_deals ? "Posting allowed" : "Posting locked"}
                        </span>
                        <button
                          type="button"
                          className={u.can_post_deals ? "btn btn-ghost btn-sm" : "btn btn-pri btn-sm"}
                          disabled={adminPostingAuthId === u.id}
                          onClick={() => void setUserCanPost(u.id, !u.can_post_deals)}
                        >
                          {adminPostingAuthId === u.id ? "…" : u.can_post_deals ? "Revoke posting" : "Allow posting"}
                        </button>
                        <div className="admin-concurrent-tools">
                          <span className="admin-concurrent-lbl">Max concurrent live deals</span>
                          <input
                            className="inp admin-concurrent-inp"
                            type="number"
                            min={1}
                            max={99}
                            step={1}
                            aria-label={`Concurrent deal limit for ${u.name || "member"}`}
                            value={
                              concurrentDrafts[u.id] !== undefined
                                ? concurrentDrafts[u.id]
                                : String(Math.max(1, parseInt(String(u.concurrent_deals_limit ?? 1), 10) || 1))
                            }
                            onChange={(e) =>
                              setConcurrentDrafts((d) => ({ ...d, [u.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={adminConcurrentLimitId === u.id}
                            onClick={() => void setUserConcurrentLimit(u.id)}
                          >
                            {adminConcurrentLimitId === u.id ? "…" : "Save limit"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <DealForm
            dealF={dealF}
            setDealF={setDealF}
            imagePreviews={imageDraftPreviews}
            onImagesChange={handleDealImagesChange}
            onRemoveImage={removeDealImageAt}
            posting={posting}
            onPost={postDeal}
            title="Upload Deal"
            btnLabel="Upload Deal ✅"
            btnClass="btn-gold"
          />

          <h3 className="admin-list-title">Live Deals ({liveDeals.length})</h3>
          <div className="admin-list" style={{ marginBottom:24 }}>
            {liveDeals.length === 0 ? (
              <div style={{ padding:28, textAlign:"center", color:"var(--text2)", fontSize:14 }}>No deals yet.</div>
            ) : liveDeals.map(d => (
              <div key={d.id} className="admin-row">
                <div className="admin-emo">{dealCoverUrl(d) ? <img src={dealCoverUrl(d)} alt={d.title} /> : d.emoji}</div>
                <div className="admin-info">
                  <h4>{d.title}</h4>
                  <p>by {d.merchant_name} · {fmt(d.retail_price)} → {fmt(finalPrice(d))} ({d.discount_pct}% OFF) · ❤️ {d.like_count}</p>
                </div>
                <span className={`badge ${isDealActive(d) ? "badge-live" : "badge-pend"}`}>{isDealActive(d) ? "Live" : "Expired"}</span>
                <div className="admin-actions">
                  <button className="btn btn-red btn-sm" disabled={adminActionId === d.id} onClick={() => removeDeal(d.id)}>
                    {adminActionId === d.id ? "Working…" : "Remove"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <h3 className="admin-list-title">Expired Deals ({expiredDeals.length})</h3>
          <div className="admin-list" style={{ marginBottom:24 }}>
            {expiredDeals.length === 0 ? (
              <div style={{ padding:28, textAlign:"center", color:"var(--text2)", fontSize:14 }}>No expired deals.</div>
            ) : expiredDeals.map(d => (
              <div key={d.id} className="admin-row">
                <div className="admin-emo">{dealCoverUrl(d) ? <img src={dealCoverUrl(d)} alt={d.title} /> : d.emoji}</div>
                <div className="admin-info">
                  <h4>{d.title}</h4>
                  <p>by {d.merchant_name} · {fmt(d.retail_price)} → {fmt(finalPrice(d))} ({d.discount_pct}% OFF) · ❤️ {d.like_count}</p>
                </div>
                <span className="badge badge-pend">Expired</span>
                <div className="admin-actions">
                  <button className="btn btn-red btn-sm" disabled={adminActionId === d.id} onClick={() => removeDeal(d.id)}>
                    {adminActionId === d.id ? "Working…" : "Remove"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ LOGIN ══ */}
      {auth === "login" && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setAuth(null)}>
          <div className="modal">
            <div className="modal-title">Welcome Back 🔥</div>
            <div className="modal-sub">Sign in to access deals, your wishlist, and cart.</div>
            {formErr && <div className="err-box">{formErr}</div>}
            <div className="fg"><label>Email Address</label>
              <input className="inp" type="email" placeholder="you@example.com" value={loginF.email}
                onChange={e => setLoginF(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="fg"><label>Password</label>
              <input className="inp" type="password" placeholder="••••••••" value={loginF.password}
                onChange={e => setLoginF(p => ({ ...p, password: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && doLogin()} />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => setAuth(null)}>Cancel</button>
              <button className="btn btn-pri" style={{ flex:2 }} disabled={posting} onClick={doLogin}>
                {posting ? <span className="spin">⏳</span> : "Sign In"}
              </button>
            </div>
            <div className="modal-switch">Don't have an account? <button onClick={() => { setFormErr(""); setAuth("register"); }}>Join Free</button></div>
          </div>
        </div>
      )}

      {/* ══ REGISTER ══ */}
      {auth === "register" && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setAuth(null)}>
          <div className="modal">
            <div className="modal-title">Join Bazodeal 🎉</div>
            <div className="modal-sub">Create your free account and start saving today.</div>
            {qrInviteMerchantId && (
              <div
                className="posting-gate"
                style={{ marginBottom:14, textAlign:"left", fontSize:13, lineHeight:1.45 }}
              >
                You&apos;re signing up from <strong>{qrInviteMerchantName || "a store"}</strong>&apos;s QR link. After you join, you&apos;ll follow their deals on Bazodeal. WhatsApp is optional and uses Twilio when your project has it configured.
              </div>
            )}
            {formErr && <div className="err-box">{formErr}</div>}
            <div className="fg"><label>Your Public Name or Company *</label>
              <input className="inp" placeholder="e.g. Acme Supplies" value={regF.name}
                onChange={e => setRegF(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="fg"><label>Email Address *</label>
              <input className="inp" type="email" placeholder="you@example.com" value={regF.email}
                onChange={e => setRegF(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="fg"><label>Password *</label>
              <input className="inp" type="password" placeholder="Choose a strong password" value={regF.password}
                onChange={e => setRegF(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="fg"><label>Phone Number{qrInviteMerchantId && regF.whatsappOptIn ? " *" : ""}</label>
              <input className="inp" type="tel" placeholder="e.g. +18681234567 (Trinidad) or +1…" value={regF.phone}
                onChange={e => setRegF(p => ({ ...p, phone: e.target.value }))} />
            </div>
            {qrInviteMerchantId && (
              <label className="fg" style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", fontSize:13, lineHeight:1.45 }}>
                <input
                  type="checkbox"
                  checked={regF.whatsappOptIn}
                  onChange={(e) => setRegF((p) => ({ ...p, whatsappOptIn: e.target.checked }))}
                  style={{ marginTop:3 }}
                />
                <span>
                  Send me a <strong>WhatsApp welcome</strong> from Bazodeal about <strong>{qrInviteMerchantName || "this store"}</strong> (requires Twilio on Supabase). I understand future messages may be sent according to your project&apos;s policies.
                </span>
              </label>
            )}
            <div className="row2">
              <div className="fg"><label>Birth Month</label>
                <select className="inp" value={regF.dobMonth} onChange={e => setRegF(p => ({ ...p, dobMonth: e.target.value }))}>
                  <option value="">Select month</option>
                  {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
              <div className="fg"><label>Birth Year</label>
                <select className="inp" value={regF.dobYear} onChange={e => setRegF(p => ({ ...p, dobYear: e.target.value }))}>
                  <option value="">Select year</option>
                  {YEARS.map(y => <option key={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div className="fg"><label>Gender</label>
              <select className="inp" value={regF.gender} onChange={e => setRegF(p => ({ ...p, gender: e.target.value }))}>
                <option value="">Prefer not to say</option>
                {GENDERS.map(g => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Interests — what deals excite you?</label>
              <div className="int-grid">
                {INTERESTS.map(i => (
                  <button key={i} className={`int-pill ${regF.interests.includes(i) ? "on" : ""}`}
                    onClick={() => toggleInterest(i)}>{i}</button>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" style={{ flex:1 }} onClick={() => setAuth(null)}>Cancel</button>
              <button className="btn btn-pri" style={{ flex:2 }} disabled={posting} onClick={doRegister}>
                {posting ? <span className="spin">⏳</span> : "Create Account 🚀"}
              </button>
            </div>
            <div className="modal-switch">Already have an account? <button onClick={() => { setFormErr(""); setAuth("login"); }}>Sign In</button></div>
          </div>
        </div>
      )}

      {/* Deal detail (grid click): gallery scroll + actions */}
      {dealDetail && (
        <div
          className="deal-detail-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDealDetail(null);
          }}
        >
          <div
            className="deal-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deal-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="deal-detail-close" onClick={() => setDealDetail(null)} aria-label="Close">
              ×
            </button>
            <div className="deal-detail-head">
              <h2 id="deal-detail-title">{dealDetail.title}</h2>
              <div className="deal-detail-meta">
                {dealDetail.category} · Posted by {dealDetail.merchant_name}
              </div>
            </div>
            <div className="deal-detail-gallery">
              {dealGallery(dealDetail).length === 0 ? (
                <div style={{ textAlign:"center", padding:"24px 0" }}>
                  <span style={{ fontSize:88, lineHeight:1 }} aria-hidden="true">{dealDetail.emoji}</span>
                </div>
              ) : (
                dealGallery(dealDetail).map((url, i) => (
                  <img key={`${url}-${i}`} src={url} alt={`${dealDetail.title} — photo ${i + 1}`} loading="lazy" />
                ))
              )}
            </div>
            <div className="deal-detail-body">
              {dealDetail.description ? (
                <p style={{ fontSize:14, color:"var(--text2)", lineHeight:1.55, whiteSpace:"pre-wrap" }}>{dealDetail.description}</p>
              ) : null}
              <div className="pricing" style={{ marginTop:16, borderTop:"1px solid var(--border)", paddingTop:14 }}>
                <div className="retail-price">Was: {fmt(dealDetail.retail_price)}</div>
                <div className="final-price">{fmt(finalPrice(dealDetail))}</div>
                <div className="savings-tag">Save {fmt(savings(dealDetail))} · {dealDetail.discount_pct}% OFF</div>
                <div className="stock-info">{dealDetail.stock} left · {dealDetail.expires_at ? `Expires ${dealDetail.expires_at}` : "Limited time"}</div>
              </div>
            </div>
            <div className="deal-detail-actions">
              <button
                type="button"
                className={`like-btn ${liked.has(dealDetail.id) ? "liked" : ""}`}
                onClick={() => toggleLike(dealDetail.id)}
              >
                {liked.has(dealDetail.id) ? "❤️" : "🤍"} {dealDetail.like_count ?? 0}
              </button>
              <button type="button" className="btn btn-pri btn-sm add-btn" onClick={() => addToCart(dealDetail)}>
                + Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {notif && <div className={`notif ${notif.type}`}>{notif.msg}</div>}
    </div>
  );
}
