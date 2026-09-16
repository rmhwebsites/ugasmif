// Google Sheets + JSON backup (spec Section 15). `runBackup` dumps every
// table to the SMIF backup spreadsheet (one tab per spec row), writes a
// gzipped JSON export of every table to the `backups` storage bucket
// (90-day retention), and records the run in `backup_runs`. Failures email
// the app admins. `appendTradeRow` appends one row to the right fund's
// Trades tab in real time after an execute; the nightly run rewrites the
// whole tab so the two can never drift.
//
// Service-role client is allowed here (backup lib, spec Section 9).

import "server-only";
import { gzipSync } from "node:zlib";
import { google, type sheets_v4 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { valueFund } from "@/lib/valuation";
import { sendEmail } from "@/lib/emails/send";
import { easternDateString } from "@/lib/format";
import {
  applyBrandFormatting,
  BACKUP_SPREADSHEET_TITLE,
} from "@/lib/sheets/format";
import type {
  AcademicYear,
  AuditLogEntry,
  BackupRun,
  BondMark,
  CashMovement,
  Fund,
  FundSlug,
  FundSnapshot,
  FundUpdate,
  Holding,
  HoldingValuation,
  Meeting,
  MeetingAttendance,
  Membership,
  Pitch,
  Profile,
  Sector,
  SectorTarget,
  Trade,
  TradeTicket,
  Vote,
} from "@/types/domain";

type Cell = string | number | boolean | null;

interface Tab {
  name: string;
  header: string[];
  rows: Cell[][];
}

const RETENTION_DAYS = 90;
const AUDIT_LOG_LIMIT = 5000;

// ── Google Sheets client ────────────────────────────────────────────────────

interface SheetsHandle {
  api: sheets_v4.Sheets;
  spreadsheetId: string;
}

function getSheetsHandle(): SheetsHandle | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !spreadsheetId) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { api: google.sheets({ version: "v4", auth }), spreadsheetId };
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

const PAGE = 1000;

/** Pages through PostgREST's 1000-row cap so backups are always complete. */
async function fetchAll<T>(
  service: SupabaseClient,
  table: string,
  opts: { orderBy?: string; ascending?: boolean; limit?: number } = {}
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const to = opts.limit
      ? Math.min(from + PAGE, opts.limit) - 1
      : from + PAGE - 1;
    let query = service.from(table).select("*").range(from, to);
    if (opts.orderBy) {
      query = query.order(opts.orderBy, { ascending: opts.ascending ?? true });
    }
    const { data, error } = await query;
    if (error) throw new Error(`backup: ${table}: ${error.message}`);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE || (opts.limit && out.length >= opts.limit)) break;
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown, max = 2000): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

// ── Trades tab (shared with appendTradeRow) ─────────────────────────────────

const TRADES_HEADER = [
  "ID",
  "Trade Date",
  "Action",
  "Holding",
  "Symbol",
  "Quantity",
  "Price",
  "Amount",
  "Accrued Interest",
  "Commission",
  "Executed By",
  "Ticket ID",
  "Reverses Trade",
  "Notes",
  "Created At",
];

function tradeRow(
  t: Trade,
  holdingName: string,
  symbol: string,
  executedBy: string
): Cell[] {
  return [
    t.id,
    t.trade_date,
    t.action,
    holdingName,
    symbol,
    num(t.quantity),
    num(t.price),
    num(t.amount),
    num(t.accrued_interest),
    num(t.commission),
    executedBy,
    t.ticket_id ?? "",
    t.reverses_trade_id ?? "",
    text(t.notes, 500),
    t.created_at,
  ];
}

// ── Sheet writing ───────────────────────────────────────────────────────────

/**
 * Ensures every tab exists (with a big enough grid), then clears and
 * rewrites each tab's values, then applies one-time brand formatting.
 */
