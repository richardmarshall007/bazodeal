-- Let any signed-in member submit deals (approved=false until admin enables posting).
-- Run in Supabase SQL Editor after deploying the updated frontend.

-- Prevent merchants from self-approving deals via API
CREATE OR REPLACE FUNCTION public.deals_enforce_approved_field()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  is_admin boolean;
  may_post_live boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) INTO is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR p.can_post_deals = true)
  ) INTO may_post_live;

  IF TG_OP = 'INSERT' THEN
    IF NOT may_post_live THEN
      NEW.approved := false;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT is_admin THEN
    NEW.approved := OLD.approved;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_enforce_approved_field ON public.deals;
CREATE TRIGGER deals_enforce_approved_field
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_enforce_approved_field();

DROP POLICY IF EXISTS "Authenticated users can post deals" ON public.deals;
CREATE POLICY "Authenticated users can post deals"
  ON public.deals FOR INSERT WITH CHECK (
    auth.uid() = merchant_id
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.can_post_deals = true)
        AND GREATEST(
          COALESCE((SELECT p.concurrent_deals_limit FROM public.profiles p WHERE p.id = auth.uid()), 1),
          1
        ) > public.merchant_active_deal_count(auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role <> 'admin'
          AND COALESCE(p.can_post_deals, false) = false
      )
    )
  );
