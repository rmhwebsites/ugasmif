// The alumni page: shaping what alumni_directory() returns (migration 0007)
// into what the page shows, LinkedIn links, and the search box. Pure, so the
// server page and the client list share it and tests/alumni.test.ts pins it.

import { roleLabel } from "@/lib/permissions";
import type { FundSlug, MembershipRole, PitchAction, PitchStatus } from "@/types/domain";

// ── LinkedIn ────────────────────────────────────────────────────────────────

const LINKEDIN_HELP = "Use a LinkedIn profile link, like linkedin.com/in/jane-doe.";

/**
 * Whatever someone pastes ("linkedin.com/in/jane", "http://uk.linkedin.com/
 * in/jane/?trk=x") into the one form the database accepts:
 * https://www.linkedin.com/in/jane. Blank clears it.
 */
export function normalizeLinkedIn(input: string): { url: string | null } | { error: string } {
  const raw = input.trim();
  if (raw === "") return { url: null };
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: LINKEDIN_HELP };
  }
  const host = parsed.hostname.toLowerCase();
  if (!["http:", "https:"].includes(parsed.protocol)) return { error: LINKEDIN_HELP };
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return { error: LINKEDIN_HELP };
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!/^\/(in|pub)\/[^/]+/i.test(path)) return { error: LINKEDIN_HELP };
  const url = `https://www.linkedin.com${path}`;
  if (url.length > 300) return { error: "That link is too long." };
  return { url };
}

// ── The directory ───────────────────────────────────────────────────────────

/** One membership year, as alumni_directory() returns it. */
export interface AlumStint {
  fund: FundSlug;
  fund_name: string;
  year: string;
  starts_on: string;
  role: MembershipRole;
  title: string | null;
  leader: boolean;
  sector: string | null;
}

export interface AlumPitch {
  id: string;
  fund: FundSlug;
  title: string;
  symbol: string | null;
  action: PitchAction;
  status: PitchStatus;
  result_pct: number | null;
  date: string;
  sector: string | null;
  authored: boolean;
}

/** A row of alumni_directory(). */
export interface AlumRow {
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  linkedin_url: string | null;
  stints: AlumStint[] | null;
  pitches: AlumPitch[] | null;
}

export interface AlumRole {
  year: string;
  fund: FundSlug;
  fundName: string;
  /** "Sector Leader · Technology", "Co-PM" */
  label: string;
}

export interface Alum {
  id: string;
  name: string;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  funds: FundSlug[];
  /** Every year they were in, oldest first. */
  years: string[];
  /** "2023-24 to 2025-26", or "2022-23, 2024-25" with a gap. */
  yearsText: string;
  /** Their last role, for the line under the name. */
  headline: string;
  /** Newest first. */
  roles: AlumRole[];
  /** Newest first. */
  pitches: AlumPitch[];
  /** Lower-cased text the search box looks through. */
  haystack: string;
}

const startYear = (label: string) => Number(label.slice(0, 4));

/** "2023-24 to 2025-26" for an unbroken run, otherwise the years listed. */
export function yearsText(labels: string[]): string {
  const years = [...new Set(labels)].sort((a, b) => startYear(a) - startYear(b));
  if (years.length === 0) return "";
  if (years.length === 1) return years[0];
  const unbroken = years.every((y, i) => i === 0 || startYear(y) === startYear(years[i - 1]) + 1);
  return unbroken ? `${years[0]} to ${years[years.length - 1]}` : years.join(", ");
}

function roleText(s: AlumStint): string {
  const role = roleLabel(s.role, s.title);
  return s.sector ? `${role} · ${s.sector}` : role;
}

export function toAlum(row: AlumRow): Alum {
  const stints = [...(row.stints ?? [])].sort(
    (a, b) => a.starts_on.localeCompare(b.starts_on) || a.fund.localeCompare(b.fund)
  );
  const roles = stints
    .map((s) => ({ year: s.year, fund: s.fund, fundName: s.fund_name, label: roleText(s) }))
    .reverse();
  const pitches = row.pitches ?? [];
  const years = [...new Set(stints.map((s) => s.year))];
  const funds = [...new Set(stints.map((s) => s.fund))].sort();
  const haystack = [
    row.full_name,
    ...years,
    ...stints.flatMap((s) => [s.fund_name, roleText(s)]),
    ...pitches.flatMap((p) => [p.title, p.symbol ?? "", p.sector ?? ""]),
  ]
    .join(" \u0000 ")
    .toLowerCase();
  return {
    id: row.profile_id,
    name: row.full_name,
    avatarUrl: row.avatar_url,
    linkedinUrl: row.linkedin_url,
    funds,
    years,
    yearsText: yearsText(years),
    headline: roles[0]?.label ?? "",
    roles,
    pitches,
    haystack,
  };
}

/** Most recent alumni first, then by name. */
export function sortAlumni(alumni: Alum[]): Alum[] {
  const last = (a: Alum) => (a.years.length ? startYear(a.years[a.years.length - 1]) : 0);
  return [...alumni].sort((a, b) => last(b) - last(a) || a.name.localeCompare(b.name));
}
