// src/App.jsx — Bazodeal (Supabase edition, final)
// npm install @supabase/supabase-js

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./lib/supabaseClient";
import bazodealLogo from "./assets/bazodeal-logo.png";

// ── Constants ────────────────────────────────────────────────
const INTERESTS  = ["Electronics","Fashion","Home & Garden","Sports","Beauty","Travel","Food & Drink","Toys","Books","Automotive","Health","Jewellery","Outdoors","Gaming","Pets"];
const CATEGORIES = ["All","Electronics","Fashion","Home & Garden","Sports","Beauty","Travel","Food & Drink","Toys","Books","Automotive","Health","Jewellery","Outdoors","Gaming","Pets"];
const MONTHS     = [{v:"01",l:"January"},{v:"02",l:"February"},{v:"03",l:"March"},{v:"04",l:"April"},{v:"05",l:"May"},{v:"06",l:"June"},{v:"07",l:"July"},{v:"08",l:"August"},{v:"09",l:"September"},{v:"10",l:"October"},{v:"11",l:"November"},{v:"12",l:"December"}];
const YEARS      = Array.from({length:70},(_,i)=>(2006-i).toString());
const GENDERS    = ["Male","Female","Non-binary","Prefer not to say"];
const EMOJIS     = ["🛍️","📱","👗","🏠","⚽","💄","✈️","🍕","🧸","📚","🚗","💊","💍","🏕️","🎮","🐾","🎵","🍫","🏋️","🖥️"];
const TODAY      = new Date().toISOString().split("T")[0];

const finalPrice = d => +(+d.retail_price * (1 - +d.discount_pct / 100)).toFixed(2);
const savings    = d => +(+d.retail_price - finalPrice(d)).toFixed(2);
const fmt        = n => `TT$${Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
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
const cropImageFile = async (file, zoom, focusX, focusY) => {
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

  // Export to a fixed landscape frame for consistent card rendering.
  // Scaling preserves aspect ratio; only centered crop is applied (no skew/stretch).
  const targetW = 1200;
  const targetH = 800;
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not initialize image editor.");

  const baseScale = Math.max(targetW / img.width, targetH / img.height);
  const finalScale = baseScale * zoom;
  const drawW = img.width * finalScale;
  const drawH = img.height * finalScale;
  const maxX = Math.max(0, drawW - targetW);
  const maxY = Math.max(0, drawH - targetH);
  const x = -(maxX * (focusX / 100));
  const y = -(maxY * (focusY / 100));

  ctx.drawImage(img, x, y, drawW, drawH);

  const toBlob = (type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Compress for fast loading on the home feed.
  // Prefer WebP when available and target a reasonable size budget.
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
  if (!blob) throw new Error("Could not process image crop.");

  const safeName = (file.name || "deal-image").replace(/\.[^/.]+$/, "");
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${safeName}-cropped.${extension}`, { type: blob.type });
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

.hdr{position:sticky;top:0;z-index:200;background:rgba(8,7,10,.88);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,61,0,.35);box-shadow:0 1px 0 rgba(255,208,0,.08);min-height:48px;padding:6px 16px;display:flex;align-items:center;justify-content:space-between;}
.logo{display:flex;align-items:center;cursor:pointer;user-select:none;line-height:0}
.logo img{display:block;height:100px;width:auto}
.nav{display:flex;align-items:center;gap:6px}

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

