// User-scoped Supabase client for Server Components and route handlers.
// Every query through this client runs under RLS as the signed-in user —
// this is the default client for all app code (spec Section 9).

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/env";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  const { url, key } = supabasePublicConfig();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — session refresh is handled
          // by src/proxy.ts, so ignoring the write is safe.
        }
      },
    },
  });
}
