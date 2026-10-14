// A sector's page while it loads: titled by the sector once it arrives,
// rather than "Sectors" from the list's loading state.

import { DetailLoading } from "@/components/ui/PageLoading";

export default function SectorLoading() {
  return (
    <DetailLoading back={{ label: "Sectors", path: "sectors" }} what="sector" />
  );
}
