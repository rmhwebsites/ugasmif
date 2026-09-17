// The Resend probe reports on the domain in EMAIL_FROM, so the parsing has to
// survive every shape a From header takes.

import { describe, it, expect } from "vitest";
import { fromDomain } from "@/lib/health";

describe("fromDomain", () => {
  it("reads the domain out of a display-name header", () => {
    expect(fromDomain("SMIF Hub <no-reply@ugasmif.org>")).toBe("ugasmif.org");
  });

  it("reads a bare address", () => {
    expect(fromDomain("no-reply@ugasmif.org")).toBe("ugasmif.org");
  });

  it("lowercases, so the Resend comparison matches", () => {
    expect(fromDomain("SMIF <No-Reply@UGASMIF.org>")).toBe("ugasmif.org");
  });

  it("keeps a subdomain", () => {
    expect(fromDomain("mail.ugasmif.org".replace(/^/, "a@"))).toBe(
      "mail.ugasmif.org"
    );
  });

  it("returns null for anything that is not an address", () => {
    expect(fromDomain(undefined)).toBeNull();
    expect(fromDomain("")).toBeNull();
    expect(fromDomain("nonsense")).toBeNull();
    // No dot means no domain — "localhost" would pass a naive check.
    expect(fromDomain("root@localhost")).toBeNull();
  });

  it("spots the shared Resend test sender", () => {
    // The probe warns on this: it only delivers to the account owner.
    expect(fromDomain("SMIF Hub <onboarding@resend.dev>")).toBe("resend.dev");
  });
});
