// /[fund]/pitches — every pitch with a status filter (SPEC 11.2). Officers
// see a Schedule shortcut on submitted pitches. Server component; the filter
// chips are plain links driven by ?status=.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, isOfficer } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/EmptyState";
import { PitchCard, type PitchListItem } from "@/components/pitch/PitchCard";
import type { PitchStatus } from "@/types/domain";

const STATUSES: { key: PitchStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "voting", label: "Voting" },
  { key: "passed", label: "Passed" },
  { key: "failed", label: "Failed" },
  { key: "executed", label: "Executed" },
  { key: "withdrawn", label: "Withdrawn" },
];

export default async function PitchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ fund: slug }, { status }] = await Promise.all([params, searchParams]);
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const { supabase } = await getAuthState();
  const { data } = await supabase
    .from("pitches")
    .select("*, sector:sectors(name), author:profiles!author_id(full_name)")
    .eq("fund_id", ctx.fund.id)
    .order("created_at", { ascending: false });
  const pitches = (data as unknown as PitchListItem[] | null) ?? [];

  const filter = STATUSES.some((s) => s.key === status) ? (status as PitchStatus | "all") : "all";
  const filtered =
    filter === "all" ? pitches : pitches.filter((p) => p.status === filter);
  const countByStatus = new Map<string, number>();
  for (const p of pitches) {
    countByStatus.set(p.status, (countByStatus.get(p.status) ?? 0) + 1);
  }

  const officer = isOfficer(ctx);
  const canDraft = can(ctx, "draft_pitch");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Pitches</h1>
          <p className="text-xs text-muted sm:text-sm">
            Draft → submitted → scheduled → voting → passed → executed
          </p>
        </div>
        {canDraft && (
          <Link
            href={`/${slug}/pitches/new`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" /> New pitch
          </Link>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUSES.map((s) => {
          const count = s.key === "all" ? pitches.length : (countByStatus.get(s.key) ?? 0);
          const active = filter === s.key;
          return (
            <Link
              key={s.key}
              href={s.key === "all" ? `/${slug}/pitches` : `/${slug}/pitches?status=${s.key}`}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-accent text-white"
                  : "bg-highlight text-muted hover:text-foreground"
              }`}
            >
              {s.label}
              {count > 0 && (
                <span className={`ml-1 tabular-nums ${active ? "text-white/80" : ""}`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        pitches.length === 0 ? (
          <EmptyState
            title="No pitches yet"
            hint="Sector teams start pitches from here or from their sector page. Draft one, attach the deck, and your sector leader submits it for a class date."
            action={
              canDraft ? (
                <Link
                  href={`/${slug}/pitches/new`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <Plus className="h-4 w-4" /> Start the first pitch
                </Link>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            title={`No ${filter} pitches`}
            hint="Try another status filter, or switch back to All to see everything."
          />
        )
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <PitchCard key={p.id} pitch={p} fund={slug} showSchedule={officer} />
          ))}
        </div>
      )}
    </div>
  );
}
