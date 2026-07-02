import { createClient } from "@supabase/supabase-js";

// Cookie-free anon client for viewer-independent pages (e.g. matchup pages).
// Because it never calls cookies()/headers(), the page's per-user data (auth,
// "your pick") stays out of the server render — that lives client-side. It reads
// only public (RLS select: true) data, never anything per-user.
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
}
