// /[fund]/pitches: the fund's research pipeline and its ballot box in one
// place (SPEC 11.2). A vote is a stage of a pitch, so open votes lead the
// page with the viewer's own ballot state, and the rest of the pipeline
// follows grouped by where each pitch stands. The status chips narrow to one
// stage; they are plain links driven by ?status=. A search box (?q=, over
// title, ticker and author) and a sector picker (?sector=<slug>) narrow the
// list too, and the chips keep both. Officers see a Schedule shortcut on
// submitted pitches, and whoever may submit a draft sees a Submit shortcut.
// Members read only their own ballots under RLS, which is exactly what the
// ballot state needs.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, canOpenAdminSection } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton, ManageLink, PageHeader } from "@/components/ui/PageHeader";
import { PitchCard, type PitchListItem } from "@/components/pitch/PitchCard";
import { PitchFilters } from "@/components/pitch/PitchFilters";
import type { PitchStatus, Sector, VoteChoice } from "@/types/domain";

export const metadata: Metadata = { title: "Pitches" };

const STATUSES: { key: PitchStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "voting", label: "Voting" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "passed", label: "Passed" },
  { key: "failed", label: "Failed" },
  { key: "executed", label: "Executed" },
  { key: "withdrawn", label: "Withdrawn" },
];

// How the unfiltered list is grouped: what needs a vote now, what is still
// on its way to a vote, what the fund decided, and what was pulled.
const GROUPS: { title: string; statuses: PitchStatus[] }[] = [
  { title: "Voting now", statuses: ["voting"] },
  {
    title: "On the way to a vote",
    statuses: ["scheduled", "submitted", "draft"],
  },
  { title: "Decided", statuses: ["executed", "passed", "failed"] },
  { title: "Withdrawn", statuses: ["withdrawn"] },
];

