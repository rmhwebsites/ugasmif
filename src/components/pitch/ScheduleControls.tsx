"use client";

// Lifecycle buttons for one pitch (SPEC Section 12 transitions): submit,
// withdraw, schedule to a class date, open voting (with a window override),
// close early, and send a reminder to non-voters. What the caller may do is
// decided server-side and passed as flags; the routes re-check everything.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CalendarClock,
  Megaphone,
  Send,
  Undo2,
  Vote,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";
import type { PitchStatus } from "@/types/domain";

export function ScheduleControls({
  fund,
  pitchId,
  status,
  scheduledFor,
  voteClosesAt,
  defaultWindowHours,
  canSubmit = false,
  canWithdraw = false,
  canSchedule = false,
  meetingDates = [],
}: {
  fund: string;
  pitchId: string;
  status: PitchStatus;
  scheduledFor: string | null;
  voteClosesAt: string | null;
  /** fund.vote_default_window_hours — pre-fills the open-vote window input. */
  defaultWindowHours: number;
  canSubmit?: boolean;
  canWithdraw?: boolean;
  /** Officer: schedule, open/close voting, remind. */
  canSchedule?: boolean;
  /** Upcoming class dates (YYYY-MM-DD) offered as quick picks. */
  meetingDates?: string[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(scheduledFor ?? "");
  const [hours, setHours] = useState(String(defaultWindowHours));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(action: string, body?: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/${fund}/pitches/${pitchId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json: { error?: string; reminded?: number } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "That didn't work — try again.");
      } else if (action === "remind") {
        setNotice(
          json.reminded === 0
            ? "Everyone eligible has already voted (or muted reminders)."
            : `Reminder sent to ${json.reminded} member${json.reminded === 1 ? "" : "s"}.`
        );
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — try again.");
    }
    setBusy(null);
  }

  const preVote =
    status === "draft" || status === "submitted" || status === "scheduled";
  const showOpenVote =
    canSchedule && (status === "submitted" || status === "scheduled");

  const hasAnything =
    (canSubmit && status === "draft") ||
    (canWithdraw && preVote) ||
    (canSchedule && preVote && status !== "draft") ||
    (canSchedule && status === "voting");
  if (!hasAnything) return null;

  return (
    <div className="space-y-3">
      {/* Submit for scheduling */}
      {canSubmit && status === "draft" && (
        <Button
          onClick={() => post("submit")}
          disabled={busy !== null}
          className="w-full"
        >
          <Send className="h-4 w-4" />
          {busy === "submit" ? "Submitting…" : "Submit for scheduling"}
        </Button>
      )}

      {/* Schedule to a class date */}
      {canSchedule && (status === "submitted" || status === "scheduled") && (
        <div className="rounded-lg border border-input-border bg-input-bg p-3">
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <CalendarClock className="h-3.5 w-3.5" />
            {status === "scheduled" ? "Reschedule class date" : "Schedule for a class date"}
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <Button
              variant="secondary"
              disabled={busy !== null || date === ""}
              onClick={() => post("schedule", { scheduled_for: date })}
            >
              {busy === "schedule" ? "Saving…" : "Schedule"}
            </Button>
          </div>
          {meetingDates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meetingDates.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDate(d)}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                    date === d
                      ? "bg-accent text-white"
                      : "bg-highlight text-muted hover:text-foreground"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Open voting */}
      {showOpenVote && (
        <div className="rounded-lg border border-input-border bg-input-bg p-3">
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Vote className="h-3.5 w-3.5" /> Open voting now
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={336}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-20 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-sm tabular-nums outline-none focus:border-accent"
              aria-label="Voting window in hours"
            />
            <span className="text-xs text-muted">hour window</span>
            <Button
              className="ml-auto"
              disabled={busy !== null}
              onClick={() => {
                const h = Number(hours);
                post(
                  "open-vote",
                  Number.isFinite(h) && h >= 1 ? { window_hours: Math.round(h) } : {}
                );
              }}
            >
              {busy === "open-vote" ? "Opening…" : "Open vote"}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            Emails every eligible voter and starts the clock.
          </p>
        </div>
      )}

      {/* While voting: close early + remind non-voters */}
      {canSchedule && status === "voting" && (
        <div className="space-y-2 rounded-lg border border-input-border bg-input-bg p-3">
          <p className="text-xs text-muted">
            Voting closes {formatDateTime(voteClosesAt)} ET — the nightly job
            closes it automatically, or close it now.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null}
              onClick={() => {
                if (
                  window.confirm(
                    "Close voting now? The result is final and the fund is emailed."
                  )
                ) {
                  void post("close-vote");
                }
              }}
            >
              <Megaphone className="h-4 w-4" />
              {busy === "close-vote" ? "Closing…" : "Close vote now"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => post("remind")}
            >
              <BellRing className="h-4 w-4" />
              {busy === "remind" ? "Sending…" : "Remind non-voters"}
            </Button>
          </div>
        </div>
      )}

      {/* Withdraw */}
      {canWithdraw && preVote && (
        <Button
          variant="ghost"
          className="w-full"
          disabled={busy !== null}
          onClick={() => {
            if (
              window.confirm(
                "Withdraw this pitch? It keeps its record but leaves the queue."
              )
            ) {
              void post("withdraw");
            }
          }}
        >
          <Undo2 className="h-4 w-4" />
          {busy === "withdraw" ? "Withdrawing…" : "Withdraw pitch"}
        </Button>
      )}

      {error && <p className="text-sm text-loss">{error}</p>}
      {notice && <p className="text-sm text-gain">{notice}</p>}
    </div>
  );
}
