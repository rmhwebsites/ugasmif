"use client";

// Roster CSV import with a preview step (SPEC 17.1).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/ui/SortableTable";

interface PreviewRow {
  row: number;
  email: string;
  full_name: string;
  fund: string;
  role: string;
  action: "create" | "update" | "error";
  error: string | null;
}

// Sorting the preview matters most for one question: which rows failed.
const PREVIEW_COLUMNS: SortableColumn<PreviewRow>[] = [
  {
    key: "row",
    label: "Row",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.row,
    render: (r) => <span className="tabular-nums text-muted">{r.row}</span>,
  },
  {
    key: "email",
    label: "Email",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.email,
    render: (r) => r.email,
  },
  {
    key: "name",
    label: "Name",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.full_name,
    render: (r) => r.full_name,
  },
  {
    key: "fund",
    label: "Fund",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.fund,
    render: (r) => r.fund,
  },
  {
    key: "role",
    label: "Role",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.role,
    render: (r) => r.role,
  },
  {
    key: "action",
    label: "Action",
    align: "left",
    defaultDir: "asc",
    // Errors first on the first click: that is what the officer is looking
    // for before they commit the import.
    sortValue: (r) => (r.action === "error" ? 0 : r.action === "create" ? 1 : 2),
    render: (r) =>
      r.action === "error" ? (
        <Badge tone="loss" title={r.error ?? undefined}>
          {r.error}
        </Badge>
      ) : (
        <Badge tone={r.action === "create" ? "gain" : "neutral"}>
          {r.action}
        </Badge>
      ),
  },
];

const SAMPLE = `email,full_name,fund,role,sector,is_sector_leader,title_override
lfuselier@uga.edu,Lucy Fuselier,athena,vice_president,,false,
lfuselier@uga.edu,Lucy Fuselier,arch,sector_leader,Treasuries,true,`;

export function RosterImport({ fund }: { fund: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(commit: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${fund}/roster/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, commit, file_name: fileName }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Import failed.");
      return;
    }
    if (commit) {
      setPreview(null);
      setSummary(
        `Imported: ${data.created} created, ${data.updated} updated, ${data.failed} failed.`
      );
      setCsv("");
      router.refresh();
    } else {
      setPreview(data.rows);
      setSummary(
        `${data.creates} new accounts, ${data.updates} existing members, ${
          data.rows.filter((r: PreviewRow) => r.action === "error").length
        } errors.`
      );
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
  }

  const errorCount = preview?.filter((r) => r.action === "error").length ?? 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        One row per person per fund. Columns: email, full_name, fund, role,
        sector, is_sector_leader, title_override. New people get an invite
        email; existing members keep their password.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="block w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-highlight file:px-3 file:py-1.5 file:text-sm file:text-foreground"
      />

      <textarea
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
        }}
        rows={6}
        className="w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent"
        placeholder={SAMPLE}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => send(false)}
          disabled={busy || csv.trim() === ""}
        >
          {busy ? "Checking…" : "Preview"}
        </Button>
        {preview && (
          <Button onClick={() => send(true)} disabled={busy}>
            {busy
              ? "Importing…"
              : `Import ${preview.length - errorCount} rows`}
          </Button>
        )}
        {summary && <span className="text-sm text-muted">{summary}</span>}
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}

      {preview && (
        <div className="glass-card overflow-hidden">
          <SortableTable
            rows={preview}
            columns={PREVIEW_COLUMNS}
            rowKey={(r) => String(r.row)}
            initialSort={{ key: "row", dir: "asc" }}
            maxHeight="20rem"
            caption="Roster import preview"
          />
        </div>
      )}
    </div>
  );
}