async function writeTabs(handle: SheetsHandle, tabs: Tab[]): Promise<void> {
  const { api, spreadsheetId } = handle;

  const spreadsheet = await api.spreadsheets.get({ spreadsheetId });
  const existing = new Map<
    string,
    { sheetId: number; rowCount: number; colCount: number }
  >();
  for (const s of spreadsheet.data.sheets ?? []) {
    const p = s.properties;
    if (p?.title && p.sheetId !== undefined && p.sheetId !== null) {
      existing.set(p.title, {
        sheetId: p.sheetId,
        rowCount: p.gridProperties?.rowCount ?? 1000,
        colCount: p.gridProperties?.columnCount ?? 26,
      });
    }
  }

  const structural: sheets_v4.Schema$Request[] = [];
  for (const tab of tabs) {
    const needRows = tab.rows.length + 20;
    const needCols = Math.max(tab.header.length, 26);
    const found = existing.get(tab.name);
    if (!found) {
      structural.push({
        addSheet: {
          properties: {
            title: tab.name,
            gridProperties: {
              rowCount: Math.max(needRows, 1000),
              columnCount: needCols,
            },
          },
        },
      });
    } else if (found.rowCount < needRows || found.colCount < tab.header.length) {
      structural.push({
        updateSheetProperties: {
          properties: {
            sheetId: found.sheetId,
            gridProperties: {
              rowCount: Math.max(found.rowCount, needRows),
              columnCount: Math.max(found.colCount, tab.header.length),
            },
          },
          fields: "gridProperties(rowCount,columnCount)",
        },
      });
    }
  }
  if (structural.length > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: structural },
    });
  }

  // Clear then rewrite every tab (batched — same clear+update-per-tab
  // mechanism as GBH, in two round trips to stay inside write quotas).
  await api.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: tabs.map((t) => `'${t.name}'`) },
  });
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: tabs.map((t) => ({
        range: `'${t.name}'!A1`,
        values: [t.header, ...t.rows],
      })),
    },
  });

  // One-time branding (checks the spreadsheet title internally).
  await applyBrandFormatting(
    api,
    spreadsheetId,
    tabs.map((t) => ({ name: t.name, cols: t.header.length }))
  );
}

// ── The backup run ──────────────────────────────────────────────────────────

/**
 * Full backup per spec Section 15: every table to the branded spreadsheet,
 * plus a gzipped JSON export to the `backups` bucket. Writes a `backup_runs`
 * row and returns it; on failure the row is marked failed and app admins are
 * emailed. Returns rather than throws so callers always get the run status.
 */
