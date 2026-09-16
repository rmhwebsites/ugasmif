// Pitches list loading state — skeletons, never spinners (SPEC 11.4).

import { Skeleton } from "@/components/ui/Skeleton";

export default function PitchesLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
