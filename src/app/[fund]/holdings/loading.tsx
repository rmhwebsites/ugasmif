// Skeleton for /[fund]/holdings while valueFund runs (spec 11.4: skeletons,
// never spinners, on full pages).

import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function HoldingsLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-12 w-full" />
      <TableSkeleton rows={10} />
    </div>
  );
}
