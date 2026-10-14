// Any address under a fund that matches no page, e.g. /athena/nope. Without
// this, an unmatched URL skips the fund layout and lands on the bare root
// 404; throwing notFound() here renders /[fund]/not-found.tsx inside the
// fund's sidebar instead, so there is always a way back.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Becomes "Page not found · Athena · SMIF Hub" through the fund template.
export const metadata: Metadata = { title: "Page not found" };

export default function MissingFundPage() {
  notFound();
}