export async function runBackup(triggeredBy: string): Promise<BackupRun> {
  const service = createServiceClient();

  const { data: inserted, error: insertError } = await service
    .from("backup_runs")
    .insert({ triggered_by: triggeredBy })
    .select("*")
    .single();
  if (insertError || !inserted) {
    throw new Error(
      `backup: could not record backup run: ${insertError?.message ?? "no row"}`
    );
  }
  const run = inserted as BackupRun;

  let tabsWritten = 0;
  let rowsWritten = 0;

  try {
    // ── Fetch every table ──────────────────────────────────────────────────
    const [funds, academicYears, profiles, sectors, memberships] =
      await Promise.all([
        fetchAll<Fund>(service, "funds", { orderBy: "slug" }),
        fetchAll<AcademicYear>(service, "academic_years", {
          orderBy: "starts_on",
        }),
        fetchAll<Profile>(service, "profiles", { orderBy: "full_name" }),
        fetchAll<Sector>(service, "sectors", { orderBy: "sort_order" }),
        fetchAll<Membership>(service, "memberships", {
          orderBy: "created_at",
        }),
      ]);

    const [holdings, bondMarks, fundSnapshots, sectorTargets, treasuryCurve] =
      await Promise.all([
        fetchAll<Holding>(service, "holdings", { orderBy: "name" }),
        fetchAll<BondMark>(service, "bond_marks", {
          orderBy: "marked_at",
          ascending: false,
        }),
        fetchAll<FundSnapshot>(service, "fund_snapshots", {
          orderBy: "snapshot_date",
        }),
        fetchAll<SectorTarget>(service, "sector_targets", {
          orderBy: "effective_on",
        }),
        fetchAll<Record<string, unknown>>(service, "treasury_curve", {
          orderBy: "curve_date",
        }),
      ]);

    const [pitches, pitchFiles, votes, tickets, trades] = await Promise.all([
      fetchAll<Pitch>(service, "pitches", { orderBy: "created_at" }),
      fetchAll<Record<string, unknown>>(service, "pitch_files", {
        orderBy: "created_at",
      }),
      fetchAll<Vote>(service, "votes", { orderBy: "cast_at" }),
      fetchAll<TradeTicket>(service, "trade_tickets", {
        orderBy: "created_at",
      }),
      fetchAll<Trade>(service, "trades", { orderBy: "trade_date" }),
    ]);

    const [
      cashMovements,
      meetings,
      attendance,
      updates,
      updateReads,
      auditLog,
      rosterImports,
      backupRuns,
      priceSnapshots,
    ] = await Promise.all([
      fetchAll<CashMovement>(service, "cash_movements", {
        orderBy: "occurred_on",
      }),
      fetchAll<Meeting>(service, "meetings", { orderBy: "meeting_date" }),
      fetchAll<MeetingAttendance>(service, "meeting_attendance", {}),
      fetchAll<FundUpdate>(service, "fund_updates", {
        orderBy: "published_at",
      }),
      fetchAll<Record<string, unknown>>(service, "update_reads", {}),
      fetchAll<AuditLogEntry>(service, "audit_log", {
        orderBy: "created_at",
        ascending: false,
        limit: AUDIT_LOG_LIMIT,
      }),
      fetchAll<Record<string, unknown>>(service, "roster_imports", {
        orderBy: "created_at",
      }),
      fetchAll<BackupRun>(service, "backup_runs", {
        orderBy: "started_at",
        ascending: false,
        limit: 1000,
      }),
      fetchAll<Record<string, unknown>>(service, "price_snapshots", {
        orderBy: "as_of",
        ascending: false,
        limit: 5000,
      }),
    ]);

    // ── Lookup maps ────────────────────────────────────────────────────────
    const profileName = new Map(profiles.map((p) => [p.id, p.full_name]));
    const sectorName = new Map(sectors.map((s) => [s.id, s.name]));
    const fundById = new Map(funds.map((f) => [f.id, f]));
    const yearLabel = new Map(academicYears.map((y) => [y.id, y.label]));
    const holdingById = new Map(holdings.map((h) => [h.id, h]));
    const pitchById = new Map(pitches.map((p) => [p.id, p]));
    const meetingById = new Map(meetings.map((m) => [m.id, m]));

    const who = (id: string | null | undefined): string =>
      id ? (profileName.get(id) ?? id) : "";
    const sec = (id: string | null | undefined): string =>
      id ? (sectorName.get(id) ?? "") : "";
    const fundLabel = (id: string | null | undefined): string => {
      const f = id ? fundById.get(id) : undefined;
      return f ? capitalize(f.slug) : "";
    };

    // Market-value column for the two holdings tabs, computed the same way
    // the app values the fund. Valuation failure never fails the backup.
    const valuations = new Map<string, HoldingValuation>();
    for (const fund of funds) {
      try {
        const v = await valueFund(service, fund.id);
        for (const hv of v.holdings) valuations.set(hv.holding.id, hv);
      } catch (err) {
        console.error(`backup: valueFund failed for ${fund.slug}:`, err);
      }
    }

    // ── Build tabs (one per spec Section 15 row) ───────────────────────────
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", {
      timeZone: "America/New_York",
    });

    const tabs: Tab[] = [];

    tabs.push({
      name: "README",
      header: [BACKUP_SPREADSHEET_TITLE, ""],
      rows: [
        [
          "What this is",
          "A nightly export of every SMIF Hub table, written by the app.",
        ],
        [
          "Do not edit",
          "The app overwrites this spreadsheet nightly. Edits here are lost and never reach the app.",
        ],
        ["Last run", `${timestamp} ET`],
        ["Triggered by", triggeredBy],
        [
          "Service account",
          process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "(not configured)",
        ],
        [
          "Restore",
          "Use the JSON export in the Supabase 'backups' storage bucket (YYYY-MM-DD.json.gz) — see HANDOVER.md. This sheet is for humans.",
        ],
      ],
    });

    for (const fund of funds) {
      const prefix = capitalize(fund.slug);
      const fundHoldings = holdings.filter((h) => h.fund_id === fund.id);
      tabs.push({
        name: `${prefix} Holdings`,
        header: [
          "ID",
          "Symbol",
          "CUSIP",
          "Name",
          "Issuer",
          "Instrument",
          "Sector",
          "Quantity",
          "Avg Cost",
          "Coupon %",
          "Maturity",
          "Rating",
          "Duration",
          "YTM %",
          "Pricing Method",
          "Active",
          "Opened",
          "Closed",
          "Latest Price",
          "Price Source",
          "Market Value",
          "Weight %",
          "Notes",
        ],
        rows: fundHoldings.map((h) => {
          const v = valuations.get(h.id);
          return [
            h.id,
            h.symbol ?? "",
            h.cusip ?? "",
            h.name,
            h.issuer ?? "",
            h.instrument_type,
            sec(h.sector_id),
            num(h.quantity),
            num(h.avg_cost),
            num(h.coupon_rate),
            h.maturity_date ?? "",
            h.rating ?? "",
            num(h.duration),
            num(h.ytm),
            h.pricing_method,
            h.is_active,
            h.opened_on ?? "",
            h.closed_on ?? "",
            v ? num(v.price) : null,
            v ? v.priceSource : "",
            v ? num(v.marketValue) : null,
            v ? num(v.weightPct) : null,
            text(h.notes, 500),
          ];
        }),
      });

      const fundTrades = trades.filter((t) => t.fund_id === fund.id);
      tabs.push({
        name: `${prefix} Trades`,
        header: TRADES_HEADER,
        rows: fundTrades.map((t) => {
          const h = holdingById.get(t.holding_id);
          return tradeRow(t, h?.name ?? "", h?.symbol ?? "", who(t.executed_by));
        }),
      });

      // Pending and cancelled tickets; executed ones live on as trades.
      const fundTickets = tickets.filter(
        (t) => t.fund_id === fund.id && t.status !== "executed"
      );
      tabs.push({
        name: `${prefix} Tickets`,
        header: [
          "ID",
          "Status",
          "Action",
          "Name",
          "Symbol",
          "CUSIP",
          "Instrument",
          "Sector",
          "Est Quantity",
          "Est Price",
          "Est Amount",
          "Created By",
          "Pitch ID",
          "Notes",
          "Created At",
        ],
        rows: fundTickets.map((t) => [
          t.id,
          t.status,
          t.action,
          t.name,
          t.symbol ?? "",
          t.cusip ?? "",
          t.instrument_type,
          sec(t.sector_id),
          num(t.est_quantity),
          num(t.est_price),
          num(t.est_amount),
          who(t.created_by),
          t.pitch_id ?? "",
          text(t.notes, 500),
          t.created_at,
        ]),
      });

      const fundPitches = pitches.filter((p) => p.fund_id === fund.id);
      tabs.push({
        name: `${prefix} Pitches`,
        header: [
          "ID",
          "Title",
          "Status",
          "Type",
          "Action",
          "Sector",
          "Author",
          "Symbol",
          "Instrument",
          "Proposed Amount",
          "Result %",
          "Votes Yes",
          "Votes No",
          "Eligible",
          "Scheduled For",
          "Vote Opens",
          "Vote Closes",
          "Closed At",
          "Created At",
        ],
        rows: fundPitches.map((p) => [
          p.id,
          p.title,
          p.status,
          p.pitch_type,
          p.action,
          sec(p.sector_id),
          who(p.author_id),
          p.symbol ?? "",
          p.instrument_name ?? "",
          num(p.proposed_amount),
          num(p.result_pct),
          p.votes_yes,
          p.votes_no,
          p.eligible_voters ?? null,
          p.scheduled_for ?? "",
          p.vote_opens_at ?? "",
          p.vote_closes_at ?? "",
          p.closed_at ?? "",
          p.created_at,
        ]),
      });
    }

    tabs.push({
      name: "Votes",
      header: ["Pitch ID", "Pitch Title", "Voter", "Choice", "Cast At"],
      rows: votes.map((v) => [
        v.pitch_id,
        pitchById.get(v.pitch_id)?.title ?? "",
        who(v.voter_id),
        v.choice,
        v.cast_at,
      ]),
    });

    tabs.push({
      name: "Bond Marks",
      header: [
        "ID",
        "Holding",
        "Clean Price",
        "YTM %",
        "Duration",
        "Source",
        "Marked By",
        "Marked At",
        "Notes",
      ],
      rows: bondMarks.map((m) => [
        m.id,
        holdingById.get(m.holding_id)?.name ?? m.holding_id,
        num(m.clean_price),
        num(m.ytm),
        num(m.duration),
        m.source,
        who(m.marked_by),
        m.marked_at,
        text(m.notes, 500),
      ]),
    });

    tabs.push({
      name: "Fund Snapshots",
      header: [
        "Fund",
        "Date",
        "Market Value",
        "Cash",
        "Total Value",
        "Benchmark",
        "Benchmark Close",
        "Benchmark Adj Close",
      ],
      rows: fundSnapshots.map((s) => [
        fundLabel(s.fund_id),
        s.snapshot_date,
        num(s.market_value),
        num(s.cash),
        num(s.total_value),
        s.benchmark_symbol,
        num(s.benchmark_close),
        num(s.benchmark_adj_close),
      ]),
    });

    tabs.push({
      name: "Sector Targets",
      header: [
        "Fund",
        "Sector",
        "Target %",
        "Benchmark %",
        "Effective On",
        "Set By",
        "Notes",
        "Created At",
      ],
      rows: sectorTargets.map((t) => [
        fundLabel(t.fund_id),
        sec(t.sector_id),
        num(t.target_weight_pct),
        num(t.benchmark_weight_pct),
        t.effective_on,
        who(t.set_by),
        text(t.notes, 500),
        t.created_at,
      ]),
    });

    // Every membership across years. No passwords, no auth ids.
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    tabs.push({
      name: "Members",
      header: [
        "Name",
        "Email",
        "Fund",
        "Year",
        "Role",
        "Sector",
        "Sector Leader",
        "Status",
        "Title Override",
      ],
      rows: memberships.map((m) => {
        const p = profileById.get(m.user_id);
        return [
          p?.full_name ?? "",
          p?.email ?? "",
          fundLabel(m.fund_id),
          yearLabel.get(m.academic_year_id) ?? "",
          m.role,
          sec(m.sector_id),
          m.is_sector_leader,
          m.status,
          m.title_override ?? "",
        ];
      }),
    });

    tabs.push({
      name: "Sectors",
      header: ["Fund", "Name", "Slug", "Sort", "Strategy Team", "Active"],
      rows: sectors.map((s) => [
        fundLabel(s.fund_id),
        s.name,
        s.slug,
        s.sort_order,
        s.is_strategy_team,
        s.is_active,
      ]),
    });

    tabs.push({
      name: "Funds",
      header: [
        "Slug",
        "Name",
        "Asset Class",
        "Benchmark",
        "Benchmark Name",
        "Vote Threshold %",
        "Quorum %",
        "Vote Window (h)",
        "Cash Balance",
        "Inception",
        "Meeting Day",
        "Allowed Domains",
        "Settings",
      ],
      rows: funds.map((f) => [
        f.slug,
        f.name,
        f.asset_class,
        f.benchmark_symbol,
        f.benchmark_name,
        num(f.vote_pass_threshold_pct),
        num(f.vote_quorum_pct),
        f.vote_default_window_hours,
        num(f.cash_balance),
        f.inception_date ?? "",
        f.meeting_day ?? null,
        (f.allowed_email_domains ?? []).join(", "),
        text(f.settings, 1000),
      ]),
    });

    tabs.push({
      name: "Academic Years",
      header: ["Label", "Starts", "Ends", "Current"],
      rows: academicYears.map((y) => [
        y.label,
        y.starts_on,
        y.ends_on,
        y.is_current,
      ]),
    });

    tabs.push({
      name: "Cash Movements",
      header: [
        "Fund",
        "Kind",
        "Amount",
        "Holding",
        "Occurred On",
        "Recorded By",
        "Notes",
        "Created At",
      ],
      rows: cashMovements.map((c) => [
        fundLabel(c.fund_id),
        c.kind,
        num(c.amount),
        c.holding_id ? (holdingById.get(c.holding_id)?.name ?? c.holding_id) : "",
        c.occurred_on,
        who(c.recorded_by),
        text(c.notes, 500),
        c.created_at,
      ]),
    });

    tabs.push({
      name: "Meetings",
      header: ["Fund", "Date", "Title", "Notes"],
      rows: meetings.map((m) => [
        fundLabel(m.fund_id),
        m.meeting_date,
        m.title ?? "",
        text(m.notes, 500),
      ]),
    });

    tabs.push({
      name: "Attendance",
      header: ["Meeting Date", "Fund", "Member", "Present"],
      rows: attendance.map((a) => {
        const m = meetingById.get(a.meeting_id);
        return [
          m?.meeting_date ?? "",
          fundLabel(m?.fund_id),
          who(a.user_id),
          a.present,
        ];
      }),
    });

    tabs.push({
      name: "Updates",
      header: ["Fund", "Title", "Author", "Pinned", "Published At", "Body"],
      rows: updates.map((u) => [
        fundLabel(u.fund_id),
        u.title,
        who(u.author_id),
        u.pinned,
        u.published_at,
        text(u.body_md, 2000),
      ]),
    });

    tabs.push({
      name: "Audit Log",
      header: [
        "ID",
        "Time",
        "Actor",
        "Fund",
        "Action",
        "Entity",
        "Entity ID",
        "Before",
        "After",
        "IP",
      ],
      rows: auditLog.map((a) => [
        a.id,
        a.created_at,
        a.actor_id ? who(a.actor_id) : "system",
        fundLabel(a.fund_id),
        a.action,
        a.entity,
        a.entity_id ?? "",
        text(a.before, 500),
        text(a.after, 500),
        a.ip ?? "",
      ]),
    });

    tabs.push({
      name: "Backup Runs",
      header: [
        "Started",
        "Finished",
        "Status",
        "Tabs",
        "Rows",
        "Error",
        "Triggered By",
      ],
      rows: backupRuns.map((b) => [
        b.started_at,
        b.finished_at ?? "",
        b.status,
        b.tabs_written ?? null,
        b.rows_written ?? null,
        text(b.error, 500),
        b.triggered_by === "cron" ? "cron" : who(b.triggered_by),
      ]),
    });

    // Total rows exported — same count the JSON carries.
    const tables: Record<string, unknown[]> = {
      funds,
      academic_years: academicYears,
      profiles,
      sectors,
      memberships,
      holdings,
      bond_marks: bondMarks,
      treasury_curve: treasuryCurve,
      fund_snapshots: fundSnapshots,
      sector_targets: sectorTargets,
      pitches,
      pitch_files: pitchFiles,
      votes,
      trade_tickets: tickets,
      trades,
      cash_movements: cashMovements,
      meetings,
      meeting_attendance: attendance,
      fund_updates: updates,
      update_reads: updateReads,
      audit_log: auditLog,
      roster_imports: rosterImports,
      backup_runs: backupRuns,
      price_snapshots: priceSnapshots,
    };
    rowsWritten = Object.values(tables).reduce((sum, t) => sum + t.length, 0);

    // ── Google Sheets ──────────────────────────────────────────────────────
    const handle = getSheetsHandle();
    if (handle) {
      await writeTabs(handle, tabs);
      tabsWritten = tabs.length;
    } else {
      console.error(
        "backup: Google Sheets not configured (GOOGLE_* env vars missing); JSON export only"
      );
    }

    // ── JSON export to storage (restore source of truth) ───────────────────
    const dateStr = easternDateString(now);
    const payload = JSON.stringify({
      exported_at: now.toISOString(),
      app: "SMIF Hub",
      tables,
    });
    const gz = gzipSync(Buffer.from(payload, "utf8"));
    const { error: uploadError } = await service.storage
      .from("backups")
      .upload(`${dateStr}.json.gz`, gz, {
        contentType: "application/gzip",
        upsert: true,
      });
    if (uploadError) {
      throw new Error(`backup: storage upload failed: ${uploadError.message}`);
    }

    // Retention: delete exports older than 90 days.
    try {
      const { data: objects } = await service.storage
        .from("backups")
        .list("", { limit: 1000 });
      const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
      const stale = (objects ?? []).filter((o) => {
        const m = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(o.name);
        const when = m
          ? Date.parse(`${m[1]}T00:00:00Z`)
          : o.created_at
            ? Date.parse(o.created_at)
            : NaN;
        return Number.isFinite(when) && when < cutoff;
      });
      if (stale.length > 0) {
        await service.storage
          .from("backups")
          .remove(stale.map((o) => o.name));
      }
    } catch (pruneErr) {
      console.error("backup: retention prune failed:", pruneErr);
    }

    // ── Mark ok ────────────────────────────────────────────────────────────
    const done = {
      finished_at: new Date().toISOString(),
      status: "ok" as const,
      tabs_written: tabsWritten,
      rows_written: rowsWritten,
      error: null,
    };
    const { data: updated } = await service
      .from("backup_runs")
      .update(done)
      .eq("id", run.id)
      .select("*")
      .single();
    return (updated as BackupRun) ?? { ...run, ...done };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("backup failed:", err);

    const failed = {
      finished_at: new Date().toISOString(),
      status: "failed" as const,
      tabs_written: tabsWritten,
      rows_written: rowsWritten,
      error: message,
    };
    const { data: updated } = await service
      .from("backup_runs")
      .update(failed)
      .eq("id", run.id)
      .select("*")
      .single();

    // Failures email the app admins (spec Section 15/16).
    try {
      const { data: admins } = await service
        .from("profiles")
        .select("email")
        .eq("is_app_admin", true);
      const to = ((admins as { email: string }[]) ?? [])
        .map((a) => a.email)
        .filter(Boolean);
      await sendEmail({
        to,
        subject: "SMIF Hub backup failed",
        heading: "Nightly backup failed",
        bodyLines: [
          `The backup run started ${run.started_at} (triggered by ${triggeredBy}) failed.`,
          `Error: ${message}`,
          "The previous JSON export in the 'backups' bucket is still intact.",
        ],
        ctaLabel: "Open admin",
        ctaPath: "/admin",
      });
    } catch (mailErr) {
      console.error("backup: failure email failed:", mailErr);
    }

    return (updated as BackupRun) ?? { ...run, ...failed };
  }
}

// ── Real-time trade append ──────────────────────────────────────────────────

/**
 * Appends one executed trade to the fund's Trades tab immediately after
 * execute, so the sheet is current between nightly runs (which rewrite the
 * whole tab). Never throws — a sheet hiccup must not break trade execution.
 */
export async function appendTradeRow(
  fundSlug: FundSlug,
  trade: Trade,
  holdingName: string
): Promise<void> {
  try {
    const handle = getSheetsHandle();
    if (!handle) return; // Sheets not configured — nightly JSON still covers it
    const tabName = `${capitalize(fundSlug)} Trades`;
    await handle.api.spreadsheets.values.append({
      spreadsheetId: handle.spreadsheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [
            ...tradeRow(trade, holdingName, "", trade.executed_by),
          ] as (string | number | boolean | null)[],
        ],
      },
    });
  } catch (err) {
    console.error("appendTradeRow failed:", err);
  }
}
