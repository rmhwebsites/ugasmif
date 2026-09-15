// Domain types for SMIF Hub. These mirror supabase/migrations/0001_init.sql.
// Regenerate mechanically if the schema changes; keep names identical to columns.

export type FundSlug = "athena" | "arch";
export type AssetClass = "equity" | "fixed_income";

export type MembershipRole =
  | "president"
  | "vice_president"
  | "portfolio_manager"
  | "alumni_relations"
  | "sector_leader"
  | "analyst"
  | "viewer";

export type MembershipStatus = "active" | "alumni" | "inactive";

export type InstrumentType =
  | "equity"
  | "etf"
  | "treasury"
  | "corporate"
  | "agency_mbs"
  | "municipal"
  | "money_market";

export type PricingMethod = "live" | "treasury_curve" | "manual";
export type DayCount = "30/360" | "ACT/ACT" | "ACT/360";

export type PitchType = "bull" | "bear" | "single" | "rebalance";
export type PitchAction = "buy" | "add" | "trim" | "sell" | "rebalance";
export type PitchStatus =
  | "draft"
  | "submitted"
  | "scheduled"
  | "voting"
  | "passed"
  | "failed"
  | "withdrawn"
  | "executed";

export type VoteChoice = "yes" | "no";
export type TicketStatus = "pending" | "executed" | "cancelled";
export type TradeAction = "buy" | "sell";
export type CashMovementKind =
  | "contribution"
  | "withdrawal"
  | "dividend"
  | "coupon"
  | "interest"
  | "fee"
  | "adjustment";

export type BondMarkSource = "bloomberg" | "broker" | "finra_trace" | "other";

// ── Table rows ──────────────────────────────────────────────────────────────

export interface Fund {
  id: string;
  slug: FundSlug;
  name: string;
  asset_class: AssetClass;
  benchmark_symbol: string;
  benchmark_name: string;
  vote_pass_threshold_pct: number;
  vote_quorum_pct: number | null;
  vote_default_window_hours: number;
  cash_balance: number;
  inception_date: string | null;
  meeting_day: number | null;
  allowed_email_domains: string[];
  settings: FundSettings;
  created_at: string;
  updated_at: string;
}

export interface FundSettings {
  sector_can_vote_on_own_pitch?: boolean;
  alumni_can_view_current?: boolean;
  auto_open_votes?: boolean;
  stale_mark_days?: number;
  reply_to_email?: string;
  [key: string]: unknown;
}

export interface AcademicYear {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  is_app_admin: boolean;
  is_faculty_advisor: boolean;
  must_change_password: boolean;
  avatar_url: string | null;
  email_prefs?: { mute_updates?: boolean; mute_reminders?: boolean } | null;
  created_at: string;
  updated_at: string;
}

