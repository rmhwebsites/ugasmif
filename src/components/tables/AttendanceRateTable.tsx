"use client";

// Attendance by member (SPEC 11.2). A client island so the columns sort —
// "who has missed the most" is the question this table gets asked.

import {
  SortableTable,
  type SortableColumn,
} from "@/components/ui/SortableTable";
import { formatPercent } from "@/lib/format";

export interface AttendanceRow {
  id: string;
  name: string;
  present: number;
  total: number;
  /** Meetings held, used when a member has no attendance rows at all. */
  meetingsHeld: number;
}

const columns: SortableColumn<AttendanceRow>[] = [
  {
    key: "member",
    label: "Member",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.name,
    render: (r) => r.name,
  },
  {
    key: "attended",
    label: "Attended",
    sortValue: (r) => r.present,
    render: (r) => (
      <span className="tabular-nums">
        {r.present}/{r.total || r.meetingsHeld}
      </span>
    ),
  },
  {
    key: "rate",
    label: "Rate",
    // Null, not 0: a member with no meetings recorded has no rate, and
    // sorting them in among the 0% absentees would misread the roster.
    sortValue: (r) => (r.total > 0 ? (r.present / r.total) * 100 : null),
    render: (r) => (
      <span className="tabular-nums">
        {r.total > 0 ? formatPercent((r.present / r.total) * 100, 0) : "—"}
      </span>
    ),
  },
];

export function AttendanceRateTable({ rows }: { rows: AttendanceRow[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      initialSort={{ key: "member", dir: "asc" }}
      minWidth={420}
      caption="Attendance by member"
    />
  );
}
