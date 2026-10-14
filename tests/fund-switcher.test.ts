// Switching funds must not carry an entity id from one fund into the other:
// a pitch, holding or member id is fund-scoped, so /arch/pitches/<athena id>
// names nothing. Deep paths fall back to the nearest shared list page.

import { describe, it, expect } from "vitest";
import { sharedSubRoute, switchTarget } from "@/components/layout/FundSwitcher";

describe("sharedSubRoute", () => {
  it("keeps a shared list page", () => {
    expect(sharedSubRoute("/athena/holdings")).toBe("holdings");
    expect(sharedSubRoute("/athena/performance")).toBe("performance");
    expect(sharedSubRoute("/arch/team")).toBe("team");
  });

  it("keeps a nested admin page", () => {
    expect(sharedSubRoute("/athena/admin/tickets")).toBe("admin/tickets");
    expect(sharedSubRoute("/athena/admin/sectors")).toBe("admin/sectors");
    expect(sharedSubRoute("/athena/admin")).toBe("admin");
  });

  it("drops an entity id, landing on the list", () => {
    expect(sharedSubRoute("/athena/pitches/7f3a-not-in-arch")).toBe("pitches");
    expect(sharedSubRoute("/athena/pitches/7f3a/edit")).toBe("pitches");
    expect(sharedSubRoute("/athena/holdings/abc-123")).toBe("holdings");
    expect(sharedSubRoute("/athena/sectors/technology")).toBe("sectors");
    expect(sharedSubRoute("/athena/admin/members/abc-123")).toBe(
      "admin/members"
    );
  });

  it("keeps pitches/new, which is not an id", () => {
    expect(sharedSubRoute("/athena/pitches/new")).toBe("pitches/new");
  });

  it("sends the dashboard and anything unrecognized to the dashboard", () => {
    expect(sharedSubRoute("/athena")).toBe("");
    expect(sharedSubRoute("/athena/")).toBe("");
    expect(sharedSubRoute("/athena/nonsense")).toBe("");
    expect(sharedSubRoute("/athena/nonsense/deeper")).toBe("");
  });
});

// Where the switcher actually sends you: the same page in the other fund,
// with the filters that mean the same thing there, unless that page is a
// Fund admin section you can't open in the other fund, in which case you land
// on the page it manages instead of a "not found".
describe("switchTarget", () => {
  const ALL_ADMIN = ["", "tickets", "holdings", "pitches", "sectors", "attendance", "updates", "members", "year", "settings", "audit"];

  it("keeps filters that mean the same thing in both funds", () => {
    expect(switchTarget("/athena/performance", "?attr=YTD", "arch", [])).toBe(
      "/arch/performance?attr=YTD"
    );
    expect(switchTarget("/arch/holdings", "?q=treasury", "athena", [])).toBe(
      "/athena/holdings?q=treasury"
    );
  });

  it("keeps the stale-price filters on Holdings and Manage holdings", () => {
    expect(
      switchTarget("/athena/holdings", "?price=stale&q=net", "arch", [])
    ).toBe("/arch/holdings?q=net&price=stale");
    expect(
      switchTarget("/athena/admin/holdings", "?stale=1", "arch", ALL_ADMIN)
    ).toBe("/arch/admin/holdings?stale=1");
  });

  it("drops a Manage tickets sell pre-fill, which names one holding", () => {
    expect(
      switchTarget(
        "/athena/admin/tickets",
        "?action=sell&holding=abc",
        "arch",
        ALL_ADMIN
      )
    ).toBe("/arch/admin/tickets");
  });

  it("keeps the audit log's action filter, which is the same code in both funds", () => {
    expect(
      switchTarget(
        "/athena/admin/audit",
        "?action=membership.update&entity=memberships",
        "arch",
        ALL_ADMIN
      )
    ).toBe("/arch/admin/audit?action=membership.update&entity=memberships");
  });

  it("drops filters that name something in one fund only", () => {
    expect(
      switchTarget("/athena/pitches", "?status=passed&sector=technology", "arch", [])
    ).toBe("/arch/pitches?status=passed");
  });

  it("drops every filter when it can't stay on the same page", () => {
    expect(
      switchTarget("/athena/pitches/7f3a", "?status=passed", "arch", [])
    ).toBe("/arch/pitches");
  });

  it("keeps a Fund admin section the person can open in the other fund", () => {
    expect(switchTarget("/athena/admin/tickets", "", "arch", ALL_ADMIN)).toBe(
      "/arch/admin/tickets"
    );
    expect(
      switchTarget("/athena/admin/members/abc-123", "", "arch", ALL_ADMIN)
    ).toBe("/arch/admin/members");
  });

  it("lands on the managed page when the admin section is closed to them there", () => {
    expect(switchTarget("/athena/admin/tickets", "", "arch", [])).toBe("/arch/trades");
    expect(switchTarget("/athena/admin/members", "", "arch", [""])).toBe("/arch/team");
    expect(switchTarget("/athena/admin/attendance", "", "arch", [])).toBe(
      "/arch/attendance"
    );
    expect(switchTarget("/athena/admin", "", "arch", [])).toBe("/arch");
    expect(switchTarget("/athena/admin/settings", "", "arch", ["tickets"])).toBe("/arch");
  });
});
