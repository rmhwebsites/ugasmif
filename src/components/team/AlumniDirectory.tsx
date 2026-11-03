"use client";

// The alumni list: everyone who has been through SMIF, newest class first,
// with search and two filters. The server page hands over every alum (the
// list is a few hundred people at most), so filtering is instant and works
// the same for both funds.
//
// Each card: picture, name, LinkedIn, the years they were in, their last
// role, every role they held, and the pitches their sector took to a vote
// while they were on it (plus any they wrote). A pitch links to its page
// when the viewer can open that fund.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatPercent } from "@/lib/format";
import { matchesQuery } from "@/lib/search";
import type { Alum, AlumPitch } from "@/lib/alumni";
import type { FundSlug } from "@/types/domain";

const FUND_NAMES: Record<FundSlug, string> = { athena: "Athena", arch: "Arch" };

function outcome(p: AlumPitch): { text: string; tone: "gain" | "loss" | "info" } {
  const pct = p.result_pct === null ? "" : ` ${formatPercent(Number(p.result_pct), 0)}`;
  if (p.status === "passed" || p.status === "executed") return { text: `Passed${pct}`, tone: "gain" };
  if (p.status === "failed") return { text: `Didn't pass${pct}`, tone: "loss" };
  return { text: "Voting", tone: "info" };
}

export function AlumniDirectory({
  alumni,
  linkable,
  manageFund,
}: {
  alumni: Alum[];
  /** Funds the viewer can open, so their pitches link. */
  linkable: FundSlug[];
  /** Set for roster managers: alumni of this fund get an edit link. */
  manageFund: FundSlug | null;
}) {
  const [query, setQuery] = useState("");
  const [fund, setFund] = useState<FundSlug | "all">("all");
  const [year, setYear] = useState("");

  const funds = useMemo(
    () => (["athena", "arch"] as FundSlug[]).filter((f) => alumni.some((a) => a.funds.includes(f))),
    [alumni]
  );
  const years = useMemo(
    () => [...new Set(alumni.flatMap((a) => a.years))].sort().reverse(),
    [alumni]
  );

  const visible = alumni.filter(
    (a) =>
      (fund === "all" || a.funds.includes(fund)) &&
      (year === "" || a.years.includes(year)) &&
      matchesQuery(a.haystack, query)
  );
  const filtered = query.trim() !== "" || fund !== "all" || year !== "";

  if (alumni.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="font-medium">No alumni yet</p>
        <p className="mt-1 text-sm text-muted">
          Members show up here once the year they were in has ended.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
          <span className="sr-only">Search alumni</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, year, role, sector or pitch"
            className="w-full rounded-lg border border-input-border bg-input-bg py-2 pr-3 pl-9 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>

        {funds.length > 1 && (
          <div role="group" aria-label="Fund" className="flex rounded-lg border border-input-border p-0.5">
            {(["all", ...funds] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFund(f)}
                aria-pressed={fund === f}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  fund === f ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:text-foreground"
                }`}
              >
                {f === "all" ? "Both funds" : FUND_NAMES[f]}
              </button>
            ))}
          </div>
        )}

        {years.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="sr-only">Year in the club</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="">Any year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="text-xs text-muted tabular-nums" aria-live="polite">
          {filtered ? `${visible.length} of ${alumni.length}` : `${alumni.length} alumni`}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="glass-card p-6 text-center text-sm text-muted">No alumni match.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((a) => (
            <li key={a.id}>
              <AlumCard alum={a} linkable={linkable} manageFund={manageFund} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AlumCard({
  alum,
  linkable,
  manageFund,
}: {
  alum: Alum;
  linkable: FundSlug[];
  manageFund: FundSlug | null;
}) {
  const canEdit = manageFund !== null && alum.funds.includes(manageFund);
  return (
    <article className="glass-card flex h-full flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar src={alum.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold leading-snug">{alum.name}</h2>
            {alum.funds.map((f) => (
              <Badge key={f} tone="neutral">
                {FUND_NAMES[f]}
              </Badge>
            ))}
          </div>
          <p className="mt-0.5 text-sm">{alum.headline}</p>
          <p className="text-xs text-muted tabular-nums">{alum.yearsText}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {alum.linkedinUrl ? (
              <a
                href={alum.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
              >
                LinkedIn
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">(opens {alum.name}&apos;s profile in a new tab)</span>
              </a>
            ) : (
              <span className="text-xs text-muted">No LinkedIn yet</span>
            )}
            {canEdit && (
              <Link
                href={`/${manageFund}/admin/members/${alum.id}`}
                className="text-xs text-muted hover:text-foreground hover:underline"
              >
                {alum.linkedinUrl ? "Edit link" : "Add link"}
              </Link>
            )}
          </div>
        </div>
      </div>

      {alum.roles.length > 1 && (
        <ul className="space-y-0.5 border-t border-card-border pt-2 text-xs">
          {alum.roles.map((r, i) => (
            <li key={`${r.year}-${r.fund}-${i}`} className="flex gap-2">
              <span className="w-14 shrink-0 tabular-nums text-muted">{r.year}</span>
              <span className="min-w-0">
                {r.label}
                {alum.funds.length > 1 && <span className="text-muted"> · {FUND_NAMES[r.fund]}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto border-t border-card-border pt-2">
        {alum.pitches.length === 0 ? (
          <p className="text-xs text-muted">No pitches on record.</p>
        ) : (
          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-medium text-accent-text hover:underline [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>{" "}
              {alum.pitches.length} {alum.pitches.length === 1 ? "pitch" : "pitches"}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {alum.pitches.map((p) => {
                const o = outcome(p);
                const title = p.symbol && !p.title.includes(p.symbol) ? `${p.title} (${p.symbol})` : p.title;
                return (
                  <li key={p.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {linkable.includes(p.fund) ? (
                        <Link href={`/${p.fund}/pitches/${p.id}`} className="font-medium hover:underline">
                          {title}
                        </Link>
                      ) : (
                        <span className="font-medium">{title}</span>
                      )}
                      <Badge tone={o.tone}>{o.text}</Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {formatDate(p.date)}
                      {p.sector ? ` · ${p.sector}` : ""}
                      {p.authored ? " · wrote it" : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
