// Performance page loading state — skeletons, never spinners (SPEC 11.4).

import { Skeleton } from "@/components/ui/Skeleton";

export default function PerformanceLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-56" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
