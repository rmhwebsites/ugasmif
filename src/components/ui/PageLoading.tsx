// Route-level loading state. The spec asks for skeletons rather than a bare
// spinner on full pages (SPEC 11.4), so the page keeps its shape and the SMIF
// mark turns quietly at the top to show that something is happening.

import { SmifSpinner } from "@/components/ui/SmifSpinner";
import { Skeleton } from "@/components/ui/Skeleton";

export function PageLoading({
  title,
  rows = 6,
}: {
  title: string;
  rows?: number;
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        <SmifSpinner size="sm" label={`Loading ${title.toLowerCase()}`} />
      </div>
      <div className="glass-card space-y-3 p-4 sm:p-6">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
