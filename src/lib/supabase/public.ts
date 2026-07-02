import { createClient } from "@supabase/supabase-js";

// Cookie-free anon client for cacheable (ISR) pages. Because it never calls
// cookies()/headers(), pages using it can be statically rendered and revalidated.
// It reads only public (RLS select: true) data — never anything per-user.
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
}
