"use client";

// Shown inside the fund's sidebar whenever a fund page calls notFound(): an
// address that does not exist, a record that was deleted, or a page this
// role cannot open (pages answer "not found" rather than "forbidden" so they
// don't confirm what exists). The sidebar stays, so every section is still
// one click away; the links below cover the usual next steps: home, and the
// section the address belongs to (Holdings for a missing holding, Trades for
// Manage tickets).

import { usePathname } from "next/navigation";
import { LinkButton, PageHeader } from "@/components/ui/PageHeader";
import {
  ADMIN_CONTENT_PAGE,
  PAGE_NAMES,
} from "@/components/layout/fundNav";

/** The member page this address belongs to, or null if there is none. */
function sectionFor(segments: string[]): string | null {
  const [first, second] = segments;
  if (!first) return null;
  if (first === "admin") {
    const page = ADMIN_CONTENT_PAGE[second ? `admin/${second}` : "admin"];
    return page || null;
  }
  return Object.hasOwn(PAGE_NAMES, first) && first !== "profile"
    ? first
    : null;
}

export default function FundNotFound() {
  const [fund = "", ...rest] = usePathname().split("/").filter(Boolean);
  const section = sectionFor(rest);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Page not found"
        description="This page doesn't exist, or it isn't open to your role. Everything you can open is in the menu."
      />
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/${fund}`}>Back to the dashboard</LinkButton>
        {section ? (
          <LinkButton href={`/${fund}/${section}`} variant="secondary">
            {PAGE_NAMES[section]}
          </LinkButton>
        ) : (
          <>
            <LinkButton href={`/${fund}/pitches`} variant="secondary">
              Pitches
            </LinkButton>
            <LinkButton href={`/${fund}/holdings`} variant="secondary">
              Holdings
            </LinkButton>
          </>
        )}
      </div>
    </div>
  );
}
