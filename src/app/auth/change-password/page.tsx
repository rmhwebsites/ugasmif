import { SmifLogo } from "@/components/icons/SmifLogo";
import { PasswordForm } from "@/components/auth/PasswordForm";

export const metadata = { title: "Change password" };

export default function ChangePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <PasswordForm
          title="Change your password"
          subtitle="An officer set a temporary password on your account. Pick a new one before continuing."
          submitLabel="Change password"
          clearMustChange
        />
      </div>
    </main>
  );
}
