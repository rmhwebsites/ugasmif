"use client";

// The audit log's table (SPEC 11.3). A client island so the columns sort:
// the page fetches and filters on the server and hands the rows down as
// plain data.

import { SortableTable, type SortableColumn } from "@/components/ui/SortableTable";
import { formatDateTime } from "@/lib/format";
import type { AuditLogEntry } from "@/types/domain";

export interface AuditRow extends AuditLogEntry {
  actorName: string;
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
    label: "Actor",
    align: "left",
    defaultDir: "asc",
    sortValue: (e) => e.actorName,
    render: (e) => e.actorName,
  },
  {
    key: "action",
    label: "Action",
    align: "left",
    defaultDir: "asc",
    sortValue: (e) => e.action,
    render: (e) => <span className="font-medium">{e.action}</span>,
  },
  {
    key: "entity",
    label: "Entity",
    align: "left",
    defaultDir: "asc",
    sortValue: (e) => e.entity,
    render: (e) => <span className="text-muted">{e.entity}</span>,
  },
  {
    key: "detail",
    label: "Detail",
    align: "left",
    render: (e) =>
      e.before || e.after ? (
        <details>
          <summary className="cursor-pointer text-xs text-accent">
            before / after
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
