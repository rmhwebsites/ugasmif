"use client";

// Roster CSV import with a preview step (SPEC 17.1).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface PreviewRow {
  row: number;
  email: string;
  full_name: string;
  fund: string;
  role: string;
  action: "create" | "update" | "error";
  error: string | null;
}

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
        <div className="glass-card max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-sticky backdrop-blur-xl">
              <tr className="border-b border-card-border text-left uppercase tracking-wider text-muted">
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Fund</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.row} className="border-b border-card-border/50">
                  <td className="px-3 py-1.5 text-muted">{r.row}</td>
                  <td className="px-3 py-1.5">{r.email}</td>
                  <td className="px-3 py-1.5">{r.full_name}</td>
                  <td className="px-3 py-1.5">{r.fund}</td>
                  <td className="px-3 py-1.5">{r.role}</td>
                  <td className="px-3 py-1.5">
                    {r.action === "error" ? (
                      <Badge tone="loss" title={r.error ?? undefined}>
                        {r.error}
                      </Badge>
                    ) : (
                      <Badge tone={r.action === "create" ? "gain" : "neutral"}>
                        {r.action}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