.hero{padding:40px 24px 28px;text-align:center;background:radial-gradient(ellipse 65% 45% at 50% -10%,rgba(255,208,0,.14) 0%,rgba(255,61,0,.1) 38%,transparent 72%)}
.hero h1{font-family:'Bebas Neue';font-size:clamp(52px,9vw,108px);letter-spacing:5px;line-height:.95;color:var(--text)}
.hero h1 em{background:linear-gradient(105deg,var(--flame-yellow),#fff4b0,var(--flame-orange));-webkit-background-clip:text;background-clip:text;color:transparent;font-style:normal;display:block}
.hero p{color:var(--text2);font-size:15px;margin-top:14px;max-width:420px;margin-inline:auto;line-height:1.6}
.hero-lead-wrap{width:100%;max-width:min(920px,94vw);margin:0 auto 22px;padding:0 16px;text-align:center}
.hero-lead{margin:0;font-size:clamp(17px,2.8vw,34px);font-weight:900;line-height:1.25;letter-spacing:.03em;font-family:'Nunito Sans',sans-serif;color:var(--flame-yellow);text-shadow:0 0 24px rgba(255,208,0,.12)}
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

.filters{padding:14px 24px 10px;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.filters::-webkit-scrollbar{display:none}
.pill{padding:5px 14px;border-radius:100px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-family:'Nunito Sans';font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .18s;letter-spacing:.3px}
.pill:hover{border-color:var(--flame-yellow);color:var(--flame-yellow)}.pill.active{background:linear-gradient(135deg,var(--flame-orange),#e63d00);border-color:var(--flame-orange);color:#fff;box-shadow:0 4px 16px rgba(255,61,0,.3)}

.grid{padding:10px 24px 60px;display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}

.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;display:flex;flex-direction:column;transition:all .22s}
.card:hover{border-color:rgba(255,208,0,.35);transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,61,0,.15),0 0 28px rgba(255,145,0,.08)}
.card-img{height:160px;display:flex;align-items:center;justify-content:center;font-size:68px;background:var(--bg3);position:relative;overflow:hidden}
.card-img img{width:100%;height:100%;object-fit:cover;display:block}
.card-img .emoji-fallback{font-size:68px}
.disc-badge{position:absolute;top:10px;right:10px;background:linear-gradient(145deg,var(--flame-yellow),var(--flame-orange));color:#08070A;font-family:'Bebas Neue';font-size:26px;letter-spacing:1px;padding:3px 10px 1px;border-radius:8px;line-height:1.1;text-align:center;z-index:1;box-shadow:0 4px 14px rgba(255,61,0,.35)}
.disc-badge small{display:block;font-family:'Nunito Sans';font-size:9px;font-weight:800;letter-spacing:1px;margin-top:-2px;opacity:.9}
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
.img-upload-area.has-image{padding:0;border-style:solid}
.img-upload-area img{width:100%;height:160px;object-fit:cover;border-radius:calc(var(--radius-lg) - 2px);display:block}
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
.cart-emo img{width:100%;height:100%;object-fit:cover}
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
.admin-emo img{width:100%;height:100%;object-fit:cover}
.admin-info{flex:1;min-width:0}
.admin-info h4{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.admin-info p{font-size:11px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px}
.badge-live{background:var(--green-bg);color:var(--green);border:1px solid rgba(0,230,118,.2)}
.badge-pend{background:var(--gold-bg);color:var(--gold);border:1px solid rgba(255,184,0,.2)}
.badge-admin{background:rgba(255,61,0,.12);color:var(--primary);border:1px solid rgba(255,61,0,.25)}
.admin-actions{display:flex;gap:6px;flex-shrink:0}

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

.cart-fab{position:relative}
.cart-badge{position:absolute;top:-7px;right:-7px;background:var(--primary);color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center}
.divider{height:1px;background:var(--border);margin:20px 0}
.spin{display:inline-block;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:16px;color:var(--text2);font-size:14px}
`;

// ── DealForm — outside main component to prevent cursor-jump remounts ────────
function DealForm({
  dealF, setDealF, imagePreview, onImageChange, posting, onPost, title, btnLabel, btnClass,
  cropZoom, setCropZoom, cropX, setCropX, cropY, setCropY,
}) {
  const showPreview = dealF.retailPrice && dealF.discountPct && +dealF.retailPrice > 0 && +dealF.discountPct > 0;

  return (
    <div className="deal-form">
      <h3>{title}</h3>

      <div className="fg">
        <label>Deal Image</label>
        <div className={`img-upload-area ${imagePreview ? "has-image" : ""}`}>
          {imagePreview ? (
            <>
              <img
                src={imagePreview}
                alt="Preview"
                style={{
                  transform: `scale(${cropZoom})`,
                  transformOrigin: `${cropX}% ${cropY}%`,
                }}
              />
              <button
                className="img-change-btn"
                onClick={e => { e.stopPropagation(); document.getElementById("deal-img-input").click(); }}
              >Change</button>
            </>
          ) : (
            <>
              <div style={{ fontSize:28 }}>🖼️</div>
              <div className="img-upload-label">Click to upload an image</div>
              <div className="img-upload-hint">JPG, PNG or WEBP · Max 5MB</div>
            </>
          )}
          <input
            id="deal-img-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onImageChange}
            style={{ position:"absolute", inset:0, opacity:0, cursor:"pointer", width:"100%", height:"100%" }}
          />
        </div>
      </div>

      {imagePreview && (
        <div className="fg" style={{ marginTop:-4 }}>
          <label>Image Crop</label>
          <div style={{ display:"grid", gap:8 }}>
            <div style={{ display:"grid", gridTemplateColumns:"86px 1fr 44px", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:12, color:"var(--text2)" }}>Zoom</span>
              <input className="inp" type="range" min="1" max="2.5" step="0.05" value={cropZoom}
                onChange={e => setCropZoom(Number(e.target.value))} />
              <span style={{ fontSize:12, color:"var(--text2)", textAlign:"right" }}>{cropZoom.toFixed(2)}x</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"86px 1fr 44px", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:12, color:"var(--text2)" }}>Left/Right</span>
              <input className="inp" type="range" min="0" max="100" step="1" value={cropX}
                onChange={e => setCropX(Number(e.target.value))} />
              <span style={{ fontSize:12, color:"var(--text2)", textAlign:"right" }}>{cropX}%</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"86px 1fr 44px", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:12, color:"var(--text2)" }}>Up/Down</span>
              <input className="inp" type="range" min="0" max="100" step="1" value={cropY}
                onChange={e => setCropY(Number(e.target.value))} />
              <span style={{ fontSize:12, color:"var(--text2)", textAlign:"right" }}>{cropY}%</span>
            </div>
          </div>
        </div>
      )}

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
          <label>Discount % *</label>
          <input className="inp" type="number" min="1" max="99" placeholder="e.g. 40" value={dealF.discountPct}
            onChange={e => setDealF(p => ({ ...p, discountPct: e.target.value }))} />
        </div>
      </div>

      {showPreview && (
        <div className="price-preview">
          <span>Deal price:</span>
          <strong>{fmt(+dealF.retailPrice * (1 - +dealF.discountPct / 100))}</strong>
          <span style={{ color:"var(--text3)" }}>({dealF.discountPct}% off {fmt(+dealF.retailPrice)})</span>
          <span style={{ marginLeft:"auto", color:"var(--primary)", fontWeight:800 }}>
            Save {fmt(+dealF.retailPrice * +dealF.discountPct / 100)}
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
  const [view, setView]               = useState("home");
  const [auth, setAuth]               = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile]         = useState(null);
  const [deals, setDeals]             = useState([]);
  const [allUsers, setAllUsers]       = useState([]);
  const [cart, setCart]               = useState([]);
  const [liked, setLiked]             = useState(new Set());
  const [filterCat, setFilterCat]     = useState("All");
  const [dropdown, setDropdown]       = useState(false);
  const [notif, setNotif]             = useState(null);
  const [formErr, setFormErr]         = useState("");
  const [loading, setLoading]         = useState(true);
  const [posting, setPosting]         = useState(false);
  const [adminActionId, setAdminActionId] = useState(null);
  const [imageFile, setImageFile]     = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [heroSlideIdx, setHeroSlideIdx] = useState(0);
  const [heroCarouselPaused, setHeroCarouselPaused] = useState(false);
  const [radioStreamPlaying, setRadioStreamPlaying] = useState(false);
  const radioAudioRef = useRef(null);
  const [loginF, setLoginF] = useState({ email:"", password:"" });
  const [regF,   setRegF]   = useState({ email:"", password:"", name:"", phone:"", dobMonth:"", dobYear:"", gender:"", interests:[] });
  const [dealF,  setDealF]  = useState({ title:"", category:"Electronics", retailPrice:"", discountPct:"", emoji:"🛍️", description:"", stock:"", expires:"" });

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
    setDealF({ title:"", category:"Electronics", retailPrice:"", discountPct:"", emoji:"🛍️", description:"", stock:"", expires:"" });
    setImageFile(null);
    setImagePreview(null);
    setCropZoom(1);
    setCropX(50);
    setCropY(50);
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

  // Uses profiles_with_email view to include email in admin panel
  const fetchAllUsers = useCallback(async () => {
    const { data } = await supabase
      .from("profiles_with_email")
      .select("*")
      .order("created_at", { ascending: false });
    setAllUsers(data || []);
  }, []);

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
          setCurrentUser(null); setProfile(null); setCart([]); setLiked(new Set());
        }
      }
    );

    fetchDeals();

    return () => { subscription.unsubscribe(); };
  }, [fetchDeals, fetchProfile, fetchCart, fetchLikes, fetchAllUsers, ensureProfile]);

  // ── Image Handling ───────────────────────────────────────
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { pop("Image must be under 5MB", "error"); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setCropZoom(1);
    setCropX(50);
    setCropY(50);
  };

  const uploadImage = async () => {
    if (!imageFile || !currentUser) return null;
    let processedImageFile = imageFile;
    try {
      processedImageFile = await cropImageFile(imageFile, cropZoom, cropX, cropY);
    } catch (err) {
      pop(err.message || "Could not crop image.", "error");
      return null;
    }
    const ext      = processedImageFile.name.split(".").pop();
    const fileName = `${currentUser.id}/${Date.now()}.${ext}`;
    try {
      const uploadResult = await withTimeout(
        supabase.storage.from("deal-images").upload(fileName, processedImageFile, { upsert: true }),
        15000,
        "Image upload timed out. Check Storage bucket policies and try again."
      );
      const { error } = uploadResult;
      if (error) {
        pop("Image upload failed: " + error.message, "error");
        return null;
      }
      const { data: { publicUrl } } = supabase.storage.from("deal-images").getPublicUrl(fileName);
      return publicUrl;
    } catch (err) {
      pop(err.message || "Image upload failed unexpectedly.", "error");
      return null;
    }
  };

  // ── Auth ─────────────────────────────────────────────────
  const doLogin = async () => {
    setFormErr(""); setPosting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginF.email, password: loginF.password });
    setPosting(false);
    if (error) { setFormErr(error.message); return; }
    setAuth(null);
    setLoginF({ email:"", password:"" });
    pop("Welcome back! 🔥");
  };

  const doRegister = async () => {
    setFormErr(""); setPosting(true);
    const { email, password, name, phone, dobMonth, dobYear, gender, interests } = regF;
    if (!name || !email || !password) {
      setFormErr("Full name, email and password are required.");
      setPosting(false); return;
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
          setPosting(false);
          setAuth(null);
          setRegF({ email:"", password:"", name:"", phone:"", dobMonth:"", dobYear:"", gender:"", interests:[] });
          pop("Welcome back! Account already existed, so we signed you in.");
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
    if (data.user) {
      const ensured = await ensureProfile(data.user, { name, phone, dobMonth, dobYear, gender, interests });
      const profileError = !ensured ? { message: "Could not create profile row." } : null;
      if (profileError) {
        console.error("Profile upsert error:", profileError);
        setFormErr("Profile creation failed: " + profileError.message);
        setPosting(false);
        return;
      }
    }
    setPosting(false);
    setAuth(null);
    setRegF({ email:"", password:"", name:"", phone:"", dobMonth:"", dobYear:"", gender:"", interests:[] });
    pop("You're in! Welcome to Bazodeal 🎉");
  };

  const doLogout = async () => {
    await supabase.auth.signOut();
    setDropdown(false); setView("home");
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
    const { title, retailPrice, discountPct, description, stock, expires, emoji, category } = dealF;
    if (!title || !retailPrice || !discountPct) { pop("Title, price and discount are required", "error"); return; }
    
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
    const imageWasSelected = !!imageFile;
    const imageUrl = await uploadImage();
    if (imageWasSelected && !imageUrl) {
      setPosting(false);
      pop("Image upload failed, so the deal was not posted. Fix upload settings and try again.", "error");
      return;
    }
    const payload = {
      title,
      merchant_id:   currentUser.id,
      merchant_name: profile?.name || "Merchant",
      category, emoji,
      retail_price:  parseFloat(retailPrice),
      discount_pct:  parseFloat(discountPct),
      description,
      stock:      parseInt(stock) || 99,
      expires_at: expires || null,
      approved:   true,
      image_url:  imageUrl,
    };

    let { error } = await supabase.from("deals").insert(payload);

    // Backward compatibility: older DB schemas may not have image_url yet.
    if (error?.message?.includes("image_url")) {
      const { image_url, ...payloadWithoutImage } = payload;
      const retry = await supabase.from("deals").insert(payloadWithoutImage);
      error = retry.error || null;
      if (!error) {
        pop("Deal posted without image. Add image_url column in Supabase to enable image uploads.", "error");
      }
    }

    setPosting(false);
    if (error) { pop("Failed to post: " + error.message, "error"); return; }
    await fetchDeals();
    resetDealForm();
    pop("Deal is live! ✅");
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

  const checkout = async () => {
    const cartTotal = cart.reduce((s, i) => s + finalPrice(i.deal) * i.qty, 0);
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
  const filteredDeals = liveDeals.filter(d => filterCat === "All" || d.category === filterCat);
  const featuredSlides = useMemo(() => buildFeaturedSlideshow(liveDeals), [deals]);
  const totalLiveLikes = liveDeals.reduce((s, d) => s + (+d.like_count || 0), 0);
  const totalPotentialSavings = +liveDeals.reduce((s, d) => s + savings(d), 0).toFixed(2);
  const toggleInterest = i => setRegF(p => ({ ...p, interests: p.interests.includes(i) ? p.interests.filter(x => x !== i) : [...p.interests, i] }));

  useEffect(() => {
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

  const DealCardImage = ({ deal }) => (
    <div className="card-img">
      {deal.image_url ? <img src={deal.image_url} alt={deal.title} /> : <span className="emoji-fallback">{deal.emoji}</span>}
      <div className="disc-badge">{deal.discount_pct}%<small>OFF</small></div>
    </div>
  );

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
          {currentUser && profile ? (
            <>
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
            <div className="hero-lead-wrap" aria-label="Site tagline">
              <p className="hero-lead">{`Get Bazodee!! with our Big Daily Deals from Trinidad and Tobago's #1 DEAL SITE`}</p>
            </div>
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
                              {deal.image_url ? (
                                <img src={deal.image_url} alt={deal.title} />
                              ) : (
                                <span style={{ fontSize:96, opacity:0.92 }} aria-hidden="true">{deal.emoji}</span>
                              )}
                              <div className="disc-badge">{deal.discount_pct}%<small>OFF</small></div>
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
          <div className="filters">
            {CATEGORIES.map(c => (
              <button key={c} className={`pill ${filterCat === c ? "active" : ""}`} onClick={() => setFilterCat(c)}>{c}</button>
            ))}
          </div>
          <div className="grid">
            {filteredDeals.length === 0 ? (
              <div className="empty" style={{ gridColumn:"1/-1" }}>
                <div className="empty-emo">🛍️</div>
                <h3>No Deals Yet</h3>
                <p>Check back soon or try a different category.</p>
              </div>
            ) : filteredDeals.map(deal => (
              <div key={deal.id} className="card">
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
                <div className="card-actions">
                  <button className={`like-btn ${liked.has(deal.id) ? "liked" : ""}`} onClick={() => toggleLike(deal.id)}>
                    {liked.has(deal.id) ? "❤️" : "🤍"} {deal.like_count}
                  </button>
                  <button className="btn btn-pri btn-sm add-btn" onClick={() => addToCart(deal)}>+ Add to Cart</button>
                </div>
              </div>
            ))}
          </div>
        </>
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
                    {item.deal.image_url ? <img src={item.deal.image_url} alt={item.deal.title} /> : item.deal.emoji}
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
              <button className="btn btn-pri btn-lg btn-full" style={{ marginTop:14 }} onClick={checkout}>
                Checkout — {fmt(cartTotal)}
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
          <DealForm dealF={dealF} setDealF={setDealF} imagePreview={imagePreview} onImageChange={handleImageChange}
            posting={posting} onPost={postDeal} title="New Deal Details" btnLabel="Submit Deal 🔥" btnClass="btn-pri"
            cropZoom={cropZoom} setCropZoom={setCropZoom} cropX={cropX} setCropX={setCropX} cropY={cropY} setCropY={setCropY} />
          <h3 className="admin-list-title">My Submitted Deals</h3>
          <div className="admin-list">
            {deals.filter(d => d.merchant_id === currentUser.id).length === 0 ? (
              <div style={{ padding:28, textAlign:"center", color:"var(--text2)", fontSize:14 }}>No deals submitted yet.</div>
            ) : deals.filter(d => d.merchant_id === currentUser.id).map(d => (
              <div key={d.id} className="admin-row">
                <div className="admin-emo">{d.image_url ? <img src={d.image_url} alt={d.title} /> : d.emoji}</div>
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

          <DealForm dealF={dealF} setDealF={setDealF} imagePreview={imagePreview} onImageChange={handleImageChange}
            posting={posting} onPost={postDeal} title="Upload Deal" btnLabel="Upload Deal ✅" btnClass="btn-gold"
            cropZoom={cropZoom} setCropZoom={setCropZoom} cropX={cropX} setCropX={setCropX} cropY={cropY} setCropY={setCropY} />

          <h3 className="admin-list-title">Live Deals ({liveDeals.length})</h3>
          <div className="admin-list" style={{ marginBottom:24 }}>
            {liveDeals.length === 0 ? (
              <div style={{ padding:28, textAlign:"center", color:"var(--text2)", fontSize:14 }}>No deals yet.</div>
            ) : liveDeals.map(d => (
              <div key={d.id} className="admin-row">
                <div className="admin-emo">{d.image_url ? <img src={d.image_url} alt={d.title} /> : d.emoji}</div>
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
                <div className="admin-emo">{d.image_url ? <img src={d.image_url} alt={d.title} /> : d.emoji}</div>
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

          <div className="divider" />
          <h3 className="admin-list-title">Members ({allUsers.length})</h3>
          <div className="admin-list">
            {allUsers.map((u, i) => (
              <div key={i} className="admin-row">
                <div className="avatar" style={{ cursor:"default" }}>{u.name[0].toUpperCase()}</div>
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
            <div className="fg"><label>Phone Number</label>
              <input className="inp" type="tel" placeholder="e.g. 868-XXX-XXXX" value={regF.phone}
                onChange={e => setRegF(p => ({ ...p, phone: e.target.value }))} />
            </div>
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

      {/* TOAST */}
      {notif && <div className={`notif ${notif.type}`}>{notif.msg}</div>}
    </div>
  );
}
