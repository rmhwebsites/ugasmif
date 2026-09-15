import { SmifLogo } from "@/components/icons/SmifLogo";
import { PasswordForm } from "@/components/auth/PasswordForm";

export const metadata = { title: "Set your password" };

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <PasswordForm
          title="Welcome to SMIF Hub"
          subtitle="Choose a password to finish setting up your account."
          submitLabel="Set password and sign in"
        />
      </div>
    </main>
  );
}