type SectorOption = Pick<Sector, "id" | "name" | "slug" | "is_active">;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function PitchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ fund: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const status = first(sp.status);
  const sectorQ = first(sp.sector).trim();
  const q = first(sp.q).trim();

  const { supabase, user } = await getAuthState();
  const [pitchesRes, sectorsRes] = await Promise.all([
    supabase
      .from("pitches")
      .select(
        "*, sector:sectors(name, slug), author:profiles!author_id(full_name)"
      )
      .eq("fund_id", ctx.fund.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("sectors")
      .select("id, name, slug, is_active")
      .eq("fund_id", ctx.fund.id)
      .order("sort_order"),
  ]);
  const allPitches = (pitchesRes.data as unknown as PitchListItem[] | null) ?? [];
  const sectors = (sectorsRes.data as SectorOption[] | null) ?? [];

  // The picker offers the active sectors, plus any retired one that still
  // has pitches on file.
  const pitchedSectorIds = new Set(allPitches.map((p) => p.sector_id));
  const sectorOptions = sectors.filter(
    (s) => s.is_active || pitchedSectorIds.has(s.id)
  );
  const activeSector = sectorQ
    ? sectors.find((s) => s.slug === sectorQ) ?? null
    : null;

  // Sector and search narrow the whole page; the chips count what is left.
  const needle = q.toLowerCase();
  const pitches = allPitches.filter((p) => {
    if (sectorQ && p.sector_id !== activeSector?.id) return false;
    if (needle) {
      const hay = [
        p.title,
        p.symbol,
        p.instrument_name,
        p.author?.full_name,
        p.sector?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const narrowed = sectorQ !== "" || q !== "";

  // The viewer's own ballots on anything that has been voted on, and which
  // passed pitches still have a ticket waiting to be executed.
  const votedIds = pitches
    .filter((p) =>
      ["voting", "passed", "failed", "executed"].includes(p.status)
    )
    .map((p) => p.id);
  const passedIds = pitches
    .filter((p) => p.status === "passed")
    .map((p) => p.id);
  const [voteRes, ticketRes] = await Promise.all([
    votedIds.length > 0 && user
      ? supabase
          .from("votes")
          .select("pitch_id, choice")
          .eq("voter_id", user.id)
          .in("pitch_id", votedIds)
      : Promise.resolve({ data: null }),
    passedIds.length > 0
      ? supabase
          .from("trade_tickets")
          .select("pitch_id")
          .eq("status", "pending")
          .in("pitch_id", passedIds)
      : Promise.resolve({ data: null }),
  ]);
  const myVotes = new Map<string, VoteChoice>();
  for (const v of (voteRes.data as
    | { pitch_id: string; choice: VoteChoice }[]
    | null) ?? []) {
    myVotes.set(v.pitch_id, v.choice);
  }
  const tradePending = new Set(
    ((ticketRes.data as { pitch_id: string | null }[] | null) ?? []).map(
      (t) => t.pitch_id
    )
  );

  const filter = STATUSES.some((s) => s.key === status)
    ? (status as PitchStatus | "all")
    : "all";
  const countByStatus = new Map<string, number>();
  for (const p of pitches) {
    countByStatus.set(p.status, (countByStatus.get(p.status) ?? 0) + 1);
  }

  const canScheduleAny = can(ctx, "schedule_pitch");
  const canDraft = can(ctx, "draft_pitch");
  const canVote = can(ctx, "cast_vote");

  // Votes close in order, so the soonest-closing comes first.
  const byGroup = GROUPS.map((g) => ({
    ...g,
    pitches: pitches
      .filter((p) => g.statuses.includes(p.status))
      .sort((a, b) =>
        g.statuses[0] === "voting"
          ? (a.vote_closes_at ?? "").localeCompare(b.vote_closes_at ?? "")
          : 0
      ),
  })).filter((g) => g.pitches.length > 0);
  const filtered =
    filter === "all" ? pitches : pitches.filter((p) => p.status === filter);

  // Chips and the clear link keep the sector and search in force.
  const hrefFor = (next: { status?: string; sector?: string; q?: string }) => {
    const query = new URLSearchParams();
    const st = next.status ?? filter;
    if (st !== "all") query.set("status", st);
    const sec = next.sector ?? sectorQ;
    if (sec) query.set("sector", sec);
    const text = next.q ?? q;
    if (text) query.set("q", text);
    const s = query.toString();
    return s ? `/${slug}/pitches?${s}` : `/${slug}/pitches`;
  };

  const card = (p: PitchListItem) => (
    <PitchCard
      key={p.id}
      pitch={p}
      fund={slug}
      showSchedule={canScheduleAny}
      showSubmit={can(ctx, "submit_pitch", { sectorId: p.sector_id })}
      myVote={myVotes.get(p.id)}
      canVote={canVote}
      tradePending={tradePending.has(p.id)}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pitches"
        description="Every pitch, from first draft through the class vote to the trade."
        actions={
          <>
            {canOpenAdminSection(ctx, "pitches") && (
              <ManageLink href={`/${slug}/admin/pitches`}>
                Manage pitches
              </ManageLink>
            )}
            {canDraft && (
              <LinkButton
                href={
                  activeSector?.is_active
                    ? `/${slug}/pitches/new?sector=${activeSector.slug}`
                    : `/${slug}/pitches/new`
                }
              >
                <Plus className="h-4 w-4" /> New pitch
              </LinkButton>
            )}
          </>
        }
      />

      {allPitches.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PitchFilters
              key={`${filter}|${sectorQ}|${q}`}
              fund={slug}
              status={filter}
              q={q}
              sector={activeSector ? sectorQ : ""}
              sectors={sectorOptions.map((s) => ({ slug: s.slug, name: s.name }))}
              mySectorSlug={ctx.sector?.slug ?? null}
            />
            {activeSector && (
              <Link
                href={`/${slug}/sectors/${activeSector.slug}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
              >
                {activeSector.name} sector page
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {STATUSES.filter(
              // A stage with nothing in it is a dead end; keep the one you are on.
              (s) =>
                s.key === "all" || s.key === filter || countByStatus.has(s.key)
            ).map((s) => {
              const count =
                s.key === "all"
                  ? pitches.length
                  : (countByStatus.get(s.key) ?? 0);
              const active = filter === s.key;
              return (
                <Link
                  key={s.key}
                  href={hrefFor({ status: s.key })}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-accent text-on-accent"
                      : "bg-highlight text-muted hover:text-foreground"
                  }`}
                >
                  {s.label}
                  {count > 0 && (
                    <span
                      className={`ml-1.5 tabular-nums ${active ? "text-on-accent/80" : ""}`}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {filter === "all" &&
        pitches.length > 0 &&
        !countByStatus.has("voting") && (
          <p className="text-sm text-muted">
            {canVote
              ? "No votes are open right now. When an officer opens one you'll get an email, and it will show at the top of this page."
              : "No votes are open right now. Open votes show at the top of this page."}
          </p>
        )}

      {allPitches.length === 0 ? (
        <EmptyState
          title="No pitches yet"
          hint={
            canDraft
              ? "Sector teams start pitches from here or from their sector page. Draft one, attach the deck, and your sector leader submits it for a class date."
              : "Pitches show here as the sector teams draft them."
          }
          action={
            canDraft ? (
              <LinkButton href={`/${slug}/pitches/new`}>
                <Plus className="h-4 w-4" /> Start the first pitch
              </LinkButton>
            ) : undefined
          }
        />
      ) : pitches.length === 0 && narrowed ? (
        <EmptyState
          title="No pitches match"
          hint={
            activeSector && !q
              ? `${activeSector.name} has no pitches yet. Pick another sector, or clear the filters to see every pitch.`
              : "Try another search or sector, or clear the filters to see every pitch."
          }
          action={
            <Link
              href={hrefFor({ sector: "", q: "" })}
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Clear filters
            </Link>
          }
        />
      ) : filter !== "all" ? (
        filtered.length === 0 ? (
          <EmptyState
            title={`No ${filter} pitches`}
            hint="Try another stage, or switch back to All to see everything."
          />
        ) : (
          <div className="space-y-3">{filtered.map(card)}</div>
        )
      ) : (
        byGroup.map((g) => (
          <section key={g.title} className="space-y-3">
            <h2 className="text-lg font-semibold">
              {g.title}
              <span className="ml-2 text-sm font-normal text-muted tabular-nums">
                {g.pitches.length}
              </span>
            </h2>
            {g.pitches.map(card)}
          </section>
        ))
      )}
    </div>
  );
}
