// Lands Supabase email links (invite, recovery, email change). The Supabase
// email templates are customized to point here with token_hash + type; this
// verifies the OTP server-side (setting the session cookie) and forwards to
// the right screen.

import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      redirectTo.pathname =
        next && next.startsWith("/")
          ? next
          : type === "invite"
          ? "/auth/set-password"
          : type === "recovery"
          ? "/auth/reset"
          : "/";
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", "link-expired");
  return NextResponse.redirect(redirectTo);
}
