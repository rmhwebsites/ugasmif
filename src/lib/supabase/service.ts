// Service-role client: bypasses RLS. Allowed ONLY in cron routes, roster
// import, admin password tools, and the backup (spec Section 9). A unit test
// greps for imports of this module outside those folders.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

export function createServiceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
