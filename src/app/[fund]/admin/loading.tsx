// Fund admin's loading state. It renders inside the admin layout, so the
// real tabs stay put while a page opens, and the title is that page's own
// H1, read off the address.

import { AdminLoading } from "@/components/ui/PageLoading";

export default function Loading() {
  return <AdminLoading />;
}
