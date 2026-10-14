"use client";

// Search and sector filter for the Pitches list. Both live in the URL
// (?q= and ?sector=<slug>, beside ?status=), so a filtered list can be
// linked to: a sector page's "All Technology pitches" lands here already
// narrowed. Picking a sector applies at once; the search applies on Enter
// or the Search button. Without JavaScript it is a plain GET form.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface PitchFilterSector {
  slug: string;
  name: string;
}

const FIELD =
  "rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

export function PitchFilters({
  fund,
  status,
  q,
  sector,
  sectors,
  mySectorSlug = null,
}: {
  fund: string;
  /** The status chip in force ("all" for none); kept when filtering. */
  status: string;
  q: string;
  /** Sector slug, or "" for every sector. */
  sector: string;
  sectors: PitchFilterSector[];
  /** The viewer's own sector, listed first. */
  mySectorSlug?: string | null;
}) {
  const router = useRouter();
  const base = `/${fund}/pitches`;

  function go(next: { q: string; sector: string }) {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (next.sector) params.set("sector", next.sector);
    if (next.q.trim()) params.set("q", next.q.trim());
    const query = params.toString();
    router.push(query ? `${base}?${query}` : base);
  }

  const mine = sectors.find((s) => s.slug === mySectorSlug) ?? null;
  const others = sectors.filter((s) => s.slug !== mySectorSlug);
  const filtering = q !== "" || sector !== "";
  const clearHref = status !== "all" ? `${base}?status=${status}` : base;

  return (
    <form
      role="search"
      method="get"
      action={base}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        go({
          q: String(data.get("q") ?? ""),
          sector: String(data.get("sector") ?? ""),
        });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      {status !== "all" && <input type="hidden" name="status" value={status} />}
      <div className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Company, ticker or author"
          aria-label="Search pitches"
          className={`${FIELD} w-full pl-8`}
        />
      </div>
      <select
        name="sector"
        defaultValue={sector}
        aria-label="Filter by sector"
        onChange={(e) => {
          const form = e.currentTarget.form;
          go({
            q: form ? String(new FormData(form).get("q") ?? "") : q,
            sector: e.currentTarget.value,
          });
        }}
        className={`${FIELD} min-w-0 max-w-full cursor-pointer`}
      >
        <option value="">All sectors</option>
        {mine && <option value={mine.slug}>{mine.name} (your sector)</option>}
        {others.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" className="px-3 py-1.5">
        Search
      </Button>
      {filtering && (
        <Link href={clearHref} className="text-sm text-muted hover:text-foreground">
          Clear
        </Link>
      )}
    </form>
  );
}
