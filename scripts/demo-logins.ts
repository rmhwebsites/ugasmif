/**
 * The two short demo logins. Run with `npm run demo-logins`.
 *
 * `npm run seed` builds the full placeholder roster, but its accounts have
 * long addresses nobody wants to type at a demo. This adds two that are easy
 * to say out loud:
 *
 *   admin@uga.edu   — app admin, sees every fund and the admin pages
 *   sector@uga.edu  — Athena's Technology sector leader
 *
 * The sector login takes over the seat the seed already built rather than
 * adding a person, so the roster still shows three people in a three-person
 * sector.
 *
 * Idempotent: rerunning resets the passwords and the membership rather than
 * duplicating anyone. Safe to run after a reseed, which is the point.
 *
 * These are demo credentials in a public repo. Before real portfolio data
 * goes in, delete both accounts and hand out real invites instead.
 *
 * Runs outside Next, so it builds its own service-role client rather than
 * importing @/lib/supabase/service (server-only, and guarded by
 * tests/service-role-guard.test.ts).
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local", quiet: true });

const ADMIN = { email: "admin@uga.edu", password: "test1234" };
const SECTOR = { email: "sector@uga.edu", password: "smif1234" };

/** Which seat sector@uga.edu sits in. */
const SECTOR_FUND = "athena";
const SECTOR_NAME = "Technology";

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local"
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** The user id behind an email, or null. listUsers has no exact-email filter. */
async function findUser(db: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
}

/**
 * Patch the columns this script owns. Deliberately not an upsert: that would
 * blank every column it does not name, including is_app_admin and anyone's
 * own profile edits. full_name is written only when missing, so a rerun never
 * renames someone. onboarded_at is what lets them past the first-run wall — a
 * demo account that lands on "a few details before you start" is no use.
 */
async function syncProfile(
  db: SupabaseClient,
  id: string,
  email: string,
  fullName: string
): Promise<void> {
  const { data: existing } = await db
    .from("profiles")
    .select("id, full_name, onboarded_at")
    .eq("id", id)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {
      email,
      must_change_password: false,
      onboarded_at: existing.onboarded_at ?? new Date().toISOString(),
    };
    if (!existing.full_name) patch.full_name = fullName;
    const { error } = await db.from("profiles").update(patch).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await db.from("profiles").insert({
      id,
      email,
      full_name: fullName,
      must_change_password: false,
      onboarded_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}

/** Create the account, or reset its password if it is already there. */
async function upsertUser(
  db: SupabaseClient,
  email: string,
  password: string,
  fullName: string
): Promise<string> {
  let id = await findUser(db, email);
  if (id) {
    const { error } = await db.auth.admin.updateUserById(id, { password });
    if (error) throw error;
    console.log(`  ${email}: password reset`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw error ?? new Error(`could not create ${email}`);
    id = data.user.id;
    console.log(`  ${email}: created`);
  }
  await syncProfile(db, id, email, fullName);
  return id;
}

async function main() {
  const db = client();

  console.log("App admin");
  const adminId = await upsertUser(db, ADMIN.email, ADMIN.password, "SMIF Admin");
  const { error: adminError } = await db
    .from("profiles")
    .update({ is_app_admin: true })
    .eq("id", adminId);
  if (adminError) throw adminError;

  console.log("Sector leader");
  const { data: fund } = await db
    .from("funds")
    .select("id, name")
    .eq("slug", SECTOR_FUND)
    .maybeSingle();
  if (!fund) throw new Error(`fund ${SECTOR_FUND} not found — run npm run seed first`);

  const { data: sector } = await db
    .from("sectors")
    .select("id")
    .eq("fund_id", fund.id)
    .eq("name", SECTOR_NAME)
    .maybeSingle();
  if (!sector) throw new Error(`sector ${SECTOR_NAME} not found in ${SECTOR_FUND}`);

  // Whatever year the app currently treats as live.
  const { data: year } = await db
    .from("academic_years")
    .select("id, label")
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!year) throw new Error("no academic year found — run npm run seed first");

  // Take over the seat the seed already built rather than adding a person:
  // a second leader would leave the roster showing four people in a
  // three-person sector, one of them a demo account nobody recognises.
  const existingId = await findUser(db, SECTOR.email);
  let sectorId: string;
  if (existingId) {
    sectorId = existingId;
    console.log(`  ${SECTOR.email}: already here`);
  } else {
    const { data: seat } = await db
      .from("memberships")
      .select("user_id")
      .eq("fund_id", fund.id)
      .eq("academic_year_id", year.id)
      .eq("sector_id", sector.id)
      .eq("is_sector_leader", true)
      .limit(1)
      .maybeSingle();
    if (!seat) {
      throw new Error(
        `no ${SECTOR_NAME} sector leader in ${SECTOR_FUND} for ${year.label} — run npm run seed first`
      );
    }
    sectorId = (seat as { user_id: string }).user_id;
    console.log(`  ${SECTOR.email}: renamed the existing ${SECTOR_NAME} leader`);
  }

  const { error: renameError } = await db.auth.admin.updateUserById(sectorId, {
    email: SECTOR.email,
    email_confirm: true,
    password: SECTOR.password,
  });
  if (renameError) throw renameError;
  await syncProfile(db, sectorId, SECTOR.email, `${SECTOR_NAME} Sector Leader`);

  console.log(
    `\n  ${ADMIN.email} / ${ADMIN.password} — app admin` +
      `\n  ${SECTOR.email} / ${SECTOR.password} — ${fund.name}, ${SECTOR_NAME} leader (${year.label})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
