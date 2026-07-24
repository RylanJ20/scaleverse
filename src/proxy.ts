import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session refresh lives here — Server Components can't persist cookies (see
// src/lib/supabase/server.ts), so without this every getUser() after token
// expiry re-refreshes on every request. Refresh-only: this file makes NO auth
// decisions; pages/actions do their own getUser() and RLS is the enforcement.
export async function proxy(request: NextRequest) {
  // No Supabase auth cookie → nothing to refresh; keep anonymous traffic free.
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!hasAuthCookie) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getSession() costs no network while the access token is valid; once it
  // expires this refreshes it ONCE and persists the new cookies on both the
  // forwarded request and the response. Its return value must never be used
  // for authorization (unvalidated) — and it isn't.
  await supabase.auth.getSession();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
