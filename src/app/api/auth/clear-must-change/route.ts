// Clears profiles.must_change_password after the user picks a new password
// on the forced change screen. Uses the service role because RLS blocks
// users from editing this column themselves (part of the admin password
// tooling, spec Section 7).

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
