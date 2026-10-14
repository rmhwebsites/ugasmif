"use client";

// Take attendance and add meetings (SPEC 11.3 /admin/attendance). Taking
// attendance is the weekly job, so it comes first and opens on the meeting
// you most likely mean: the one asked for (?meeting=<id>), else today's,
// else the most recent one before today (attendance is taken on the day or
// after it, never ahead), else the next one coming up. The picker groups
// meetings as Today, Recent and Upcoming so a future date is never the one
// you tick boxes against by accident.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import type { Meeting, MeetingAttendance } from "@/types/domain";

const inputClass =
  "rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export interface AttendanceMember {
  userId: string;
  name: string;
}

function meetingLabel(m: Meeting): string {
  return `${formatDate(m.meeting_date)}${m.title ? ` · ${m.title}` : ""}`;
}

/** The meeting the editor opens on (see the header comment). */
export function defaultMeetingId(
  meetings: Meeting[],
  today: string,
  requested?: string | null
): string {
  if (requested && meetings.some((m) => m.id === requested)) return requested;
  const onToday = meetings.find((m) => m.meeting_date === today);
  if (onToday) return onToday.id;
  const recent = meetings
    .filter((m) => m.meeting_date < today)
    .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))[0];
  if (recent) return recent.id;
  const upcoming = meetings
    .filter((m) => m.meeting_date > today)
    .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0];
  return upcoming?.id ?? meetings[0]?.id ?? "";
}

export function AttendanceEditor({
  fund,
  meetings,
  members,
  attendance,
  today,
  initialMeetingId,
}: {
  fund: string;
  meetings: Meeting[];
  members: AttendanceMember[];
  attendance: MeetingAttendance[];
  /** Today in Eastern time, YYYY-MM-DD, from the server. */
  today: string;
  /** From ?meeting=<id>, e.g. a row on the Meetings page. */
  initialMeetingId?: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(() =>
    defaultMeetingId(meetings, today, initialMeetingId)
  );
  const [newMeeting, setNewMeeting] = useState({
    meeting_date: today,
    title: "",
  });
  const [present, setPresent] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const todays = meetings.filter((m) => m.meeting_date === today);
  const recent = meetings
    .filter((m) => m.meeting_date < today)
    .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  const upcoming = meetings
    .filter((m) => m.meeting_date > today)
    .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const selected = meetings.find((m) => m.id === selectedId) ?? null;
  const taken = attendance.some((a) => a.meeting_id === selectedId);

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
  const presentCount = Object.values(effective).filter(Boolean).length;

  async function createMeeting(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
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
      setAddError(data?.error ?? "Could not create the meeting.");
      return;
    }
    setSelectedId(data.meeting.id);
    setPresent(null);
    setNotice(null);
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
    setNotice(
      `Saved for ${selected ? meetingLabel(selected) : "this meeting"}: ${presentCount} of ${members.length} present.`
    );
    setPresent(null);
    router.refresh();
  }

  const option = (m: Meeting) => (
    <option key={m.id} value={m.id}>
      {meetingLabel(m)}
    </option>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader title="Take attendance" />
        <div className="space-y-4 p-4 sm:p-6">
          {meetings.length === 0 ? (
            <p className="text-sm text-muted">
              No meetings yet. Add this term&apos;s sessions below, then take
              attendance here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted">
                  Meeting
                  <select
                    value={selectedId}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setPresent(null);
                      setNotice(null);
                      setError(null);
                    }}
                    className={`min-w-0 max-w-full cursor-pointer text-foreground ${inputClass}`}
                  >
                    {todays.length > 0 && (
                      <optgroup label="Today">{todays.map(option)}</optgroup>
                    )}
                    {recent.length > 0 && (
                      <optgroup label="Recent">{recent.map(option)}</optgroup>
                    )}
                    {upcoming.length > 0 && (
                      <optgroup label="Upcoming">
                        {upcoming.map(option)}
                      </optgroup>
                    )}
                  </select>
                </label>
                <span className="text-sm text-muted tabular-nums">
                  {presentCount}/{members.length} present
                  {" · "}
                  {taken ? "saved" : "not taken yet"}
                </span>
              </div>

              {selected && selected.meeting_date > today && (
                <p className="text-xs text-muted">
                  This meeting is on {formatDate(selected.meeting_date)}, after
                  today.
                </p>
              )}

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

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={save} disabled={busy || !selectedId}>
                  {busy ? "Saving…" : "Save attendance"}
                </Button>
                {notice && <span className="text-sm text-gain">{notice}</span>}
                {error && <span className="text-sm text-loss">{error}</span>}
              </div>
            </>
          )}
        </div>
      </Card>

      <div id="add-meeting" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader title="Add a meeting" />
          <form
            onSubmit={createMeeting}
            className="flex flex-wrap items-end gap-2 p-4 sm:p-6"
          >
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
              <span className="mb-1 block text-xs text-muted">
                Title (optional)
              </span>
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
            {addError && (
              <p className="w-full text-sm text-loss">{addError}</p>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
