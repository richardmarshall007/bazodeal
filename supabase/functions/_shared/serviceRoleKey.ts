/**
 * Prefer SUPABASE_SECRET_KEYS (new API keys / JWT signing keys).
 * Fall back to legacy SUPABASE_SERVICE_ROLE_KEY when the new dict is absent.
 * @see https://supabase.com/docs/guides/functions/secrets
 */
export function getServiceRoleKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (typeof parsed.default === "string" && parsed.default.trim()) {
        return parsed.default.trim();
      }
      const first = Object.values(parsed).find((x) => typeof x === "string" && x.trim().length > 0);
      if (first) return first.trim();
    } catch {
      /* ignore invalid JSON */
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return legacy && legacy.trim().length > 0 ? legacy.trim() : null;
}
