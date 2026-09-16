// Single source of truth for the permission matrix (spec Section 6).
// The RLS policies in supabase/migrations mirror this table; if you change a
// row here, change the matching SQL helper/policy in the same commit.

import type { FundContext, MembershipRole } from "@/types/domain";

export type PermissionAction =
  | "view_fund"
  | "view_individual_votes"
  | "draft_pitch"
  | "submit_pitch"
  | "schedule_pitch"
  | "cast_vote"
  | "withdraw_pitch"
  | "create_ticket"
  | "execute_ticket"
  | "manage_holdings"
  | "set_sector_targets"
  | "manage_fund_settings"
  | "manage_roster"
  | "reset_member_password"
  | "post_updates"
  | "record_attendance"
  | "trigger_backup"
  | "view_audit_log"
  | "grant_app_admin";

export const OFFICER_ROLES: MembershipRole[] = [
  "president",
  "vice_president",
  "portfolio_manager",
  "alumni_relations",
];

/** Effective role: alumni and inactive memberships act as viewer. */
export function effectiveRole(ctx: FundContext): MembershipRole | null {
  if (!ctx.membership) return null;
  if (ctx.membership.status !== "active") return "viewer";
  return ctx.membership.role;
}

export function isOfficer(ctx: FundContext): boolean {
  if (ctx.isAppAdmin) return true;
  const role = effectiveRole(ctx);
  return role !== null && OFFICER_ROLES.includes(role);
}

export function isPM(ctx: FundContext): boolean {
  return effectiveRole(ctx) === "portfolio_manager";
}

export function canExecute(ctx: FundContext): boolean {
  return isPM(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin;
}

/** Active member (not viewer, not alumni) — the voting population. */
export function isActiveVoter(ctx: FundContext): boolean {
  return (
    ctx.membership !== null &&
    ctx.membership.status === "active" &&
    ctx.membership.role !== "viewer" &&
    !ctx.isAppAdmin // admins are not students and never vote
  );
}

export function leadsSector(ctx: FundContext, sectorId: string): boolean {
  return (
    ctx.membership !== null &&
    ctx.membership.status === "active" &&
    ctx.membership.is_sector_leader &&
    ctx.membership.sector_id === sectorId
  );
}

export function inSector(ctx: FundContext, sectorId: string): boolean {
  return (
    ctx.membership !== null &&
    ctx.membership.status === "active" &&
    ctx.membership.sector_id === sectorId
  );
}

/**
 * Leads the fund's strategy team (Equity Strategies / Macro). Mirrors the SQL
 * helper `leads_strategy_team(fund)`: the test is about the caller's own
 * sector, and it licenses targets for every sector in the fund — target rows
 * name ordinary sectors, never the strategy team itself.
 */
export function leadsStrategyTeam(ctx: FundContext): boolean {
  return (
    ctx.sector !== null &&
    ctx.sector.is_strategy_team &&
    ctx.sector.is_active &&
    leadsSector(ctx, ctx.sector.id)
  );
}

/**
 * The permission matrix. `sectorId` scopes sector-bound actions
 * (draft/submit/withdraw pitch). `isStrategyLeader` answers "does this caller
 * lead the fund's strategy team?" for callers that already resolved it;
 * otherwise it is read off the context.
 */
export function can(
  ctx: FundContext,
  action: PermissionAction,
  opts: { sectorId?: string; isStrategyLeader?: boolean } = {}
): boolean {
  const role = effectiveRole(ctx);
  const officer = isOfficer(ctx);

  switch (action) {
    case "view_fund":
      return (
        ctx.isAppAdmin || ctx.isFacultyAdvisor || ctx.membership !== null
      );

    case "view_individual_votes":
      return officer || ctx.isFacultyAdvisor || ctx.isAppAdmin;

    case "draft_pitch":
      if (ctx.isAppAdmin) return true;
      if (ctx.isFacultyAdvisor) return false;
      if (officer) return true; // officers: any sector
      if (!role || role === "viewer") return false;
      return opts.sectorId ? inSector(ctx, opts.sectorId) : true;

    case "submit_pitch":
      if (ctx.isAppAdmin) return true;
      if (ctx.isFacultyAdvisor) return false;
      if (officer) return true;
      return opts.sectorId ? leadsSector(ctx, opts.sectorId) : false;

    case "schedule_pitch":
      return officer || ctx.isAppAdmin;

    case "cast_vote":
      return isActiveVoter(ctx);

    case "withdraw_pitch":
      if (ctx.isAppAdmin) return true;
      if (officer) return true;
      return opts.sectorId ? leadsSector(ctx, opts.sectorId) : false;

    case "create_ticket":
    case "execute_ticket":
    case "manage_holdings":
      return canExecute(ctx);

    case "set_sector_targets":
      if (officer || ctx.isAppAdmin) return true;
      // The Equity Strategies / Macro leader sets the whole fund's targets,
      // not only their own sector's row.
      return opts.isStrategyLeader ?? leadsStrategyTeam(ctx);

    case "manage_fund_settings":
      return officer || ctx.isAppAdmin;

    case "manage_roster":
    case "reset_member_password":
      // officers (not PM-only) and app admin; PM is an officer role,
      // but spec grants roster to officers generally and not the PM
      // column — PM is excluded from roster/reset.
      if (ctx.isAppAdmin) return true;
      return (
        role !== null &&
        ["president", "vice_president", "alumni_relations"].includes(role)
      );

    case "post_updates":
    case "record_attendance":
      return officer || ctx.isFacultyAdvisor || ctx.isAppAdmin;

    case "trigger_backup":
    case "view_audit_log":
      return officer || ctx.isFacultyAdvisor || ctx.isAppAdmin;

    case "grant_app_admin":
      return ctx.isAppAdmin;

    default:
      return false;
  }
}

/**
 * May this person open the Fund Admin section at all (SPEC 11.3)?
 *
 * The admin layout also admits the strategy-team leader, who needs
 * /[fund]/admin/sectors to set the fund's target weights and nothing else
 * under /admin. Every other admin page calls this first, so widening that one
 * door never opens the rest of the corridor.
 */
export function hasFundAdminAccess(ctx: FundContext): boolean {
  return isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin;
}

/** Human label for a member's role in a fund, e.g. "Portfolio Manager". */
export function roleLabel(
  role: MembershipRole | null,
  titleOverride?: string | null
): string {
  if (titleOverride) return titleOverride;
  switch (role) {
    case "president":
      return "President";
    case "vice_president":
      return "Vice President";
    case "portfolio_manager":
      return "Portfolio Manager";
    case "alumni_relations":
      return "Director of Alumni Relations";
    case "sector_leader":
      return "Sector Leader";
    case "analyst":
      return "Analyst";
    case "viewer":
      return "Viewer";
    default:
      return "Guest";
  }
}
