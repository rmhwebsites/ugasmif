// Shown to an alumnus of a fund that has turned settings.alumni_can_view_current
// off (SPEC Section 11.3). The rows are already hidden by RLS — this is here so
// the page reads as a deliberate boundary rather than a fund with no holdings.

import { Archive } from "lucide-react";

export function AlumniNotice({ fundName }: { fundName: string }) {
  return (
    <div className="glass-card flex items-start gap-3 p-4 sm:p-6">
      <Archive className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="font-medium">You are viewing {fundName} as an alumnus</p>
        <p className="mt-1 text-sm text-muted">
          The fund keeps its current positions and valuation to active members.
          Everything from the years you were on the roster — pitches, votes,
          trades and updates — is still here.
        </p>
      </div>
    </div>
  );
}
