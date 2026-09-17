"use client";

import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_* values are inlined into the bundle at BUILD time, so a build
// that ran without them ships `undefined` to every visitor and no amount of
// fixing the variables afterwards helps until you redeploy. Naming the
// variable in the console beats "supabaseUrl is required".
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "SMIF Hub was built without NEXT_PUBLIC_SUPABASE_URL / " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Add them in Vercel under " +
        "Project Settings -> Environment Variables and redeploy — these are " +
        "baked in at build time, so changing them alone is not enough."
    );
  }
  return createBrowserClient(url, key);
}
