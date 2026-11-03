// The alumni page's helpers (src/lib/alumni.ts). Who counts as an alum and
// which pitches they get are decided in SQL; supabase/tests/alumni.sql
// checks that side.

import { describe, expect, it } from "vitest";
import { matchesQuery } from "@/lib/search";
import {
  normalizeLinkedIn,
  sortAlumni,
  toAlum,
  yearsText,
  type AlumRow,
} from "@/lib/alumni";

describe("normalizeLinkedIn", () => {
  const ok = (input: string) => {
    const r = normalizeLinkedIn(input);
    if (!("url" in r)) throw new Error(r.error);
    return r.url;
  };

  it("turns what people paste into one canonical link", () => {
    expect(ok("https://www.linkedin.com/in/jane-doe")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("linkedin.com/in/jane-doe/")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("  http://uk.linkedin.com/in/jane-doe?trk=public#x  ")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("https://m.linkedin.com/in/jane-doe")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(ok("www.linkedin.com/pub/jane-doe/1/2/3")).toBe("https://www.linkedin.com/pub/jane-doe/1/2/3");
  });

  it("clears on blank", () => {
    expect(ok("   ")).toBeNull();
  });

  it("refuses anything that isn't a LinkedIn profile", () => {
    const help = "Use a LinkedIn profile link, like linkedin.com/in/their-name.";
    expect(normalizeLinkedIn("https://evil.example/linkedin.com/in/x")).toEqual({ error: help });
    expect(normalizeLinkedIn("https://linkedin.com.evil.example/in/x")).toEqual({ error: help });
    expect(normalizeLinkedIn("javascript:alert(1)//linkedin.com/in/x")).toEqual({ error: help });
    expect(normalizeLinkedIn("https://www.linkedin.com/company/uga")).toEqual({ error: help });
    expect(normalizeLinkedIn("https://www.linkedin.com/in/")).toEqual({ error: help });
    expect(normalizeLinkedIn("jane doe")).toEqual({ error: help });
  });

  it("produces what the database check accepts", () => {
    const db = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i;
    for (const input of ["linkedin.com/in/a", "http://ca.linkedin.com/in/b", "m.linkedin.com/in/c"]) {
      expect(ok(input)).toMatch(db);
    }
  });
});

describe("yearsText", () => {
  it("collapses an unbroken run", () => {
    expect(yearsText(["2024-25", "2023-24", "2025-26"])).toBe("2023-24 to 2025-26");
  });
  it("lists years with a gap", () => {
    expect(yearsText(["2024-25", "2022-23"])).toBe("2022-23, 2024-25");
  });
  it("handles one year, repeats and none", () => {
    expect(yearsText(["2024-25", "2024-25"])).toBe("2024-25");
    expect(yearsText([])).toBe("");
  });
});

const row = (over: Partial<AlumRow> = {}): AlumRow => ({
  profile_id: "p1",
  full_name: "Ana Diaz",
  avatar_url: null,
  linkedin_url: null,
  stints: [
    { fund: "athena", fund_name: "Athena Stock Fund", year: "2024-25", starts_on: "2024-08-01", role: "sector_leader", title: null, leader: true, sector: "Technology" },
    { fund: "athena", fund_name: "Athena Stock Fund", year: "2023-24", starts_on: "2023-08-01", role: "analyst", title: null, leader: false, sector: "Technology" },
    { fund: "arch", fund_name: "Arch Bond Fund", year: "2024-25", starts_on: "2024-08-01", role: "analyst", title: null, leader: false, sector: "Treasuries" },
  ],
  pitches: [
    { id: "x", fund: "athena", title: "Buy Vertex", symbol: "VRTX", action: "buy", status: "passed", result_pct: 78, date: "2025-02-10", sector: "Technology", authored: true },
  ],
  ...over,
});

describe("toAlum", () => {
  it("reads years, funds, roles and the headline", () => {
    const a = toAlum(row());
    expect(a.years).toEqual(["2023-24", "2024-25"]);
    expect(a.yearsText).toBe("2023-24 to 2024-25");
    expect(a.funds).toEqual(["arch", "athena"]);
    expect(a.roles.map((r) => `${r.year} ${r.fund} ${r.label}`)).toEqual([
      "2024-25 athena Sector Leader · Technology",
      "2024-25 arch Analyst · Treasuries",
      "2023-24 athena Analyst · Technology",
    ]);
    expect(a.headline).toBe("Sector Leader · Technology");
  });

  it("uses a title over the role, and copes with nothing", () => {
    const titled = toAlum(row({
      stints: [{ fund: "athena", fund_name: "Athena", year: "2024-25", starts_on: "2024-08-01", role: "president", title: "Co-President", leader: false, sector: null }],
    }));
    expect(titled.headline).toBe("Co-President");
    const empty = toAlum(row({ stints: null, pitches: null }));
    expect(empty.headline).toBe("");
    expect(empty.pitches).toEqual([]);
  });
});

describe("search and order", () => {
  const a = toAlum(row());
  it("matches every word anywhere: name, year, role, fund, pitch", () => {
    expect(matchesQuery(a.haystack, "ana")).toBe(true);
    expect(matchesQuery(a.haystack, "VRTX")).toBe(true);
    expect(matchesQuery(a.haystack, "treasuries 2024-25")).toBe(true);
    expect(matchesQuery(a.haystack, "sector leader")).toBe(true);
    expect(matchesQuery(a.haystack, "arch bond")).toBe(true);
    expect(matchesQuery(a.haystack, "ana healthcare")).toBe(false);
    expect(matchesQuery(a.haystack, "  ")).toBe(true);
  });

  it("puts the most recent class first, then names", () => {
    const older = toAlum(row({ profile_id: "o", full_name: "Zed", stints: [{ ...row().stints![1] }] }));
    const newerB = toAlum(row({ profile_id: "b", full_name: "Bea" }));
    const newerA = toAlum(row({ profile_id: "a", full_name: "Ana" }));
    expect(sortAlumni([older, newerB, newerA]).map((x) => x.name)).toEqual(["Ana", "Bea", "Zed"]);
  });
});
