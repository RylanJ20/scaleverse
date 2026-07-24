import "server-only";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// One auth check per request: every dynamic hole (header, gates, actions)
// shares this via React cache() instead of each doing its own network
// getUser() round trip.
export const getViewer = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
