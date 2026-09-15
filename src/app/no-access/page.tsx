import { SmifLogo } from "@/components/icons/SmifLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8 text-center">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <h1 className="mb-2 text-xl font-semibold">
          You&apos;re not on a roster yet
        </h1>
        <p className="mb-6 text-sm text-muted">
          Your account exists, but you don&apos;t have a membership in either
          fund for the current academic year. Ask a SMIF officer to add you to
          the roster.
        </p>
        <LogoutButton />
      </div>
    </main>
  );
}
