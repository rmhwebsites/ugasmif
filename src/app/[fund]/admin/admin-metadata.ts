// Browser-tab titles for Fund admin pages. A page only names itself once
// the viewer passes that section's gate, so a refused visit reads as the
// fund's plain title rather than announcing the page.

import type { Metadata } from "next";
import { getFundContext } from "@/lib/fund";
import { canOpenAdminSection, type AdminSection } from "@/lib/permissions";

export function adminTitle(section: AdminSection, title: string) {
  return async function generateMetadata({
    params,
  }: {
    params: Promise<{ fund: string }>;
  }): Promise<Metadata> {
    const { fund } = await params;
    const ctx = await getFundContext(fund);
    return ctx && canOpenAdminSection(ctx, section) ? { title } : {};
  };
}
