// ?next= decides where a sign-in or first-run screen sends you. It must only
// ever be a page on this site: anything a browser would read as another host
// falls back to "/", or a link could bounce a member straight off the app.

import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/app/auth/next-path";

describe("safeNextPath", () => {
  it("passes a page on this site through unchanged", () => {
    expect(safeNextPath("/athena")).toBe("/athena");
    expect(safeNextPath("/athena/trades?x=1#vote")).toBe("/athena/trades?x=1#vote");
    expect(safeNextPath("/arch/pitches/7f3a#vote")).toBe("/arch/pitches/7f3a#vote");
  });

  it("falls back to / when there is nothing usable", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("athena")).toBe("/");
  });

  it("refuses other sites written plainly", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
  });

  it("refuses other sites hidden behind characters browsers strip", () => {
    expect(safeNextPath("/\t/evil.example")).toBe("/");
    expect(safeNextPath("/\n/evil.example")).toBe("/");
    expect(safeNextPath("/\r//evil.example")).toBe("/");
    expect(safeNextPath("/ /evil.example")).toBe("/");
    expect(safeNextPath("/\u0000/evil.example")).toBe("/");
    expect(safeNextPath("/athena\\..\\..\\evil")).toBe("/");
  });
});
