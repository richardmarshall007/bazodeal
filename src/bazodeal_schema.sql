-- ============================================================
--  BAZODEAL — Supabase PostgreSQL Schema
--  Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══════════════════════════════════════════════════════════════
--  STORAGE BUCKETS
-- ══════════════════════════════════════════════════════════════

-- Create storage bucket for deal images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-images',
  'deal-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for deal-images bucket
CREATE POLICY "Deal images are publicly accessible"
  ON storage.objects FOR SELECT USING (bucket_id = 'deal-images');

CREATE POLICY "Authenticated users can upload deal images"
  ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = 'deal-images'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Users can update own deal images"
  ON storage.objects FOR UPDATE USING (
    bucket_id = 'deal-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own deal images"
  ON storage.objects FOR DELETE USING (
    bucket_id = 'deal-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ══════════════════════════════════════════════════════════════
--  TABLES
-- ══════════════════════════════════════════════════════════════

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name        TEXT        NOT NULL,
  phone       TEXT,
  dob_month   CHAR(2),
  dob_year    CHAR(4),
  gender      TEXT,
  interests   TEXT[]      DEFAULT '{}',
  role        TEXT        NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user', 'merchant', 'admin')),
  concurrent_deals_limit INTEGER NOT NULL DEFAULT 1 CHECK (concurrent_deals_limit >= 1),
  can_post_deals BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Existing DBs: add the concurrency limit column if it doesn't exist yet.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS concurrent_deals_limit INTEGER NOT NULL DEFAULT 1;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_post_deals BOOLEAN NOT NULL DEFAULT false;

-- Deals
CREATE TABLE IF NOT EXISTS deals (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title         TEXT        NOT NULL,
  merchant_id   UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  merchant_name TEXT        NOT NULL,
  category      TEXT        NOT NULL DEFAULT 'Electronics',
  emoji         TEXT        DEFAULT '🛍️',
  retail_price  NUMERIC(12,2) NOT NULL CHECK (retail_price > 0),
  discount_pct  NUMERIC(5,2)  NOT NULL CHECK (discount_pct > 0 AND discount_pct < 100),
  description   TEXT,
  stock         INTEGER     DEFAULT 99  CHECK (stock >= 0),
  expires_at    DATE,
  approved      BOOLEAN     DEFAULT FALSE,
  like_count    INTEGER     DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Optional columns (existing projects): primary listing image + ordered gallery for detail lightbox
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

-- Likes (many-to-many users ↔ deals)
CREATE TABLE IF NOT EXISTS likes (
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id    UUID REFERENCES deals(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, deal_id)
);

-- Merchant QR: customers follow a store (signup / opt-in for WhatsApp welcome via Edge Function)
CREATE TABLE IF NOT EXISTS merchant_follows (
  id              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  follower_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  merchant_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source          TEXT        NOT NULL DEFAULT 'qr',
  whatsapp_opt_in BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, merchant_id),
  CONSTRAINT merchant_follows_no_self CHECK (follower_id IS DISTINCT FROM merchant_id)
);

CREATE INDEX IF NOT EXISTS merchant_follows_follower_idx ON merchant_follows (follower_id);
CREATE INDEX IF NOT EXISTS merchant_follows_merchant_idx ON merchant_follows (merchant_id);

-- WhatsApp-first signup (Twilio inbound → admin user + follow); no direct client access.
CREATE TABLE IF NOT EXISTS merchant_whatsapp_invites (
  code         TEXT PRIMARY KEY,
  merchant_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS whatsapp_signup_states (
  phone_e164      TEXT PRIMARY KEY,
  merchant_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  step            SMALLINT NOT NULL DEFAULT 1,
  pending_email   TEXT,
  pending_name    TEXT,
  created_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS whatsapp_signup_states_merchant_idx ON whatsapp_signup_states (merchant_id);
CREATE INDEX IF NOT EXISTS merchant_whatsapp_invites_merchant_idx ON merchant_whatsapp_invites (merchant_id);
ALTER TABLE merchant_whatsapp_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_signup_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "merchant_whatsapp_invites_no_client" ON merchant_whatsapp_invites FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "whatsapp_signup_states_no_client" ON whatsapp_signup_states FOR ALL USING (false) WITH CHECK (false);

-- Events (community / store calendar — same posting gate as deals: admin or can_post_deals)
CREATE TABLE IF NOT EXISTS events (
  id              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title           TEXT        NOT NULL,
  description     TEXT,
  venue           TEXT,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,
  organizer_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organizer_name  TEXT      NOT NULL,
  image_url       TEXT,
  approved        BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events (starts_at DESC);
CREATE INDEX IF NOT EXISTS events_organizer_idx ON events (organizer_id);

-- Cart items
CREATE TABLE IF NOT EXISTS cart_items (
  id       UUID    DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id  UUID    REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id  UUID    REFERENCES deals(id)   ON DELETE CASCADE,
  qty      INTEGER DEFAULT 1 CHECK (qty > 0),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, deal_id)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id         UUID    DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id    UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  total      NUMERIC(12,2) NOT NULL,
  status     TEXT    DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','shipped','delivered','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order line items (snapshot prices at time of purchase)
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID    DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id     UUID    REFERENCES orders(id) ON DELETE CASCADE,
  deal_id      UUID    REFERENCES deals(id)  ON DELETE SET NULL,
  deal_title   TEXT    NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  unit_price   NUMERIC(12,2) NOT NULL,
  retail_price NUMERIC(12,2) NOT NULL,
  discount_pct NUMERIC(5,2)  NOT NULL
);

-- Stripe Checkout (optional): idempotent webhook handling
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_checkout_session_id_key
  ON orders (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Count active deals for concurrency checks. SECURITY DEFINER avoids RLS recursion when
-- called from the deals INSERT policy (a plain subquery on deals would re-enter policies).
CREATE OR REPLACE FUNCTION public.merchant_active_deal_count(p_merchant_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(*)::integer
  FROM public.deals d
  WHERE d.merchant_id = p_merchant_id
    AND d.approved = true
    AND (d.expires_at IS NULL OR d.expires_at >= current_date);
$$;

REVOKE ALL ON FUNCTION public.merchant_active_deal_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchant_active_deal_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_active_deal_count(uuid) TO service_role;

-- ══════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ── Profiles ────────────────────────────────────────────────
CREATE POLICY "Anyone can read profiles"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins update any member profile"
  ON profiles FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── Deals ───────────────────────────────────────────────────
-- Approved deals: visible to everyone
-- Unapproved: only visible to the posting merchant or admins
CREATE POLICY "Deals are selectable based on role"
  ON deals FOR SELECT USING (
    approved = true
    OR auth.uid() = merchant_id
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Authenticated users can post deals"
  ON deals FOR INSERT WITH CHECK (
    auth.uid() = merchant_id
    AND (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
      OR
      (
        EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.can_post_deals = true
        )
        AND
        GREATEST(
          COALESCE(
            (SELECT p.concurrent_deals_limit FROM profiles p WHERE p.id = auth.uid()),
            1
          ),
          1
        ) > public.merchant_active_deal_count(auth.uid())
      )
    )
  );

CREATE POLICY "Merchants update own deals; admins update all"
  ON deals FOR UPDATE USING (
    auth.uid() = merchant_id
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete deals"
  ON deals FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── Likes ───────────────────────────────────────────────────
CREATE POLICY "Likes are public"
  ON likes FOR SELECT USING (true);

CREATE POLICY "Users manage own likes"
  ON likes FOR ALL USING (auth.uid() = user_id);

-- ── Merchant follows (QR signup / store audience) ──────────
CREATE POLICY "Follows readable by follower or merchant or admin"
  ON merchant_follows FOR SELECT USING (
    follower_id = auth.uid()
    OR merchant_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users insert own follows"
  ON merchant_follows FOR INSERT WITH CHECK (follower_id = auth.uid());

CREATE POLICY "Users delete own follows"
  ON merchant_follows FOR DELETE USING (follower_id = auth.uid());

-- ── Events ──────────────────────────────────────────────────
CREATE POLICY "Events readable when approved or own or admin"
  ON events FOR SELECT USING (
    approved = true
    OR auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Who can post can create events"
  ON events FOR INSERT WITH CHECK (
    auth.uid() = organizer_id
    AND (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.can_post_deals = true)
    )
  );

CREATE POLICY "Organizers update own events or admin"
  ON events FOR UPDATE USING (
    auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Organizers delete own events or admin"
  ON events FOR DELETE USING (
    auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Cart items ──────────────────────────────────────────────
CREATE POLICY "Users manage own cart"
  ON cart_items FOR ALL USING (auth.uid() = user_id);

-- ── Orders ──────────────────────────────────────────────────
CREATE POLICY "Users see own orders"
  ON orders FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users place own orders"
  ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins see all orders"
  ON orders FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Order items ─────────────────────────────────────────────
CREATE POLICY "Users see own order items"
  ON order_items FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND orders.user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert own order items"
  ON order_items FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
        AND orders.user_id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════
--  FUNCTIONS & TRIGGERS
-- ══════════════════════════════════════════════════════════════

-- Auto-update like_count on deals when a like is added/removed
CREATE OR REPLACE FUNCTION update_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE deals SET like_count = like_count + 1 WHERE id = NEW.deal_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE deals SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.deal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_like_change ON likes;
CREATE TRIGGER on_like_change
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION update_like_count();

-- Auto-create profile row when a new user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, name, role, concurrent_deals_limit, can_post_deals)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'user',
    1,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Prevent non-admins from granting themselves posting rights or changing role via the client.
CREATE OR REPLACE FUNCTION public.profiles_enforce_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ) INTO is_admin;

  IF TG_OP = 'INSERT' THEN
    NEW.can_post_deals := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.id IS NOT DISTINCT FROM auth.uid() AND NOT is_admin THEN
    NEW.role := OLD.role;
    NEW.can_post_deals := OLD.can_post_deals;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_privileged_fields ON profiles;
CREATE TRIGGER profiles_enforce_privileged_fields
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_enforce_privileged_fields();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ══════════════════════════════════════════════════════════════
--  SEED DATA — Sample deals (optional, run separately)
--  First create your admin user via Supabase Auth,
--  then get their UUID from auth.users and paste below.
-- ══════════════════════════════════════════════════════════════

-- Step 1: Set your admin user's role (replace <YOUR_ADMIN_UUID>)
-- UPDATE profiles SET role = 'admin' WHERE id = '<YOUR_ADMIN_UUID>';

-- Step 2: Seed sample deals (replace <YOUR_ADMIN_UUID>)
/*
INSERT INTO deals (title, merchant_id, merchant_name, category, emoji, retail_price, discount_pct, description, stock, expires_at, approved) VALUES
  ('Apple AirPods Pro (2nd Gen)', '<YOUR_ADMIN_UUID>', 'TechZone TT', 'Electronics', '🎧', 2499.00, 38, 'Active noise cancellation, Adaptive Transparency, and Personalized Spatial Audio.', 8,  '2026-05-30', true),
  ('Nike Air Max 270',            '<YOUR_ADMIN_UUID>', 'SneakerHub',  'Fashion',     '👟', 899.00,  50, 'Iconic Air Max cushioning meets bold street style. Lightweight mesh upper.',       22, '2026-06-05', true),
  ('Dyson V15 Detect Vacuum',     '<YOUR_ADMIN_UUID>', 'HomeGadgets', 'Home & Garden','🌀', 3299.00, 42, 'Laser reveals microscopic dust. Piezo sensor counts particles in real-time.',    5,  '2026-05-20', true),
  ('Samsung 65" QLED 4K TV',      '<YOUR_ADMIN_UUID>', 'ElectroMart', 'Electronics', '📺', 7999.00, 35, 'Quantum Dot tech, 120Hz refresh, Dolby Atmos sound.',                            3,  '2026-05-25', true),
  ('Instant Pot Duo 7-in-1',      '<YOUR_ADMIN_UUID>', 'KitchenPro',  'Home & Garden','🍲', 699.00,  55, 'Pressure cooker, slow cooker, rice cooker, steamer, sauté pan and more.',       30, '2026-06-15', true),
  ('Levi''s 501 Original Jeans',  '<YOUR_ADMIN_UUID>', 'DenimWorld',  'Fashion',     '👖', 450.00,  40, 'The original straight-leg jean and timeless American style since 1873.',         45, '2026-07-01', true),
  ('Garmin Forerunner 265',        '<YOUR_ADMIN_UUID>', 'SportsTT',    'Sports',      '⌚', 2299.00, 30, 'AMOLED display, training readiness score, HRV status, performance metrics.',     12, '2026-06-10', true),
  ('L''Oreal Revitalift 1.5% HA', '<YOUR_ADMIN_UUID>', 'BeautyBar',   'Beauty',      '✨', 320.00,  60, 'Concentrated pure hyaluronic acid visibly plumps skin in just 1 week.',          60, '2026-06-20', true);
*/

-- ══════════════════════════════════════════════════════════════
--  USEFUL VIEWS (optional helpers)
-- ══════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS profiles_with_email CASCADE;
CREATE VIEW profiles_with_email AS
SELECT
  p.id,
  p.name,
  p.phone,
  p.dob_month,
  p.dob_year,
  p.gender,
  p.interests,
  p.role,
  p.created_at,
  au.email,
  p.concurrent_deals_limit,
  p.can_post_deals
FROM profiles p
JOIN auth.users au ON au.id = p.id;

DROP VIEW IF EXISTS deals_with_savings CASCADE;
CREATE VIEW deals_with_savings AS
SELECT
  *,
  ROUND(retail_price * (1 - discount_pct / 100), 2) AS final_price,
  ROUND(retail_price * discount_pct / 100, 2)        AS savings
FROM deals;

DROP VIEW IF EXISTS order_summary CASCADE;
CREATE VIEW order_summary AS
SELECT
  o.id,
  o.created_at,
  o.total,
  o.status,
  p.name AS customer_name,
  COUNT(oi.id) AS item_count
FROM orders o
JOIN profiles p ON p.id = o.user_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, p.name;

-- Grant select on views to authenticated users
GRANT SELECT ON profiles_with_email TO authenticated;
GRANT SELECT ON deals_with_savings TO authenticated;
GRANT SELECT ON order_summary TO authenticated;

GRANT SELECT, INSERT, DELETE ON merchant_follows TO authenticated;

GRANT SELECT ON events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO authenticated;
