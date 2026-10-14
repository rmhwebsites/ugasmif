// /[fund]/votes moved into /[fund]/pitches, where open votes now lead the
// page with your ballot state. Kept as a redirect so old links and bookmarks
// still land somewhere useful.

import { redirect } from "next/navigation";

export default async function VotesPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund } = await params;
  redirect(`/${fund}/pitches`);
}
