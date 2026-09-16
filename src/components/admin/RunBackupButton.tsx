"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function RunBackupButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );

  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      setState(res.ok ? "done" : "error");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {state === "done" && <span className="text-sm text-gain">Backed up</span>}
      {state === "error" && (
        <span className="text-sm text-loss">Backup failed — check health</span>
      )}
      <Button
        variant="secondary"
        onClick={run}
        disabled={state === "running"}
      >
        {state === "running" ? "Running…" : "Run backup now"}
      </Button>
    </div>
  );
}
