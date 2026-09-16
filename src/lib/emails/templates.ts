// Branded email template (spec Section 16). One dark-card HTML template used
// by every outbound email: SMIF wordmark, a fund accent bar (Athena red /
// Arch gold / neutral), heading, body lines, and an optional CTA button that
// links into the app. A plain-text fallback is rendered alongside.

import type { FundSlug } from "@/types/domain";

export interface EmailTemplateOptions {
  heading: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaPath?: string;
  fundSlug?: FundSlug;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Fund accent colors — UGA red for Athena, Arch gold, neutral otherwise. */
const ACCENTS: Record<string, { accent: string; buttonText: string }> = {
  athena: { accent: "#ba0c2f", buttonText: "#ffffff" },
  arch: { accent: "#ce9c5c", buttonText: "#0b0b0d" },
  neutral: { accent: "#6b7280", buttonText: "#ffffff" },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

/**
 * Renders the branded HTML email plus a plain-text fallback. Table-based
 * layout with inline styles so it survives every email client.
 */
export function renderEmail(opts: EmailTemplateOptions): RenderedEmail {
  const { accent, buttonText } =
    ACCENTS[opts.fundSlug ?? "neutral"] ?? ACCENTS.neutral;
  const ctaUrl =
    opts.ctaLabel && opts.ctaPath ? `${appUrl()}${opts.ctaPath}` : null;

  const bodyHtml = opts.bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 12px;color:#c9c9cf;font-size:14px;line-height:1.6;">${escapeHtml(line)}</p>`
    )
    .join("\n");

  const ctaHtml = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
        <tr>
          <td style="border-radius:8px;background-color:${accent};">
            <a href="${escapeHtml(ctaUrl)}" target="_blank"
               style="display:inline-block;padding:12px 24px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${buttonText};text-decoration:none;border-radius:8px;">
              ${escapeHtml(opts.ctaLabel ?? "Open SMIF Hub")}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0b0d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b0d;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <!-- Wordmark -->
          <tr>
            <td style="padding:0 8px 16px;">
              <span style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;letter-spacing:0.14em;color:#f4f4f5;">SMIF</span>
              <span style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;font-weight:400;letter-spacing:0.14em;color:${accent};">&nbsp;HUB</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:#141317;border:1px solid #26252b;border-radius:12px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <!-- Accent bar -->
                <tr>
                  <td style="height:4px;background-color:${accent};font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:28px 32px 24px;">
                    <h1 style="margin:0 0 16px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#f4f4f5;line-height:1.3;">
                      ${escapeHtml(opts.heading)}
                    </h1>
                    <div style="font-family:Inter,Helvetica,Arial,sans-serif;">
                      ${bodyHtml}
                    </div>
                    ${ctaHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 8px 0;">
              <p style="margin:0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:#6b6b73;line-height:1.6;">
                UGA Student Managed Investment Fund &middot; sent by SMIF Hub.<br />
                Manage email preferences on your <a href="${escapeHtml(appUrl())}/profile" style="color:#9c9ca4;">profile page</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts = [
    "SMIF HUB",
    "",
    opts.heading,
    "",
    ...opts.bodyLines,
  ];
  if (ctaUrl) {
    textParts.push("", `${opts.ctaLabel}: ${ctaUrl}`);
  }
  textParts.push(
    "",
    "--",
    "UGA Student Managed Investment Fund - sent by SMIF Hub.",
    `Manage email preferences at ${appUrl()}/profile`
  );

  return { html, text: textParts.join("\n") };
}
