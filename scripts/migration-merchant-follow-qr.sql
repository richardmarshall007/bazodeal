-- Merchant QR signup: customers follow a store and opt into WhatsApp welcome (Edge Function + Twilio).
-- Run in Supabase SQL Editor after reviewing.

-- ── Table: who follows which merchant (QR / future sources) ───────────────
CREATE TABLE IF NOT EXISTS public.merchant_follows (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  merchant_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'qr',
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT merchant_follows_unique UNIQUE (follower_id, merchant_id),
  CONSTRAINT merchant_follows_no_self CHECK (follower_id IS DISTINCT FROM merchant_id)
);

CREATE INDEX IF NOT EXISTS merchant_follows_follower_idx ON public.merchant_follows (follower_id);
CREATE INDEX IF NOT EXISTS merchant_follows_merchant_idx ON public.merchant_follows (merchant_id);

ALTER TABLE public.merchant_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Follows readable by follower or merchant or admin" ON public.merchant_follows;
CREATE POLICY "Follows readable by follower or merchant or admin"
  ON public.merchant_follows FOR SELECT USING (
    follower_id = auth.uid()
    OR merchant_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "Users insert own follows" ON public.merchant_follows;
CREATE POLICY "Users insert own follows"
  ON public.merchant_follows FOR INSERT WITH CHECK (follower_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own follows" ON public.merchant_follows;
CREATE POLICY "Users delete own follows"
  ON public.merchant_follows FOR DELETE USING (follower_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.merchant_follows TO authenticated;
