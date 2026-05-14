-- WhatsApp-first signup: merchant mints a code; customer WhatsApps JOIN <code>;
-- Edge Function twilio-whatsapp-inbound collects email + name and creates auth user + follow.
-- Run in Supabase SQL Editor after deploying the two Edge Functions.

CREATE TABLE IF NOT EXISTS public.merchant_whatsapp_invites (
  code         TEXT PRIMARY KEY,
  merchant_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_signup_states (
  phone_e164      TEXT PRIMARY KEY,
  merchant_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  step            SMALLINT NOT NULL DEFAULT 1,
  pending_email   TEXT,
  pending_name    TEXT,
  created_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_signup_states_merchant_idx ON public.whatsapp_signup_states (merchant_id);
CREATE INDEX IF NOT EXISTS merchant_whatsapp_invites_merchant_idx ON public.merchant_whatsapp_invites (merchant_id);

ALTER TABLE public.merchant_whatsapp_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_signup_states ENABLE ROW LEVEL SECURITY;

-- No client access — Edge Functions use service_role.
CREATE POLICY "merchant_whatsapp_invites_no_client"
  ON public.merchant_whatsapp_invites FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "whatsapp_signup_states_no_client"
  ON public.whatsapp_signup_states FOR ALL USING (false) WITH CHECK (false);