export interface Sector {
  id: string;
  fund_id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_strategy_team: boolean;
  is_active: boolean;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  fund_id: string;
  academic_year_id: string;
  role: MembershipRole;
  sector_id: string | null;
  is_sector_leader: boolean;
  status: MembershipStatus;
  title_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipWithProfile extends Membership {
  profiles: Pick<Profile, "id" | "email" | "full_name" | "avatar_url">;
}

export interface Holding {
  id: string;
  fund_id: string;
  sector_id: string | null;
  instrument_type: InstrumentType;
  symbol: string | null;
  cusip: string | null;
  isin: string | null;
  name: string;
  issuer: string | null;
  quantity: number;
  avg_cost: number;
  coupon_rate: number | null;
  maturity_date: string | null;
  issue_date: string | null;
  first_coupon_date: string | null;
  payment_frequency: number | null;
  day_count: DayCount | null;
  rating: string | null;
  duration: number | null;
  ytm: number | null;
  pricing_method: PricingMethod;
  benchmark_tenor: number | null;
  is_active: boolean;
  opened_on: string | null;
  closed_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceSnapshot {
  id: number;
  symbol: string;
  price: number;
  previous_close: number | null;
  change_pct: number | null;
  source: string;
  as_of: string;
}

export interface BondMark {
  id: string;
  holding_id: string;
  clean_price: number;
  ytm: number | null;
  duration: number | null;
  source: BondMarkSource;
  marked_by: string;
  marked_at: string;
  notes: string | null;
}

export interface TreasuryCurvePoint {
  curve_date: string;
  tenor_months: number;
  yield_pct: number;
}

export interface FundSnapshot {
  id: string;
  fund_id: string;
  snapshot_date: string;
  market_value: number;
  cash: number;
  total_value: number;
  benchmark_symbol: string;
  benchmark_close: number | null;
  benchmark_adj_close: number | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface SectorTarget {
  id: string;
  fund_id: string;
  sector_id: string;
  target_weight_pct: number;
  benchmark_weight_pct: number | null;
  effective_on: string;
  set_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface Pitch {
  id: string;
  fund_id: string;
  sector_id: string;
  author_id: string;
  title: string;
  pitch_type: PitchType;
  action: PitchAction;
  holding_id: string | null;
  symbol: string | null;
  instrument_name: string | null;
  instrument_type: string | null;
  thesis_md: string | null;
  target_price: number | null;
  proposed_amount: number | null;
  proposed_weight_pct: number | null;
  funding_source: string | null;
  status: PitchStatus;
  scheduled_for: string | null;
  vote_opens_at: string | null;
  vote_closes_at: string | null;
  votes_yes: number;
  votes_no: number;
  eligible_voters: number | null;
  result_pct: number | null;
  closed_by: string | null;
  closed_at: string | null;
  settings?: { paired_pitch_id?: string } | null;
  created_at: string;
  updated_at: string;
}

export interface PitchFile {
  id: string;
  pitch_id: string;
  kind: "deck" | "model" | "other";
  storage_path: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
}

export interface Vote {
  id: string;
  pitch_id: string;
  voter_id: string;
  choice: VoteChoice;
  comment: string | null;
  cast_at: string;
}

export interface TradeTicket {
  id: string;
  fund_id: string;
  pitch_id: string | null;
  holding_id: string | null;
  created_by: string;
  action: TradeAction;
  instrument_type: string;
  symbol: string | null;
  cusip: string | null;
  name: string;
  sector_id: string | null;
  est_quantity: number | null;
  est_price: number | null;
  est_amount: number | null;
  status: TicketStatus;
  executed_by: string | null;
  executed_at: string | null;
  fill_quantity: number | null;
  fill_price: number | null;
  fill_amount: number | null;
  accrued_interest: number | null;
  commission: number | null;
  trade_date: string | null;
  settlement_date: string | null;
  broker_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  fund_id: string;
  ticket_id: string | null;
  holding_id: string;
  action: TradeAction;
  quantity: number;
  price: number;
  amount: number;
  accrued_interest: number;
  commission: number;
  trade_date: string;
  executed_by: string;
  reverses_trade_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface CashMovement {
  id: string;
  fund_id: string;
  kind: CashMovementKind;
  amount: number;
  holding_id: string | null;
  occurred_on: string;
  recorded_by: string;
  notes: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  fund_id: string;
  meeting_date: string;
  title: string | null;
  notes: string | null;
  created_at: string;
}

export interface MeetingAttendance {
  id: string;
  meeting_id: string;
  user_id: string;
  present: boolean;
}

export interface FundUpdate {
  id: string;
  fund_id: string;
  author_id: string;
  title: string;
  body_md: string;
  pinned: boolean;
  published_at: string;
  created_at: string;
}

export interface UpdateRead {
  update_id: string;
  user_id: string;
  read_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_id: string | null;
  fund_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

export interface RosterImport {
  id: string;
  fund_id: string | null;
  academic_year_id: string;
  imported_by: string;
  file_name: string | null;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_failed: number;
  errors: Array<{ row: number; message: string }>;
  created_at: string;
}

export interface BackupRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "failed";
  tabs_written: number | null;
  rows_written: number | null;
  error: string | null;
  triggered_by: string;
}

// ── Market data view models ─────────────────────────────────────────────────

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  /** true when Yahoo failed and this came from the last price_snapshots row */
  stale: boolean;
  /** age of a stale quote in minutes */
  staleMinutes?: number;
  asOf: string;
}

export type PriceSource = "live" | "curve" | "mark" | "estimate" | "par";

export interface HoldingValuation {
  holding: Holding;
  sectorName: string | null;
  price: number | null;
  priceSource: PriceSource;
  /** for marks/estimates: date of the underlying mark */
  markedAt: string | null;
  stale: boolean;
  accruedInterest: number;
  marketValue: number;
  costBasis: number;
  unrealizedGain: number;
  weightPct: number;
  dayChange: number | null;
  dayChangePct: number | null;
  ytm: number | null;
  duration: number | null;
}

export interface SectorWeight {
  sectorId: string;
  sectorName: string;
  sectorSlug: string;
  isStrategyTeam: boolean;
  marketValue: number;
  weightPct: number;
  targetWeightPct: number | null;
  benchmarkWeightPct: number | null;
  holdingsCount: number;
}

export interface FundValuation {
  fundId: string;
  asOf: string;
  holdings: HoldingValuation[];
  sectors: SectorWeight[];
  securitiesValue: number;
  cash: number;
  totalValue: number;
  dayChange: number;
  dayChangePct: number;
  /** fixed income only */
  weightedDuration: number | null;
  weightedYtm: number | null;
  /** market value by instrument type */
  byInstrumentType: Record<string, number>;
  anyStale: boolean;
}

export interface ChartPoint {
  time: string;
  value: number;
}

// ── Auth / permission context ───────────────────────────────────────────────

export interface FundContext {
  fund: Fund;
  profile: Profile;
  /** the caller's membership in this fund for the current year (or most recent alumni row) */
  membership: Membership | null;
  sector: Sector | null;
  currentYear: AcademicYear;
  /** effective role after alumni downgrade; null when access comes from a global flag */
  role: MembershipRole | null;
  isAppAdmin: boolean;
  isFacultyAdvisor: boolean;
}
