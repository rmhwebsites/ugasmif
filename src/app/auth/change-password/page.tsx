import { SmifLogo } from "@/components/icons/SmifLogo";
import { PasswordForm } from "@/components/auth/PasswordForm";
import { LogoutButton } from "@/components/auth/LogoutButton";

export const metadata = { title: "Change password" };

// The proxy sends every page here while an officer-set temporary password is
// in place, carrying the page that was asked for as ?next. Sign out is the
// way off this screen for someone on the wrong account.
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <PasswordForm
          title="Change your password"
          subtitle="An officer set a temporary password on your account. Pick a new one before continuing."
          submitLabel="Change password"
          clearMustChange
          next={typeof next === "string" ? next : undefined}
        />
        <div className="mt-4 flex justify-center">
          <LogoutButton variant="ghost">Not you? Sign out</LogoutButton>
        </div>
      </div>
    </main>
  );
}
