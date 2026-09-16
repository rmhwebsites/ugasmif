// Unit tests for src/lib/permissions.ts against the permission matrix in
// SPEC Section 6. Every row of that table has at least one assertion here for
// every column (analyst, sector leader, officer, PM, faculty advisor, app
// admin) plus the cases the table describes in prose: alumni behaves like a
// viewer, the Equity Strategies / Macro leader may set targets, the PM is
// excluded from roster management, and app admins never vote.
//
// Pure functions only — no network, no Supabase.

import { describe, it, expect } from "vitest";
import {
  OFFICER_ROLES,
  can,
  canExecute,
  effectiveRole,
  inSector,
  isActiveVoter,
  isOfficer,
  leadsSector,
  hasFundAdminAccess,
  leadsStrategyTeam,
  roleLabel,
  type PermissionAction,
} from "@/lib/permissions";
import type {
  AcademicYear,
  Fund,
  FundContext,
  Membership,
  MembershipRole,
  MembershipStatus,
  Profile,
  Sector,
} from "@/types/domain";

// ── Fixtures ────────────────────────────────────────────────────────────────

const TECH = "sector-technology";
const HEALTHCARE = "sector-healthcare";
const STRATEGY = "sector-equity-strategies";

const FUND: Fund = {
  id: "fund-athena",
  slug: "athena",
  name: "Athena Stock Fund",
  asset_class: "equity",
  benchmark_symbol: "SPY",
  benchmark_name: "S&P 500",
  vote_pass_threshold_pct: 60,
  vote_quorum_pct: null,
  vote_default_window_hours: 24,
  cash_balance: 22_500,
  inception_date: "2007-09-01",
  meeting_day: 3,
  allowed_email_domains: ["uga.edu"],
  settings: {},
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const YEAR: AcademicYear = {
  id: "year-2026-27",
  label: "2026-27",
  starts_on: "2026-08-01",
  ends_on: "2027-07-31",
  is_current: true,
  created_at: "2026-08-01T00:00:00Z",
};

const TECH_SECTOR: Sector = {
  id: TECH,
  fund_id: FUND.id,
  name: "Technology",
  slug: "technology",
  sort_order: 10,
  is_strategy_team: false,
  is_active: true,
  created_at: "2026-08-01T00:00:00Z",
};

const STRATEGY_SECTOR: Sector = {
  ...TECH_SECTOR,
  id: STRATEGY,
  name: "Equity Strategies",
  slug: "equity-strategies",
  sort_order: 1,
  is_strategy_team: true,
};

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    email: "member@example.com",
    full_name: "Placeholder Member",
    first_name: "Placeholder",
    last_name: "Member",
    phone: null,
    onboarded_at: "2026-09-01T00:00:00.000Z",
    is_app_admin: false,
    is_faculty_advisor: false,
    must_change_password: false,
    avatar_url: null,
    email_prefs: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: "membership-1",
    user_id: "user-1",
    fund_id: FUND.id,
    academic_year_id: YEAR.id,
    role: "analyst",
    sector_id: TECH,
    is_sector_leader: false,
    status: "active",
    title_override: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

interface CtxOptions {
  role?: MembershipRole;
  sectorId?: string | null;
  isSectorLeader?: boolean;
  status?: MembershipStatus;
  isAppAdmin?: boolean;
  isFacultyAdvisor?: boolean;
  /** pass false for access that comes only from a global flag */
  hasMembership?: boolean;
}

function ctx(options: CtxOptions = {}): FundContext {
  const {
    role = "analyst",
    sectorId = TECH,
    isSectorLeader = false,
    status = "active",
    isAppAdmin = false,
    isFacultyAdvisor = false,
    hasMembership = true,
  } = options;

  const m = hasMembership
    ? membership({
        role,
        sector_id: sectorId,
        is_sector_leader: isSectorLeader,
        status,
      })
    : null;

  const sector =
    m?.sector_id === STRATEGY
      ? STRATEGY_SECTOR
      : m?.sector_id === TECH
      ? TECH_SECTOR
      : null;

  const base: FundContext = {
    fund: FUND,
    profile: profile({ is_app_admin: isAppAdmin, is_faculty_advisor: isFacultyAdvisor }),
    membership: m,
    sector,
    currentYear: YEAR,
    role: null,
    isAppAdmin,
    isFacultyAdvisor,
    canViewCurrent: true,
  };
  return { ...base, role: effectiveRole(base) };
}

// The six columns of the matrix, plus the extras the prose adds.
const analyst = ctx({ role: "analyst" });
const sectorLeader = ctx({ role: "sector_leader", isSectorLeader: true });
const strategyLeader = ctx({
  role: "sector_leader",
  isSectorLeader: true,
  sectorId: STRATEGY,
});
const president = ctx({ role: "president", sectorId: null });
const vicePresident = ctx({ role: "vice_president", sectorId: null });
const alumniRelations = ctx({ role: "alumni_relations", sectorId: null });
const pm = ctx({ role: "portfolio_manager", sectorId: null });
const advisor = ctx({ hasMembership: false, isFacultyAdvisor: true });
const appAdmin = ctx({ role: "viewer", sectorId: null, isAppAdmin: true });
const viewer = ctx({ role: "viewer", sectorId: null });
const alumnus = ctx({ role: "president", sectorId: null, status: "alumni" });
const inactiveAnalyst = ctx({ role: "analyst", status: "inactive" });
// An app admin who also holds a real analyst membership: still never votes.
const appAdminAnalyst = ctx({ role: "analyst", isAppAdmin: true });

/** Officer column of the matrix = president / VP / alumni relations / PM. */
const officers: Array<[string, FundContext]> = [
  ["president", president],
  ["vice_president", vicePresident],
  ["alumni_relations", alumniRelations],
  ["portfolio_manager", pm],
];

function expectAll(
  action: PermissionAction,
  entries: Array<[string, FundContext, boolean]>,
  opts: { sectorId?: string; isStrategySector?: boolean } = {}
): void {
  for (const [label, context, expected] of entries) {
    expect(can(context, action, opts), `${action} / ${label}`).toBe(expected);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

describe("role helpers", () => {
  it("lists the four officer roles", () => {
    expect(OFFICER_ROLES).toEqual([
      "president",
      "vice_president",
      "portfolio_manager",
      "alumni_relations",
    ]);
  });

  it("effectiveRole downgrades alumni and inactive memberships to viewer", () => {
    expect(effectiveRole(analyst)).toBe("analyst");
    expect(effectiveRole(president)).toBe("president");
    expect(effectiveRole(alumnus)).toBe("viewer");
    expect(effectiveRole(inactiveAnalyst)).toBe("viewer");
    expect(effectiveRole(advisor)).toBeNull();
  });

  it("isOfficer covers the four officer roles, the app admin, and nobody else", () => {
    for (const [label, context] of officers) {
      expect(isOfficer(context), label).toBe(true);
    }
    expect(isOfficer(appAdmin)).toBe(true);
    expect(isOfficer(analyst)).toBe(false);
    expect(isOfficer(sectorLeader)).toBe(false);
    expect(isOfficer(advisor)).toBe(false);
    expect(isOfficer(viewer)).toBe(false);
    expect(isOfficer(alumnus)).toBe(false);
  });

  it("canExecute is PM, faculty advisor and app admin only", () => {
    expect(canExecute(pm)).toBe(true);
    expect(canExecute(advisor)).toBe(true);
    expect(canExecute(appAdmin)).toBe(true);
    expect(canExecute(president)).toBe(false);
    expect(canExecute(vicePresident)).toBe(false);
    expect(canExecute(alumniRelations)).toBe(false);
    expect(canExecute(sectorLeader)).toBe(false);
    expect(canExecute(analyst)).toBe(false);
  });

  it("leadsSector and inSector are scoped to one sector", () => {
    expect(leadsSector(sectorLeader, TECH)).toBe(true);
    expect(leadsSector(sectorLeader, HEALTHCARE)).toBe(false);
    expect(leadsSector(analyst, TECH)).toBe(false);
    expect(inSector(analyst, TECH)).toBe(true);
    expect(inSector(analyst, HEALTHCARE)).toBe(false);
    expect(inSector(advisor, TECH)).toBe(false);
    // an alumni membership leads nothing
    expect(
      leadsSector(
        ctx({ role: "sector_leader", isSectorLeader: true, status: "alumni" }),
        TECH
      )
    ).toBe(false);
  });

  it("roleLabel prefers the title override (Arch co-presidents)", () => {
    expect(roleLabel("president")).toBe("President");
    expect(roleLabel("president", "Co-President")).toBe("Co-President");
    expect(roleLabel("portfolio_manager")).toBe("Portfolio Manager");
    expect(roleLabel("alumni_relations")).toBe("Director of Alumni Relations");
    expect(roleLabel("sector_leader")).toBe("Sector Leader");
    expect(roleLabel("analyst")).toBe("Analyst");
    expect(roleLabel("viewer")).toBe("Viewer");
    expect(roleLabel(null)).toBe("Guest");
  });
});

// ── Matrix rows ─────────────────────────────────────────────────────────────

describe("matrix: view dashboard, holdings, performance, pitches, results", () => {
  it("is open to every column", () => {
    expectAll("view_fund", [
      ["analyst", analyst, true],
      ["sector leader", sectorLeader, true],
      ["officer", president, true],
      ["pm", pm, true],
      ["advisor", advisor, true],
      ["app admin", appAdmin, true],
      ["viewer", viewer, true],
      ["alumnus", alumnus, true],
    ]);
  });

  it("is closed to a signed-in user with no membership and no flag", () => {
    expect(can(ctx({ hasMembership: false }), "view_fund")).toBe(false);
  });
});

describe("matrix: view individual votes", () => {
  it("is officers, advisor and admin only", () => {
    expectAll("view_individual_votes", [
      ["analyst", analyst, false],
      ["sector leader", sectorLeader, false],
      ["president", president, true],
      ["vice_president", vicePresident, true],
      ["alumni_relations", alumniRelations, true],
      ["pm", pm, true],
      ["advisor", advisor, true],
      ["app admin", appAdmin, true],
      ["viewer", viewer, false],
      ["alumnus", alumnus, false],
    ]);
  });
});

describe("matrix: draft a pitch for own sector", () => {
  it("lets analysts and leaders draft in their own sector only", () => {
    expect(can(analyst, "draft_pitch", { sectorId: TECH })).toBe(true);
    expect(can(analyst, "draft_pitch", { sectorId: HEALTHCARE })).toBe(false);
    expect(can(sectorLeader, "draft_pitch", { sectorId: TECH })).toBe(true);
    expect(can(sectorLeader, "draft_pitch", { sectorId: HEALTHCARE })).toBe(false);
  });

  it("lets officers and the app admin draft in any sector, and blocks the advisor and viewers", () => {
    expectAll(
      "draft_pitch",
      [
        ["president", president, true],
        ["vice_president", vicePresident, true],
        ["alumni_relations", alumniRelations, true],
        ["pm", pm, true],
        ["advisor", advisor, false],
        ["app admin", appAdmin, true],
        ["viewer", viewer, false],
        ["alumnus", alumnus, false],
      ],
      { sectorId: HEALTHCARE }
    );
  });

  it("without a sector scope, any active non-viewer may open the editor", () => {
    expect(can(analyst, "draft_pitch")).toBe(true);
    expect(can(viewer, "draft_pitch")).toBe(false);
  });
});

describe("matrix: submit a pitch (draft to submitted)", () => {
  it("is the sector leader for their own sector, officers, and the admin", () => {
    expect(can(analyst, "submit_pitch", { sectorId: TECH })).toBe(false);
    expect(can(sectorLeader, "submit_pitch", { sectorId: TECH })).toBe(true);
    expect(can(sectorLeader, "submit_pitch", { sectorId: HEALTHCARE })).toBe(false);
    expectAll(
      "submit_pitch",
      [
        ["president", president, true],
        ["vice_president", vicePresident, true],
        ["alumni_relations", alumniRelations, true],
        ["pm", pm, true],
        ["advisor", advisor, false],
        ["app admin", appAdmin, true],
        ["viewer", viewer, false],
        ["alumnus", alumnus, false],
      ],
      { sectorId: HEALTHCARE }
    );
  });

  it("denies a leader with no sector scope supplied", () => {
    expect(can(sectorLeader, "submit_pitch")).toBe(false);
  });
});

describe("matrix: schedule a pitch, open/close voting", () => {
  it("is officers and the app admin only", () => {
    expectAll("schedule_pitch", [
      ["analyst", analyst, false],
      ["sector leader", sectorLeader, false],
      ["president", president, true],
      ["vice_president", vicePresident, true],
      ["alumni_relations", alumniRelations, true],
      ["pm", pm, true],
      ["advisor", advisor, false],
      ["app admin", appAdmin, true],
      ["alumnus", alumnus, false],
    ]);
  });
});

describe("matrix: cast a vote", () => {
  it("is every active non-viewer member", () => {
    expectAll("cast_vote", [
      ["analyst", analyst, true],
      ["sector leader", sectorLeader, true],
      ["president", president, true],
      ["vice_president", vicePresident, true],
      ["alumni_relations", alumniRelations, true],
      ["pm", pm, true],
      ["viewer", viewer, false],
      ["alumnus", alumnus, false],
      ["inactive analyst", inactiveAnalyst, false],
    ]);
  });

  it("never lets the faculty advisor or an app admin vote", () => {
    expect(can(advisor, "cast_vote")).toBe(false);
    expect(can(appAdmin, "cast_vote")).toBe(false);
    // even when the admin holds a real analyst membership
    expect(can(appAdminAnalyst, "cast_vote")).toBe(false);
    expect(isActiveVoter(appAdminAnalyst)).toBe(false);
    expect(isActiveVoter(analyst)).toBe(true);
  });
});

describe("matrix: withdraw a pitch", () => {
  it("is the sector leader for their sector, officers and the admin", () => {
    // The analyst-as-author case is enforced in the route (author_id check on a
    // draft); permissions.ts only answers the role question.
    expect(can(analyst, "withdraw_pitch", { sectorId: TECH })).toBe(false);
    expect(can(sectorLeader, "withdraw_pitch", { sectorId: TECH })).toBe(true);
    expect(can(sectorLeader, "withdraw_pitch", { sectorId: HEALTHCARE })).toBe(false);
    expectAll(
      "withdraw_pitch",
      [
        ["president", president, true],
        ["pm", pm, true],
        ["advisor", advisor, false],
        ["app admin", appAdmin, true],
        ["alumnus", alumnus, false],
      ],
      { sectorId: HEALTHCARE }
    );
  });
});

describe("matrix: tickets, fills, holdings and marks", () => {
  const actions: PermissionAction[] = [
    "create_ticket",
    "execute_ticket",
    "manage_holdings",
  ];

  it("is the PM, the faculty advisor and the app admin only", () => {
    for (const action of actions) {
      expectAll(action, [
        ["analyst", analyst, false],
        ["sector leader", sectorLeader, false],
        ["president", president, false],
        ["vice_president", vicePresident, false],
        ["alumni_relations", alumniRelations, false],
        ["pm", pm, true],
        ["advisor", advisor, true],
        ["app admin", appAdmin, true],
        ["alumnus", alumnus, false],
      ]);
    }
  });
});

describe("matrix: set sector targets and benchmark weights", () => {
  it("is officers and the app admin", () => {
    expectAll("set_sector_targets", [
      ["president", president, true],
      ["vice_president", vicePresident, true],
      ["alumni_relations", alumniRelations, true],
      ["pm", pm, true],
      ["app admin", appAdmin, true],
      ["advisor", advisor, false],
      ["analyst", analyst, false],
      ["alumnus", alumnus, false],
    ]);
  });

  it("also allows the Equity Strategies / Macro leader, for every sector", () => {
    // The strategy team sets the whole fund's targets. Target rows name
    // ordinary sectors, never the strategy team itself, so the test is about
    // who the caller is and not which sector the row is for.
    expect(leadsStrategyTeam(strategyLeader)).toBe(true);
    expect(can(strategyLeader, "set_sector_targets")).toBe(true);
    expect(
      can(strategyLeader, "set_sector_targets", { sectorId: TECH })
    ).toBe(true);
    expect(
      can(strategyLeader, "set_sector_targets", { sectorId: HEALTHCARE })
    ).toBe(true);

    // An ordinary sector leader, even for their own sector.
    expect(leadsStrategyTeam(sectorLeader)).toBe(false);
    expect(can(sectorLeader, "set_sector_targets", { sectorId: TECH })).toBe(
      false
    );

    // An analyst on the strategy team is not its leader.
    const strategyAnalyst = ctx({ role: "analyst", sectorId: STRATEGY });
    expect(leadsStrategyTeam(strategyAnalyst)).toBe(false);
    expect(can(strategyAnalyst, "set_sector_targets")).toBe(false);

    // A leader whose membership has lapsed.
    const formerLeader = ctx({
      role: "sector_leader",
      isSectorLeader: true,
      sectorId: STRATEGY,
      status: "alumni",
    });
    expect(leadsStrategyTeam(formerLeader)).toBe(false);
    expect(can(formerLeader, "set_sector_targets")).toBe(false);
  });

  it("takes a pre-resolved isStrategyLeader over the context", () => {
    // Callers that already answered the question (the API route, which
    // mirrors the SQL helper) pass it in; the flag wins either way.
    expect(
      can(sectorLeader, "set_sector_targets", { isStrategyLeader: true })
    ).toBe(true);
    expect(
      can(strategyLeader, "set_sector_targets", { isStrategyLeader: false })
    ).toBe(false);
    // An officer does not need it.
    expect(
      can(president, "set_sector_targets", { isStrategyLeader: false })
    ).toBe(true);
  });
});

describe("hasFundAdminAccess", () => {
  it("is officers, the advisor and app admins", () => {
    for (const [label, who] of [
      ["president", president],
      ["vice_president", vicePresident],
      ["alumni_relations", alumniRelations],
      ["pm", pm],
      ["advisor", advisor],
      ["app admin", appAdmin],
    ] as const) {
      expect(`${label}:${hasFundAdminAccess(who)}`).toBe(`${label}:true`);
    }
  });

  it("is NOT the strategy-team leader, who only needs /admin/sectors", () => {
    // The admin layout admits them so the sectors page can render; every
    // other admin page calls this and turns them away. Without it, widening
    // that one door opened Fund Settings to a sector leader.
    expect(leadsStrategyTeam(strategyLeader)).toBe(true);
    expect(hasFundAdminAccess(strategyLeader)).toBe(false);
  });

  it("is not an ordinary member", () => {
    for (const who of [analyst, sectorLeader, viewer, alumnus]) {
      expect(hasFundAdminAccess(who)).toBe(false);
    }
  });
});

describe("matrix: manage sectors, vote threshold, fund settings", () => {
  it("is officers and the app admin", () => {
    expectAll("manage_fund_settings", [
      ["analyst", analyst, false],
      ["sector leader", sectorLeader, false],
      ["president", president, true],
      ["vice_president", vicePresident, true],
      ["alumni_relations", alumniRelations, true],
      ["pm", pm, true],
      ["advisor", advisor, false],
      ["app admin", appAdmin, true],
      ["alumnus", alumnus, false],
    ]);
  });
});

describe("matrix: roster import, membership edits, new academic year", () => {
  const actions: PermissionAction[] = ["manage_roster", "reset_member_password"];

  it("is president, VP, alumni relations and the app admin", () => {
    for (const action of actions) {
      expectAll(action, [
        ["analyst", analyst, false],
        ["sector leader", sectorLeader, false],
        ["president", president, true],
        ["vice_president", vicePresident, true],
        ["alumni_relations", alumniRelations, true],
        ["advisor", advisor, false],
        ["app admin", appAdmin, true],
        ["viewer", viewer, false],
        ["alumnus", alumnus, false],
      ]);
    }
  });

  it("explicitly excludes the portfolio manager", () => {
    expect(can(pm, "manage_roster")).toBe(false);
    expect(can(pm, "reset_member_password")).toBe(false);
    // and the PM is still an officer everywhere else
    expect(isOfficer(pm)).toBe(true);
    expect(can(pm, "manage_fund_settings")).toBe(true);
  });
});

describe("matrix: post updates, record attendance", () => {
  const actions: PermissionAction[] = ["post_updates", "record_attendance"];

  it("is officers, the faculty advisor and the app admin", () => {
    for (const action of actions) {
      expectAll(action, [
        ["analyst", analyst, false],
        ["sector leader", sectorLeader, false],
        ["president", president, true],
        ["vice_president", vicePresident, true],
        ["alumni_relations", alumniRelations, true],
        ["pm", pm, true],
        ["advisor", advisor, true],
        ["app admin", appAdmin, true],
        ["alumnus", alumnus, false],
      ]);
    }
  });
});

describe("matrix: trigger backup, backup status, audit log", () => {
  const actions: PermissionAction[] = ["trigger_backup", "view_audit_log"];

  it("is officers, the faculty advisor and the app admin", () => {
    for (const action of actions) {
      expectAll(action, [
        ["analyst", analyst, false],
        ["sector leader", sectorLeader, false],
        ["president", president, true],
        ["pm", pm, true],
        ["advisor", advisor, true],
        ["app admin", appAdmin, true],
        ["alumnus", alumnus, false],
      ]);
    }
  });
});

describe("matrix: grant app admin", () => {
  it("is the app admin and nobody else", () => {
    expectAll("grant_app_admin", [
      ["analyst", analyst, false],
      ["sector leader", sectorLeader, false],
      ["president", president, false],
      ["vice_president", vicePresident, false],
      ["alumni_relations", alumniRelations, false],
      ["pm", pm, false],
      ["advisor", advisor, false],
      ["app admin", appAdmin, true],
    ]);
  });
});

// ── Alumni and inactive downgrade ───────────────────────────────────────────

describe("alumni memberships behave like a viewer", () => {
  const alumniPresident = alumnus;
  const alumniPM = ctx({ role: "portfolio_manager", status: "alumni" });
  const alumniLeader = ctx({
    role: "sector_leader",
    isSectorLeader: true,
    status: "alumni",
  });
  const activeViewer = viewer;

  const readOnly: PermissionAction[] = [
    "view_individual_votes",
    "draft_pitch",
    "submit_pitch",
    "schedule_pitch",
    "cast_vote",
    "withdraw_pitch",
    "create_ticket",
    "execute_ticket",
    "manage_holdings",
    "set_sector_targets",
    "manage_fund_settings",
    "manage_roster",
    "reset_member_password",
    "post_updates",
    "record_attendance",
    "trigger_backup",
    "view_audit_log",
    "grant_app_admin",
  ];

  it("keeps read access but grants nothing a viewer does not have", () => {
    for (const action of readOnly) {
      expect(can(alumniPresident, action, { sectorId: TECH }), action).toBe(
        can(activeViewer, action, { sectorId: TECH })
      );
      expect(can(alumniPM, action, { sectorId: TECH }), action).toBe(
        can(activeViewer, action, { sectorId: TECH })
      );
      expect(can(alumniLeader, action, { sectorId: TECH }), action).toBe(
        can(activeViewer, action, { sectorId: TECH })
      );
    }
    expect(can(alumniPresident, "view_fund")).toBe(true);
    expect(can(alumniPM, "view_fund")).toBe(true);
    expect(canExecute(alumniPM)).toBe(false);
  });

  it("treats an inactive membership the same way", () => {
    for (const action of readOnly) {
      expect(can(inactiveAnalyst, action, { sectorId: TECH }), action).toBe(
        can(activeViewer, action, { sectorId: TECH })
      );
    }
    expect(can(inactiveAnalyst, "view_fund")).toBe(true);
  });
});
