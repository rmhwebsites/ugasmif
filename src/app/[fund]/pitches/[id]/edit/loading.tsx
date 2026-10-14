// The pitch editor while it loads. Its way back names the pitch, which
// isn't known yet, so the back link arrives with the page.

import { PageLoading } from "@/components/ui/PageLoading";

export default function EditPitchLoading() {
  return <PageLoading title="Edit pitch" rows={6} />;
}
