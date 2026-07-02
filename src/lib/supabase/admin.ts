import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service client — bypasses RLS. Server code only; used for writes that are
// deliberately closed to clients (e.g. demo_votes).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}
