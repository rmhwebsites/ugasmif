// Plain-language names for the audit log's action and record codes, so the
// filters read "Membership change" instead of "membership.update". Codes come
// from logAudit calls in src/app/api and the SQL functions in
// supabase/migrations. A code missing here still shows, as itself.

export const AUDIT_ACTION_GROUPS: {
  label: string;
  actions: { code: string; label: string }[];
}[] = [
  {
    label: "Trades and holdings",
    actions: [
      { code: "trade.execute", label: "Trade executed" },
      { code: "ticket.create", label: "Ticket created" },
      { code: "ticket.cancel", label: "Ticket cancelled" },
      { code: "holding.create", label: "Holding added" },
      { code: "mark.create", label: "Bond mark entered" },
      { code: "mark.csv_upload", label: "Bond marks uploaded" },
      { code: "cash.movement", label: "Cash movement" },
      { code: "snapshots.import", label: "Performance history imported" },
    ],
  },
  {
    label: "Pitches and votes",
    actions: [
      { code: "pitch.create", label: "Pitch drafted" },
      { code: "pitch.update", label: "Pitch edited" },
      { code: "pitch.submit", label: "Pitch submitted" },
      { code: "pitch.schedule", label: "Pitch scheduled" },
      { code: "pitch.open_vote", label: "Vote opened" },
      { code: "pitch.close_vote", label: "Vote closed" },
      { code: "pitch.remind", label: "Vote reminder sent" },
      { code: "pitch.withdraw", label: "Pitch withdrawn" },
      { code: "pitch.delete", label: "Pitch deleted" },
      { code: "pitch.file_upload", label: "Pitch file uploaded" },
      { code: "pitch.file_delete", label: "Pitch file deleted" },
      { code: "vote.cast", label: "Vote cast" },
      { code: "cron.votes", label: "Expired votes closed (nightly)" },
    ],
  },
  {
    label: "Sectors",
    actions: [
      { code: "sector.create", label: "Sector added" },
      { code: "sector.update", label: "Sector edited" },
      { code: "sector.delete", label: "Sector deleted" },
      { code: "sector_targets.set", label: "Sector targets set" },
    ],
  },
  {
    label: "Members and accounts",
    actions: [
      { code: "membership.create", label: "Member added" },
      { code: "membership.update", label: "Membership change" },
      { code: "roster.import", label: "Roster imported" },
      { code: "profile.update", label: "Profile edited" },
      { code: "profile.onboarded", label: "Finished sign-up" },
      { code: "auth.admin_reset", label: "Password reset" },
      { code: "auth.set_temp_password", label: "Temporary password set" },
      { code: "admin.grant", label: "App admin granted" },
    ],
  },
  {
    label: "Club",
    actions: [
      { code: "meeting.create", label: "Meeting added" },
      { code: "meeting.delete", label: "Meeting deleted" },
      { code: "attendance.record", label: "Attendance recorded" },
      { code: "update.post", label: "Update posted" },
      { code: "update.edit", label: "Update edited" },
      { code: "update.delete", label: "Update deleted" },
    ],
  },
  {
    label: "Setup",
    actions: [
      { code: "fund.settings", label: "Settings change" },
      { code: "year.rollover", label: "New academic year" },
      { code: "backup.trigger", label: "Backup run by hand" },
      { code: "cron.backup", label: "Nightly backup" },
    ],
  },
];

const ACTION_LABELS = new Map(
  AUDIT_ACTION_GROUPS.flatMap((g) => g.actions.map((a) => [a.code, a.label]))
);

export const AUDIT_ENTITIES: { code: string; label: string }[] = [
  { code: "trade_tickets", label: "Trade tickets" },
  { code: "holdings", label: "Holdings" },
  { code: "bond_marks", label: "Bond marks" },
  { code: "cash_movements", label: "Cash" },
  { code: "fund_snapshots", label: "Performance history" },
  { code: "treasury_curve", label: "Treasury curve" },
  { code: "pitches", label: "Pitches" },
  { code: "pitch_files", label: "Pitch files" },
  { code: "votes", label: "Votes" },
  { code: "sectors", label: "Sectors" },
  { code: "sector_targets", label: "Sector targets" },
  { code: "memberships", label: "Members" },
  { code: "roster_imports", label: "Roster imports" },
  { code: "profiles", label: "Accounts" },
  { code: "meetings", label: "Meetings" },
  { code: "meeting_attendance", label: "Attendance" },
  { code: "fund_updates", label: "Updates" },
  { code: "funds", label: "Fund settings" },
  { code: "academic_years", label: "Academic years" },
  { code: "backup_runs", label: "Backups" },
];

const ENTITY_LABELS = new Map(AUDIT_ENTITIES.map((e) => [e.code, e.label]));

export function auditActionLabel(code: string): string {
  return ACTION_LABELS.get(code) ?? code;
}

export function auditEntityLabel(code: string): string {
  return ENTITY_LABELS.get(code) ?? code;
}

export function isKnownAuditAction(code: string): boolean {
  return ACTION_LABELS.has(code);
}
