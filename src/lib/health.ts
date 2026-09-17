// Live probes for the two integrations /admin reports on (SPEC 11.3:
// "Sheets reachable, Resend domain verified"). Config presence is not the
// question — a key that is set but revoked, or a sheet the service account was
// never shared into, both look fine from an env var and fail at 9pm when the
// backup cron runs.
//
// Both probes are read-only, both have a short timeout so a hanging third
// party cannot hang the page, and neither ever returns a secret.

import "server-only";

const PROBE_TIMEOUT_MS = 8_000;

export interface ServiceHealth {
  /** false means the integration will not work right now. */
  ok: boolean;
  /** true when the credentials are absent, which is not a failure in dev. */
  configured: boolean;
  /** One short line for the admin page. Never contains a secret. */
  detail: string;
}

function withTimeout(ms: number): {
  signal: AbortSignal;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function message(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "AbortError" ? "timed out" : err.message;
  }
  return String(err);
}

/** The domain EMAIL_FROM sends as, e.g. "SMIF Hub <no-reply@x.org>" -> "x.org". */
export function fromDomain(emailFrom: string | undefined): string | null {
  if (!emailFrom) return null;
  const address = emailFrom.match(/<([^>]+)>/)?.[1] ?? emailFrom;
  const domain = address.split("@")[1]?.trim().toLowerCase();
  return domain && domain.includes(".") ? domain : null;
}

interface ResendDomain {
  name?: string;
  status?: string;
  region?: string;
}

/**
 * Asks Resend whether the domain in EMAIL_FROM is verified. A verified domain
 * is what lets mail reach @uga.edu inboxes rather than the spam folder; the
 * shared onboarding@resend.dev sender works for testing and only delivers to
 * the account owner, so it is reported as a warning, not a pass.
 */
export async function checkResend(): Promise<ServiceHealth> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      detail: "RESEND_API_KEY not set — no email is sent",
    };
  }

  const sender = process.env.EMAIL_FROM;
  const domain = fromDomain(sender);
  const { signal, done } = withTimeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as {
      data?: ResendDomain[];
      message?: string;
      name?: string;
    } | null;

    if (!res.ok) {
      // Resend answers a bad key with 400 and "API key is invalid", not 401,
      // so the body is what says which problem this is.
      const reason = body?.message ?? `HTTP ${res.status}`;
      return {
        ok: false,
        configured: true,
        detail: /api key|unauthor|forbidden/i.test(reason)
          ? `Resend rejected the API key: ${reason}`
          : `Resend returned ${reason}`,
      };
    }
    const domains = body?.data ?? [];

    if (domain === null || domain === "resend.dev") {
      return {
        ok: false,
        configured: true,
        detail:
          "Sending as resend.dev — mail only reaches the Resend account owner. Verify a domain and set EMAIL_FROM.",
      };
    }
    const match = domains.find((d) => d.name?.toLowerCase() === domain);
    if (!match) {
      return {
        ok: false,
        configured: true,
        detail: `${domain} is not a domain on this Resend account`,
      };
    }
    if (match.status !== "verified") {
      return {
        ok: false,
        configured: true,
        detail: `${domain} is ${match.status ?? "unverified"} — finish DNS verification in Resend`,
      };
    }
    return { ok: true, configured: true, detail: `${domain} verified` };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      detail: `Resend unreachable: ${message(err)}`,
    };
  } finally {
    done();
  }
}

/**
 * Reads the backup spreadsheet's title with the service account. That proves
 * three things at once the env vars cannot: the private key parses, the token
 * exchange works, and the sheet has actually been shared with the service
 * account — the step people forget.
 */
export async function checkSheets(): Promise<ServiceHealth> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !spreadsheetId) {
    const missing = [
      !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !key && "GOOGLE_PRIVATE_KEY",
      !spreadsheetId && "GOOGLE_SHEET_ID",
    ].filter(Boolean);
    return {
      ok: false,
      configured: false,
      detail: `Not set: ${missing.join(", ")} — backups are skipped`,
    };
  }

  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: email,
        private_key: key.replace(/\\n/g, "\n"),
      },
      // Read-only is enough to prove access; the backup itself asks for write.
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const api = google.sheets({ version: "v4", auth });
    const res = await api.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title",
    });
    const title = res.data.properties?.title ?? "(untitled)";
    return { ok: true, configured: true, detail: `Reached "${title}"` };
  } catch (err) {
    const detail = message(err);
    // The failures worth naming, because the fix differs for each.
    if (/DECODER|asn1|PEM|unsupported|bad decrypt|invalid key/i.test(detail)) {
      // Almost always the newlines: GOOGLE_PRIVATE_KEY has to keep its \n
      // escapes intact through whatever set the variable.
      return {
        ok: false,
        configured: true,
        detail:
          "GOOGLE_PRIVATE_KEY will not parse — it needs the whole PEM block with its \\n escapes intact",
      };
    }
    if (/invalid_grant|unauthorized_client|invalid JWT/i.test(detail)) {
      return {
        ok: false,
        configured: true,
        detail: `Google rejected the service account ${email}`,
      };
    }
    if (/permission|forbidden|403/i.test(detail)) {
      return {
        ok: false,
        configured: true,
        detail: `The sheet is not shared with ${email}`,
      };
    }
    if (/not found|404/i.test(detail)) {
      return {
        ok: false,
        configured: true,
        detail: "GOOGLE_SHEET_ID does not name a spreadsheet",
      };
    }
    return {
      ok: false,
      configured: true,
      detail: `Sheets unreachable: ${detail.slice(0, 160)}`,
    };
  }
}
