"use client";

// Route-level loading states. The spec asks for skeletons rather than a bare
// spinner on full pages (SPEC 11.4), so the page keeps its shape and the SMIF
// mark turns quietly at the top to show that something is happening.
//
// Each one is shaped and titled like the page being opened, so a detail page
// never flashes its list's skeleton: PageLoading for a page whose title is
// known up front ("Meetings"), DetailLoading for one titled by its record (a
// holding, a pitch, a sector), with the real "← Holdings" link already in
// place, and FundLoading/AdminLoading, which read the address to pick the
// right shape and title. Client components because loading files get no
// params: the fund and the page come from the URL, which already shows the
// page being opened while its loading state is up.

import { useParams, usePathname } from "next/navigation";
import { SmifSpinner } from "@/components/ui/SmifSpinner";
import {
  DashboardSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/ui/Skeleton";
import { BackLink } from "@/components/ui/PageHeader";

/** The list a detail page belongs to: its sidebar name and its path in the fund. */
interface BackTo {
  label: string;
  path: string;
}

function LoadingBack({ back }: { back: BackTo }) {
  const { fund } = useParams<{ fund: string }>();
  return (
    <div className="mb-1">
      <BackLink href={`/${fund}/${back.path}`} label={back.label} />
    </div>
  );
}

export function PageLoading({
  title,
  rows = 6,
  back,
}: {
  title: string;
  rows?: number;
  back?: BackTo;
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        {back && <LoadingBack back={back} />}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          <SmifSpinner size="sm" label={`Loading ${title.toLowerCase()}`} />
        </div>
      </div>
      <div className="glass-card space-y-3 p-4 sm:p-6">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * A record's page before the record arrives: the way back, a title-sized
 * bar, a row of figures and a card. Neutral enough for a holding, a pitch or
 * a sector.
 */
export function DetailLoading({
  back,
  what,
}: {
  back?: BackTo;
  /** For screen readers: "Loading holding". */
  what: string;
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        {back && <LoadingBack back={back} />}
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-56 max-w-[70%]" />
          <SmifSpinner size="sm" label={`Loading ${what}`} />
        </div>
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="glass-card space-y-3 p-4 sm:p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A page whose title isn't known until it arrives. */
function UntitledLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-56 max-w-[70%]" />
        <SmifSpinner size="sm" label="Loading" />
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}

/** Fund admin pages' H1s, by the segment after /admin ("" is the checklist). */
const ADMIN_TITLES: Record<string, string> = {
  "": "Checklist",
  tickets: "Manage tickets",
  holdings: "Manage holdings",
  pitches: "Manage pitches",
  sectors: "Manage sectors",
  attendance: "Manage meetings",
  updates: "Manage updates",
  members: "Manage members",
  year: "Academic year",
  settings: "Fund settings",
  audit: "Audit log",
};

/**
 * A Fund admin page on its way, titled with that page's H1. A member's
 * editor is titled by the member, so it gets a bar. `tabs` also draws the
 * tab row, for when the admin layout that holds the real tabs hasn't
 * arrived yet either.
 */
export function AdminLoading({ tabs = false }: { tabs?: boolean }) {
  // /athena/admin/holdings → ["holdings"]
  const rest = usePathname().split("/").filter(Boolean).slice(2);
  const key = rest.length <= 1 ? (rest[0] ?? "") : null;
  const title =
    key !== null && Object.hasOwn(ADMIN_TITLES, key) ? ADMIN_TITLES[key] : null;
  return (
    <div className="space-y-6">
      {/* Roughly AdminNav: its heading, then a menu on a phone or the
          grouped tabs on a wider screen. */}
      {tabs && (
        <div className="border-b border-card-border pb-3">
          <div className="flex items-center gap-3 sm:mb-2">
            <Skeleton className="h-5 w-24 shrink-0" />
            <Skeleton className="h-9 flex-1 sm:hidden" />
          </div>
          <div className="hidden gap-2 overflow-hidden pt-5 sm:flex">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 shrink-0" />
            ))}
          </div>
        </div>
      )}
      {title ? <PageLoading title={title} /> : <UntitledLoading />}
    </div>
  );
}

/**
 * The fund-wide loading state. It stands in for whatever below it is still
 * on its way, a section's own layout included, so it can't assume the
 * dashboard: Fund admin's layout takes a moment to check access, and the
 * dashboard's tiles and chart used to flash there.
 */
export function FundLoading() {
  const sub = usePathname().split("/").filter(Boolean).slice(1);
  if (sub.length === 0) return <DashboardSkeleton />;
  if (sub[0] === "admin") return <AdminLoading tabs />;
  return <UntitledLoading />;
}
