// Session refresh + auth gate (Next 16 proxy, formerly middleware).
// Refreshes the Supabase session cookie on every request, redirects
// unauthenticated users to /login, and forces /auth/change-password when an
// officer set a temporary password (spec Section 7).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = [
  "/login",
  "/auth/confirm",
  "/auth/set-password",
  "/auth/reset",
];

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser() —
  // the call refreshes the session cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Two first-run gates, in order of urgency: an officer-set temporary
  // password must be replaced before anything else, then onboarding collects
  // the details the roster import could not know.
  if (user && !isPublic) {
    const onChangePassword = pathname.startsWith("/auth/change-password");
    const onOnboarding = pathname.startsWith("/onboarding");

    const gateQuery = await supabase
      .from("profiles")
      .select("must_change_password, onboarded_at")
      .eq("id", user.id)
      .maybeSingle();
    let profile = gateQuery.data;
    const error = gateQuery.error;

    // Before migration 0003 there is no onboarded_at column. Fall back rather
    // than let a pending migration quietly disable the password gate too.
    if (error) {
      const fallback = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", user.id)
        .maybeSingle();
      profile = fallback.data
        ? { ...fallback.data, onboarded_at: new Date().toISOString() }
        : null;
    }

    if (profile?.must_change_password && !onChangePassword) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/change-password";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (
      profile &&
      !profile.must_change_password &&
      !profile.onboarded_at &&
      !onOnboarding
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except API routes (they do their own auth), static files,
    // and PWA assets.
    "/((?!api/|_next/static|_next/image|favicon|icon-|apple-touch-icon|logo.svg|manifest.json|sw.js|theme-init.js|.*\\.png$).*)",
  ],
};
