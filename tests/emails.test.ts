// The branded email template (SPEC Section 16). Email is the one surface a
// member sees outside the app, and the one we cannot fix after sending, so
// the escaping and the links are worth pinning down.

import { describe, it, expect } from "vitest";
import { renderEmail } from "@/lib/emails/templates";

const APP = "https://smif.example.org";
process.env.NEXT_PUBLIC_APP_URL = APP;

describe("renderEmail", () => {
  it("escapes HTML in the heading and body", () => {
    // A pitch title is user input and goes into the subject and heading.
    const { html } = renderEmail({
      heading: 'Vote result: "Tech & Co" <script>alert(1)</script>',
      bodyLines: ["5 yes / 2 no & 1 abstain", "<b>not bold</b>"],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tech &amp; Co");
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
  });

  it("escapes the CTA label and url", () => {
    const { html } = renderEmail({
      heading: "x",
      bodyLines: [],
      ctaLabel: 'Open "the" pitch',
      ctaPath: "/athena/pitches/abc?a=1&b=2",
    });
    expect(html).toContain("&amp;b=2");
    expect(html).toContain("&quot;the&quot;");
  });

  it("builds an absolute CTA from a relative path", () => {
    const { html, text } = renderEmail({
      heading: "x",
      bodyLines: [],
      ctaLabel: "Open",
      ctaPath: "/athena/pitches/abc",
    });
    expect(html).toContain(`${APP}/athena/pitches/abc`);
    expect(text).toContain(`Open: ${APP}/athena/pitches/abc`);
  });

  it("passes an absolute CTA through untouched", () => {
    // Supabase invite action links arrive absolute and must not be prefixed.
    const link = "https://ucv.supabase.co/auth/v1/verify?token=abc";
    const { html } = renderEmail({
      heading: "x",
      bodyLines: [],
      ctaLabel: "Set your password",
      ctaPath: link,
    });
    expect(html).toContain("https://ucv.supabase.co/auth/v1/verify?token=abc");
    expect(html).not.toContain(`${APP}https://`);
  });

  it("renders no CTA when only one of label/path is given", () => {
    // The footer always carries a link, so the button's own padding is what
    // distinguishes "there is a CTA" from "there is not".
    const BUTTON = "padding:12px 24px";
    expect(
      renderEmail({ heading: "x", bodyLines: [], ctaLabel: "Open" }).html
    ).not.toContain(BUTTON);
    expect(
      renderEmail({ heading: "x", bodyLines: [], ctaPath: "/x" }).html
    ).not.toContain(BUTTON);
    expect(
      renderEmail({
        heading: "x",
        bodyLines: [],
        ctaLabel: "Open",
        ctaPath: "/x",
      }).html
    ).toContain(BUTTON);
  });

  it("points the footer at the fund's profile page, which is where it lives", () => {
    // There is no top-level /profile: the page is at /[fund]/profile. The
    // footer used to link to /profile on every email, and 404'd.
    const withFund = renderEmail({
      heading: "x",
      bodyLines: [],
      fundSlug: "athena",
    });
    expect(withFund.html).toContain(`${APP}/athena/profile`);
    expect(withFund.text).toContain(`${APP}/athena/profile`);
    expect(withFund.html).not.toContain(`${APP}/profile"`);

    // No fund: "/" redirects to whichever fund the member last used.
    const noFund = renderEmail({ heading: "x", bodyLines: [] });
    expect(noFund.html).toContain(`${APP}/"`);
    expect(noFund.html).not.toContain(`${APP}/profile`);
  });

  it("uses the fund accent, red for Athena and gold for Arch", () => {
    expect(
      renderEmail({ heading: "x", bodyLines: [], fundSlug: "athena" }).html
    ).toContain("#ba0c2f");
    expect(
      renderEmail({ heading: "x", bodyLines: [], fundSlug: "arch" }).html
    ).toContain("#ce9c5c");
    // No fund: neutral grey, never one fund's color on the other's mail.
    const neutral = renderEmail({ heading: "x", bodyLines: [] }).html;
    expect(neutral).toContain("#6b7280");
    expect(neutral).not.toContain("#ba0c2f");
  });

  it("puts every body line in the plain-text fallback", () => {
    const lines = ["first", "second", "third"];
    const { text } = renderEmail({ heading: "Heading", bodyLines: lines });
    for (const line of lines) expect(text).toContain(line);
    expect(text).toContain("Heading");
    // The text part must not carry markup.
    expect(text).not.toContain("<p");
  });
});
