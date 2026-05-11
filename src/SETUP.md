# Bazodeal — Setup Guide

Trinidad & Tobago's deep-discount marketplace, powered by React + Supabase.

---

## Prerequisites

- Node.js 18+
- A free [Supabase](https://supabase.com) account
- Vite or Create React App

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a name, database password, and the closest region (e.g. us-east-1)
3. Wait ~2 minutes for the project to provision

---

## Step 2 — Run the SQL Schema

1. In your Supabase dashboard, go to **SQL Editor → New Query**
2. Paste the entire contents of `bazodeal_schema.sql`
3. Click **Run**

This creates all tables, RLS policies, triggers, and views.

---

## Step 3 — Set Up Your React Project

```bash
npm create vite@latest bazodeal -- --template react
cd bazodeal
npm install @supabase/supabase-js
```

Copy the project files into place:

```
bazodeal/
├── src/
│   ├── lib/
│   │   └── supabaseClient.js   ← copy this file
│   └── App.jsx                 ← copy this file
├── index.html
└── package.json
```

---

## Step 4 — Add Your Supabase Credentials

Open `src/lib/supabaseClient.js` and replace:

```js
const SUPABASE_URL      = "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";
```

Find these values at:
**Supabase Dashboard → Project Settings → API**

- `Project URL` → SUPABASE_URL  
- `anon / public` key → SUPABASE_ANON_KEY

> Never use the `service_role` key in the frontend.

You can also use environment variables (recommended for production):

```bash
# .env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

```js
// supabaseClient.js
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

---

## Step 5 — Create Your Admin Account

1. Run the app: `npm run dev`
2. Click **Join Free** and register with your email
3. Go to **Supabase Dashboard → Table Editor → profiles**
4. Find your user row and set `role` to `admin`
5. Refresh the app — you now have admin access

---

## Step 6 — Seed Sample Deals (optional)

After completing Step 5:

1. Go to **Supabase → SQL Editor**
2. Find the commented seed block at the bottom of `bazodeal_schema.sql`
3. Go to **Table Editor → profiles**, copy your user's `id` (UUID)
4. Replace all instances of `<YOUR_ADMIN_UUID>` with your UUID
5. Uncomment the `INSERT INTO deals` block and run it

---

## Step 7 — Enable Email Confirmations (optional)

By default Supabase requires email confirmation for new accounts.

To disable it during development:
**Authentication → Email → Confirm Email → Off**

For production, leave it on and configure your SMTP settings.

---

## Project Structure

```
src/
├── lib/
│   └── supabaseClient.js   Supabase client instance
├── App.jsx                 Full application (all views)
└── main.jsx                React entry point
```

---

## Database Schema Overview

| Table        | Description                              |
|--------------|------------------------------------------|
| `profiles`   | User accounts (extends Supabase auth)    |
| `deals`      | All deals — approved and pending         |
| `likes`      | User ↔ deal many-to-many likes           |
| `cart_items` | Shopping cart (persisted per user)       |
| `orders`     | Completed orders                         |
| `order_items`| Line items with price snapshot at purchase|

---

## User Roles

| Role       | Can do                                              |
|------------|-----------------------------------------------------|
| `user`     | Browse, like, add to cart, checkout                 |
| `merchant` | Everything above + submit deals for admin review    |
| `admin`    | Everything above + approve/reject/delete any deal, see all users |

To promote any user to merchant or admin, update their `role` column in the `profiles` table via the Supabase dashboard.

---

## Real-time Features

The app subscribes to the `deals` table via Supabase Realtime. Any deal posted or approved by anyone will appear on all connected clients instantly — no page refresh needed.

---

## Deploying to Production

```bash
npm run build
```

Deploy the `dist/` folder to any static host:
- [Vercel](https://vercel.com) (recommended — zero config)
- [Netlify](https://netlify.com)
- [Cloudflare Pages](https://pages.cloudflare.com)

Add your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in your hosting dashboard.

---

## Paid checkout with Stripe (optional)

Bazodeal can take card payments through **Stripe Checkout** so money is collected before an order is written to the database. The browser never sees your Stripe secret key: a Supabase **Edge Function** builds the session from the signed-in user’s cart (same prices as the app), and a **webhook** creates `orders` / `order_items`, clears the cart, and lowers `deals.stock` after Stripe confirms payment.

### 1. Database

Run the `ALTER TABLE orders …` block in `bazodeal_schema.sql` (or run `src/bazodeal_schema.sql` on a fresh project). Existing projects need the new column:

- `orders.stripe_checkout_session_id` (nullable, unique when set)

### 2. Stripe

1. Create a [Stripe](https://stripe.com) account and get your **Secret key** (test mode is fine to start).
2. In **Developers → Webhooks → Add endpoint**, point to:

   `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`

   Select the event **`checkout.session.completed`**, then copy the **Signing secret** (`whsec_…`).

3. In Stripe **Settings → Business settings**, confirm your account can charge in your chosen currency (default below is **TTD**; override with `STRIPE_CURRENCY` if needed).

### 3. Supabase Edge Functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), link the project, then deploy:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy deal-sourcer-scan
```

The **Deal Sourcer** UI calls `deal-sourcer-scan`: it fetches HTML server-side (so the browser avoids CORS blocks) and extracts lines that look like promotions. Authenticated users only; no extra secrets beyond the usual Edge Function env.

**If the browser shows “Failed to fetch” when scanning:** the SPA could not complete a network call to Supabase’s host (extensions, flaky DNS, or strict `connect-src` CSP). Bazodeal now **automatically retries** via a **same-origin** proxy on deployments that ship `api/deal-sourcer-scan.js` (included for **Vercel**).

For that proxy to run on Vercel you must:

1. Deploy **`deal-sourcer-scan`** to Edge Functions (`supabase functions deploy deal-sourcer-scan`).
2. In **Vercel → Project → Settings → Environment Variables**, set **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`** for **Production** (and Preview if you test there). The serverless proxy reads the same vars at runtime even though they begin with `VITE_`; without them `/api/deal-sourcer-scan` returns 500.
3. Redeploy the frontend so Vercel picks up **`api/deal-sourcer-scan.js`**.

Disable the proxy fallback with **`VITE_DEAL_SOURCER_PROXY=false`** if you troubleshoot only direct calls.

In **Project Settings → Edge Functions → Secrets** (or via CLI), set:

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret (`sk_test_…` or `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_…`) |
| `PUBLIC_SITE_URL` | Your deployed site origin with **no** trailing slash (e.g. `https://bazodeal.vercel.app`) — used for Stripe success/cancel redirects |
| `STRIPE_CURRENCY` | Optional; default `ttd` |

`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are usually injected automatically for Edge Functions.

The repo includes `supabase/config.toml` with **`verify_jwt = false`** for `stripe-webhook` so Stripe can call it without a Supabase JWT.

### 4. Frontend

In `.env`:

```bash
VITE_USE_STRIPE_CHECKOUT=true
```

Rebuild or restart `npm run dev`. The cart **Pay** button calls `create-checkout-session` and redirects to Stripe. With this unset or `false`, checkout keeps the previous behaviour (order created immediately without payment — useful only for demos).

---

## Security Checklist Before Going Live

- [ ] Enable email confirmation in Supabase Auth settings
- [ ] Set up custom SMTP for transactional emails
- [ ] Review all RLS policies in `bazodeal_schema.sql`
- [ ] Use environment variables — never hardcode keys
- [ ] Set a strong database password in Supabase project settings
- [ ] Enable 2FA on your Supabase account
