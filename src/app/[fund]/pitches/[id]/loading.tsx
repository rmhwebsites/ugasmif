// A pitch's page while it loads: its own shape, not the pitches list's.

import { DetailLoading } from "@/components/ui/PageLoading";

export default function PitchLoading() {
  return (
    <DetailLoading back={{ label: "Pitches", path: "pitches" }} what="pitch" />
  );
}
