// /[fund]/votes — the member's ballot box (SPEC 11.2): open votes with a
// voted/not-voted state, then past pitches with results. Members read only
// their own ballots under RLS, which is exactly what this page needs.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Vote, XCircle } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format";
import type { Pitch, VoteChoice } from "@/types/domain";

interface PitchWithSector extends Pitch {
  sector: { name: string } | null;
}

function MyChoiceBadge({ choice }: { choice: VoteChoice | undefined }) {
  if (choice === "yes") {
    return (
      <Badge tone="gain">
        <CheckCircle2 className="h-3 w-3" /> You voted yes
      </Badge>
    );
  }
  if (choice === "no") {
    return (
      <Badge tone="loss">
        <XCircle className="h-3 w-3" /> You voted no
      </Badge>
    );
  }
  return (
    <Badge tone="warn">
      <Clock className="h-3 w-3" /> Not voted yet
    </Badge>
  );
}

export default async function VotesPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const { supabase, user } = await getAuthState();
  const [openRes, pastRes] = await Promise.all([
    supabase
      .from("pitches")
      .select("*, sector:sectors(name)")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "voting")
      .order("vote_closes_at", { ascending: true }),
    supabase
      .from("pitches")
      .select("*, sector:sectors(name)")
      .eq("fund_id", ctx.fund.id)
      .in("status", ["passed", "failed", "executed"])
      .order("closed_at", { ascending: false })
      .limit(50),
  ]);
  const openPitches = (openRes.data as unknown as PitchWithSector[] | null) ?? [];
  const pastPitches = (pastRes.data as unknown as PitchWithSector[] | null) ?? [];

  // The caller's own ballots (RLS returns exactly these for members).
  const allIds = [...openPitches, ...pastPitches].map((p) => p.id);
  const myVotes = new Map<string, VoteChoice>();
  if (allIds.length > 0 && user) {
    const { data: voteRows } = await supabase
      .from("votes")
      .select("pitch_id, choice")
      .eq("voter_id", user.id)
      .in("pitch_id", allIds);
    for (const v of (voteRows as { pitch_id: string; choice: VoteChoice }[] | null) ??
      []) {
      myVotes.set(v.pitch_id, v.choice);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">Votes</h1>
        <p className="text-xs text-muted sm:text-sm">
          Open votes first — results are tallied when each window closes.
        </p>
      </div>

      <Card>
        <CardHeader title="Open now" />
        <div className="p-3 sm:p-4">
          {openPitches.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              No open votes right now. When an officer opens voting on a pitch
              you&apos;ll get an email and it will show up here.
            </p>
          ) : (
            <ul className="space-y-2">
              {openPitches.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-highlight px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${slug}/pitches/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {p.sector?.name ? `${p.sector.name} · ` : ""}
                      closes {formatDateTime(p.vote_closes_at)} ET
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <MyChoiceBadge choice={myVotes.get(p.id)} />
                    <Link
                      href={`/${slug}/pitches/${p.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      <Vote className="h-3.5 w-3.5" />
                      {myVotes.has(p.id) ? "Change vote" : "Vote"}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Past votes" />
        <div className="p-3 sm:p-4">
          {pastPitches.length === 0 ? (
            <EmptyState
              title="No completed votes yet"
              hint="Once a vote closes, the result — yes/no counts and the passing percentage — is archived here for everyone."
            />
          ) : (
            <ul className="divide-y divide-card-border/60">
              {pastPitches.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-2 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/${slug}/pitches/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.title}
                      </Link>
                      <PitchStatusBadge status={p.status} />
                    </div>
                    <p className="text-xs text-muted">
                      {p.sector?.name ? `${p.sector.name} · ` : ""}
                      closed {formatDate(p.closed_at)}
                      {myVotes.has(p.id)
                        ? ` · you voted ${myVotes.get(p.id)}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        p.status === "failed" ? "text-loss" : "text-gain"
                      }`}
                    >
                      {formatPercent(
                        p.result_pct === null ? null : Number(p.result_pct)
                      )}{" "}
                      yes
                    </p>
                    <p className="text-xs tabular-nums text-muted">
                      {p.votes_yes} yes · {p.votes_no} no
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
