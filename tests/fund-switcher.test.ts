// Switching funds must not carry an entity id from one fund into the other:
// a pitch, holding or member id is fund-scoped, so /arch/pitches/<athena id>
// names nothing. Deep paths fall back to the nearest shared list page.

import { describe, it, expect } from "vitest";
import { sharedSubRoute } from "@/components/layout/FundSwitcher";

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
