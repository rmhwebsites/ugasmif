"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export function LogoutButton({
  className = "",
  variant = "secondary",
  children = "Sign out",
}: {
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  children?: ReactNode;
} = {}) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant={variant} onClick={handleLogout} className={className}>
      {children}
    </Button>
  );
}
