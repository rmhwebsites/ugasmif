// Fund-wide loading state — skeletons, never spinners (SPEC 11.4). Shaped
// like the page being opened: the dashboard's tiles and chart only on the
// dashboard, Fund admin's tabs and title under /admin (see FundLoading).

import { FundLoading } from "@/components/ui/PageLoading";

export default function Loading() {
  return <FundLoading />;
}
