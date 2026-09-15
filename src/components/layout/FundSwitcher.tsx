"use client";

// Two-segment Athena | Arch control (spec Section 10). Only segments the
// user can access are enabled; switching preserves the sub-route.

import { usePathname, useRouter } from "next/navigation";
import type { FundSlug } from "@/types/domain";

const FUND_LABELS: Record<FundSlug, string> = {
  athena: "Athena",
  arch: "Arch",
};

// Sub-routes that exist in both funds; anything else lands on the dashboard.
const SHARED_ROOTS = [
  "holdings",
  "sectors",
  "pitches",
  "votes",
  "trades",
  "performance",
  "updates",
  "team",
  "attendance",
  "profile",
  "admin",
];

export function FundSwitcher({
  current,
  accessible,
}: {
  current: FundSlug;
  accessible: FundSlug[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(slug: FundSlug) {
    if (slug === current || !accessible.includes(slug)) return;
    const segments = pathname.split("/").filter(Boolean);
    const sub = segments.slice(1);
    const target =
      sub.length > 0 && SHARED_ROOTS.includes(sub[0])
        ? `/${slug}/${sub.join("/")}`
        : `/${slug}`;
    document.cookie = `smif_fund=${slug};path=/;max-age=31536000;samesite=lax`;
    router.push(target);
  }

  return (
    <div className="flex rounded-lg border border-input-border bg-input-bg p-0.5">
      {(Object.keys(FUND_LABELS) as FundSlug[]).map((slug) => {
        const enabled = accessible.includes(slug);
        const active = slug === current;
        return (
          <button
            key={slug}
            type="button"
            disabled={!enabled}
            onClick={() => switchTo(slug)}
            title={
              enabled
                ? `${FUND_LABELS[slug]} ${slug === "athena" ? "Stock" : "Bond"} Fund`
                : `You are not on the ${FUND_LABELS[slug]} roster.`
            }
            className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              active
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {FUND_LABELS[slug]}
          </button>
        );
      })}
    </div>
  );
}
