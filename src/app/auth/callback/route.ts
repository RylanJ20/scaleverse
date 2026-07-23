import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autoAssignDiscordUsername } from "@/lib/discord-username";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/one-piece/arena";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Discord users arrive with an email but no username. Try to adopt their
      // Discord handle automatically; only fall back to the manual picker if it
      // can't be claimed (unusable handle, or every variant already taken).
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();
        if (!profile?.username) {
          const claimed = await autoAssignDiscordUsername(user.id, user.user_metadata);
          if (!claimed) {
            return NextResponse.redirect(
              `${origin}/choose-username?next=${encodeURIComponent(next)}`,
            );
          }
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
