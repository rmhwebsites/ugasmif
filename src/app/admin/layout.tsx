// App admin area (cross-fund). App admins only (SPEC 11.3).

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAuthState } from "@/lib/fund";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LogoutButton } from "@/components/auth/LogoutButton";

export default async function AppAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getAuthState();
  if (!user) redirect("/login");
  if (!profile?.is_app_admin) notFound();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-card-border bg-sticky px-4 py-2.5 backdrop-blur-xl sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <SmifLogo className="h-8 w-8" />
          <span className="font-semibold">SMIF Hub · App Admin</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
