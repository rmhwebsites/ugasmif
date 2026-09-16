"use client";

// Create meetings and take attendance (SPEC 11.3 /admin/attendance).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { easternDateString, formatDate } from "@/lib/format";
import type { Meeting, MeetingAttendance } from "@/types/domain";

const inputClass =
  "rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export interface AttendanceMember {
  userId: string;
  name: string;
}

export function AttendanceEditor({
  fund,
  meetings,
  members,
  attendance,
}: {
  fund: string;
  meetings: Meeting[];
  members: AttendanceMember[];
  attendance: MeetingAttendance[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(meetings[0]?.id ?? "");
  const [newMeeting, setNewMeeting] = useState({
    meeting_date: easternDateString(),
    title: "",
  });
  const [present, setPresent] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Attendance state for the selected meeting, defaulting to the stored rows.
  const storedFor = (meetingId: string): Record<string, boolean> => {
    const map: Record<string, boolean> = {};
    for (const m of members) {
      const row = attendance.find(
        (a) => a.meeting_id === meetingId && a.user_id === m.userId
      );
      map[m.userId] = row?.present ?? false;
    }
    return map;
  };

  const effective = present ?? (selectedId ? storedFor(selectedId) : {});

  async function createMeeting(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/${fund}/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meeting_date: newMeeting.meeting_date,
        title: newMeeting.title.trim() || null,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not create the meeting.");
      return;
    }
    setSelectedId(data.meeting.id);
    setPresent(null);
    setNewMeeting({ ...newMeeting, title: "" });
    router.refresh();
  }

  async function save() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/${fund}/meetings/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attendance: members.map((m) => ({
          user_id: m.userId,
          present: effective[m.userId] ?? false,
        })),
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Could not save attendance.");
      return;
    }
    setNotice(`Saved ${data.saved} rows.`);
    setPresent(null);
    router.refresh();
  }

  const presentCount = Object.values(effective).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <form onSubmit={createMeeting} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Meeting date</span>
          <input
            type="date"
            required
            value={newMeeting.meeting_date}
            onChange={(e) =>
              setNewMeeting({ ...newMeeting, meeting_date: e.target.value })
            }
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Title (optional)</span>
          <input
            value={newMeeting.title}
            onChange={(e) =>
              setNewMeeting({ ...newMeeting, title: e.target.value })
            }
            className={inputClass}
            placeholder="Healthcare bull pitch"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={busy}>
          Add meeting
        </Button>
      </form>

      {meetings.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted">
              Meeting
              <select
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setPresent(null);
                  setNotice(null);
                }}
                className={`ml-2 ${inputClass}`}
              >
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatDate(m.meeting_date)}
                    {m.title ? ` · ${m.title}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm text-muted tabular-nums">
              {presentCount}/{members.length} present
            </span>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2">
            {members.map((m) => (
              <label
                key={m.userId}
                className="flex items-center gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={effective[m.userId] ?? false}
                  onChange={(e) =>
                    setPresent({
                      ...effective,
                      [m.userId]: e.target.checked,
                    })
                  }
                />
                {m.name}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy || !selectedId}>
              {busy ? "Saving…" : "Save attendance"}
            </Button>
            {notice && <span className="text-sm text-gain">{notice}</span>}
            {error && <span className="text-sm text-loss">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
