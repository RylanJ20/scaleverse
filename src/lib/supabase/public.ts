import { createClient } from "@supabase/supabase-js";

// Cookie-free anon client for cacheable (ISR) pages. It reads only public
// (RLS select: true) data — never anything per-user.
//
// supabase-js sends `cache: "no-store"` on its requests, which would force the
// whole route to render dynamically and ignore `revalidate`. We strip that and
// tag requests with Next's revalidate so the REST calls join the Data Cache and
// the page can be statically cached / revalidated on an interval.
export function createPublicClient(revalidateSeconds = 300) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const next = init ? { ...init } : {};
          delete (next as { cache?: unknown }).cache;
          return fetch(input as RequestInfo, {
            ...next,
            next: { revalidate: revalidateSeconds },
          });
        },
      },
    },
  );
}
