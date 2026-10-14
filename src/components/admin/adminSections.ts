// Fund admin's map: every section's tab label, grouped under the same
// captions as the main sidebar (Portfolio, Research, Club) plus Setup for
// the pages you open once a term. Plain data, so the client tab bar and the
// server pages can both read it.

import type { AdminSection } from "@/lib/permissions";

export interface AdminTab {
  seg: AdminSection;
  label: string;
}

export const ADMIN_GROUPS: { caption: string | null; tabs: AdminTab[] }[] = [
  { caption: null, tabs: [{ seg: "", label: "Checklist" }] },
  {
    caption: "Portfolio",
    tabs: [
      { seg: "tickets", label: "Tickets" },
      { seg: "holdings", label: "Holdings" },
    ],
  },
  {
    caption: "Research",
    tabs: [
      { seg: "pitches", label: "Pitches" },
      { seg: "sectors", label: "Sectors" },
    ],
  },
  {
    caption: "Club",
    tabs: [
      { seg: "attendance", label: "Meetings" },
      { seg: "updates", label: "Updates" },
      { seg: "members", label: "Members" },
    ],
  },
  {
    caption: "Setup",
    tabs: [
      { seg: "year", label: "Year" },
      { seg: "settings", label: "Settings" },
      { seg: "audit", label: "Audit" },
    ],
  },
];
