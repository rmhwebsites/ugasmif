"use client";

// Remembers the last fund used so "/" can land there next time.
// Server components can't set cookies, so this runs on the client.

import { useEffect } from "react";
import type { FundSlug } from "@/types/domain";

export function FundCookie({ fund }: { fund: FundSlug }) {
  useEffect(() => {
    document.cookie = `smif_fund=${fund};path=/;max-age=31536000;samesite=lax`;
  }, [fund]);
  return null;
}
