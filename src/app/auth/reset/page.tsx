import { SmifLogo } from "@/components/icons/SmifLogo";
import { PasswordForm } from "@/components/auth/PasswordForm";

export const metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <SmifLogo className="mx-auto mb-6 h-16 w-16" />
        <PasswordForm
          title="Reset your password"
          subtitle="Choose a new password for your SMIF Hub account."
          submitLabel="Save new password"
        />
      </div>
    </main>
  );
}
