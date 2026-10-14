"use client";

// The audit log's table (SPEC 11.3). A client island so the columns sort:
// the page fetches and filters on the server and hands the rows down as
// plain data.

import { SortableTable, type SortableColumn } from "@/components/ui/SortableTable";
import { formatDateTime } from "@/lib/format";
import type { AuditLogEntry } from "@/types/domain";

export interface AuditRow extends AuditLogEntry {
  actorName: string;
  /** Plain names for the codes, e.g. "Roster change" for membership.update. */
  actionLabel: string;
  entityLabel: string;
}

const columns: SortableColumn<AuditRow>[] = [
  {
    key: "when",
    label: "When",
    align: "left",
    sortValue: (e) => e.created_at,
    render: (e) => (
      <span className="whitespace-nowrap text-muted">
        {formatDateTime(e.created_at)}
      </span>
    ),
  },
  {
    key: "actor",
    label: "Who",
    align: "left",
    defaultDir: "asc",
    sortValue: (e) => e.actorName,
    render: (e) => e.actorName,
  },
  {
    key: "action",
    label: "What happened",
    align: "left",
    defaultDir: "asc",
    sortValue: (e) => e.actionLabel,
    // The code stays on hover for anyone matching it against the database.
    render: (e) => (
      <span className="font-medium" title={e.action}>
        {e.actionLabel}
      </span>
    ),
  },
  {
    key: "entity",
    label: "Record",
    align: "left",
    defaultDir: "asc",
    sortValue: (e) => e.entityLabel,
    render: (e) => (
      <span className="text-muted" title={e.entity}>
        {e.entityLabel}
      </span>
    ),
  },
  {
    key: "detail",
    label: "Detail",
    align: "left",
    render: (e) =>
      e.before || e.after ? (
        <details>
          <summary className="cursor-pointer text-xs text-accent-text">
            Before and after
          </summary>
          <pre className="mt-1 max-w-md overflow-x-auto rounded bg-highlight p-2 text-[10px] leading-relaxed">
            {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
          </pre>
        </details>
      ) : null,
  },
];

export function AuditTable({ entries }: { entries: AuditRow[] }) {
  return (
    <SortableTable
      rows={entries}
      columns={columns}
      rowKey={(e) => String(e.id)}
      initialSort={{ key: "when", dir: "desc" }}
      minWidth={700}
      maxHeight="70vh"
      caption="Audit log"
    />
  );
}
