// Skeleton for /[fund]/trades while tickets and the ledger load (spec 11.4:
// skeletons, never spinners, on full pages).

import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function TradesLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Skeleton className="h-40" />
        <Skeleton className="hidden h-40 lg:block" />
      </div>
      <TableSkeleton rows={10} />
    </div>
  );
}
