// /[fund]/pitches: the fund's research pipeline and its ballot box in one
// place (SPEC 11.2). A vote is a stage of a pitch, so open votes lead the
// page with the viewer's own ballot state, and the rest of the pipeline
// follows grouped by where each pitch stands. The status chips narrow to one
// stage; they are plain links driven by ?status=. Officers see a Schedule
// shortcut on submitted pitches. Members read only their own ballots under
// RLS, which is exactly what the ballot state needs.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, isOfficer } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton, ManageLink, PageHeader } from "@/components/ui/PageHeader";
import { PitchCard, type PitchListItem } from "@/components/pitch/PitchCard";
import type { PitchStatus, VoteChoice } from "@/types/domain";

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

export default async function PitchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ fund: slug }, { status }] = await Promise.all([
    params,
    searchParams,
  ]);
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const { supabase, user } = await getAuthState();
  const { data } = await supabase
    .from("pitches")
    .select("*, sector:sectors(name), author:profiles!author_id(full_name)")
    .eq("fund_id", ctx.fund.id)
    .order("created_at", { ascending: false });
  const pitches = (data as unknown as PitchListItem[] | null) ?? [];

  // The viewer's own ballots on anything that has been voted on.
  const votedIds = pitches
    .filter((p) =>
      ["voting", "passed", "failed", "executed"].includes(p.status)
    )
    .map((p) => p.id);
  const myVotes = new Map<string, VoteChoice>();
  if (votedIds.length > 0 && user) {
    const { data: voteRows } = await supabase
      .from("votes")
      .select("pitch_id, choice")
      .eq("voter_id", user.id)
      .in("pitch_id", votedIds);
    for (const v of (voteRows as
      | { pitch_id: string; choice: VoteChoice }[]
      | null) ?? []) {
      myVotes.set(v.pitch_id, v.choice);
    }
  }

  const filter = STATUSES.some((s) => s.key === status)
    ? (status as PitchStatus | "all")
    : "all";
  const countByStatus = new Map<string, number>();
  for (const p of pitches) {
    countByStatus.set(p.status, (countByStatus.get(p.status) ?? 0) + 1);
  }

  const officer = isOfficer(ctx);
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

  const card = (p: PitchListItem) => (
    <PitchCard
      key={p.id}
      pitch={p}
      fund={slug}
      showSchedule={officer}
      myVote={myVotes.get(p.id)}
      canVote={canVote}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pitches"
        description="Every pitch, from first draft through the class vote to the trade."
        actions={
          <>
            {officer && (
              <ManageLink href={`/${slug}/admin/pitches`}>
                Scheduling
              </ManageLink>
            )}
            {canDraft && (
              <LinkButton href={`/${slug}/pitches/new`}>
                <Plus className="h-4 w-4" /> New pitch
              </LinkButton>
            )}
          </>
        }
      />

      {pitches.length > 0 && (
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
                href={
                  s.key === "all"
                    ? `/${slug}/pitches`
                    : `/${slug}/pitches?status=${s.key}`
                }
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "bg-highlight text-muted hover:text-foreground"
                }`}
              >
                {s.label}
                {count > 0 && (
                  <span
                    className={`ml-1.5 tabular-nums ${active ? "text-white/80" : ""}`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {filter === "all" &&
        pitches.length > 0 &&
        !countByStatus.has("voting") && (
          <p className="text-sm text-muted">
            No votes are open right now. When an officer opens one you&apos;ll
            get an email, and it will show at the top of this page.
          </p>
        )}

      {pitches.length === 0 ? (
        <EmptyState
          title="No pitches yet"
          hint="Sector teams start pitches from here or from their sector page. Draft one, attach the deck, and your sector leader submits it for a class date."
          action={
            canDraft ? (
              <LinkButton href={`/${slug}/pitches/new`}>
                <Plus className="h-4 w-4" /> Start the first pitch
              </LinkButton>
            ) : undefined
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
