// App admin area (cross-fund). App admins only (SPEC 11.3).

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthState } from "@/lib/fund";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ThemeSelector } from "@/components/layout/ThemeSelector";

export default async function AppAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getAuthState();
  if (!user) redirect("/login");
  if (!profile?.is_app_admin) notFound();

  // data-app-admin tells globals.css to hide the floating theme selector
  // (it sat over the page on phones); this page carries one in its header.
  return (
    <div className="min-h-screen" data-app-admin>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-card-border bg-sticky px-4 py-2.5 backdrop-blur-xl sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <SmifLogo className="h-8 w-8 shrink-0" />
          {/* Below 360px the theme selector and Sign out leave no room for
              the name, so the logo stands alone (the name stays readable to
              screen readers). */}
          <span className="truncate font-semibold max-[359px]:sr-only">
            SMIF Hub <span className="hidden sm:inline">· App admin</span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {/* Icons only on phones, so it fits beside Sign out; the labels
              stay for screen readers and each button keeps its tooltip. */}
          <div className="w-26 sm:w-56 max-sm:[&_[role=radio]>span]:sr-only">
            <ThemeSelector />
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
