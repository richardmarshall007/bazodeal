-- Events calendar: same posting permission as deals (admin OR can_post_deals).
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  description     TEXT,
  venue           TEXT,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,
  organizer_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organizer_name  TEXT NOT NULL,
  image_url       TEXT,
  approved        BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON public.events (starts_at DESC);
CREATE INDEX IF NOT EXISTS events_organizer_idx ON public.events (organizer_id);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Events readable when approved or own or admin" ON public.events;
CREATE POLICY "Events readable when approved or own or admin"
  ON public.events FOR SELECT USING (
    approved = true
    OR auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Who can post can create events" ON public.events;
CREATE POLICY "Who can post can create events"
  ON public.events FOR INSERT WITH CHECK (
    auth.uid() = organizer_id
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.can_post_deals = true)
    )
  );

DROP POLICY IF EXISTS "Organizers update own events or admin" ON public.events;
CREATE POLICY "Organizers update own events or admin"
  ON public.events FOR UPDATE USING (
    auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Organizers delete own events or admin" ON public.events;
CREATE POLICY "Organizers delete own events or admin"
  ON public.events FOR DELETE USING (
    auth.uid() = organizer_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

GRANT SELECT ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
