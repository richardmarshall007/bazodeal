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

## Security Checklist Before Going Live

- [ ] Enable email confirmation in Supabase Auth settings
- [ ] Set up custom SMTP for transactional emails
- [ ] Review all RLS policies in `bazodeal_schema.sql`
- [ ] Use environment variables — never hardcode keys
- [ ] Set a strong database password in Supabase project settings
- [ ] Enable 2FA on your Supabase account
