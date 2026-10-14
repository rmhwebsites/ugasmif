"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function LogoutButton({
  className = "",
  variant = "secondary",
  children = "Sign out",
  label,
}: {
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  children?: ReactNode;
  /** Accessible name and tooltip, for an icon-only button. */
  label?: string;
} = {}) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      variant={variant}
      onClick={handleLogout}
      className={className}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}
