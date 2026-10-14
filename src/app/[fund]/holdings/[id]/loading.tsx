// A holding's page while it values: its own shape, not the holdings list's.

import { DetailLoading } from "@/components/ui/PageLoading";

export default function HoldingLoading() {
  return (
    <DetailLoading back={{ label: "Holdings", path: "holdings" }} what="holding" />
  );
}
