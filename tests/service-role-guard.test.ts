// Guard rail for SPEC Section 9 / CONTRACTS: the service-role Supabase client
// bypasses RLS, so it is allowed in a short list of route folders and nowhere
// else. This test walks the source tree with node:fs and fails with the
// offending paths if that ever stops being true.
//
// If a new route legitimately needs the service role, add it to ALLOWED_API
// here in the same commit that adds the route, and say why.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "src", "app");
const API_DIR = path.join(APP_DIR, "api");
const COMPONENTS_DIR = path.join(ROOT, "src", "components");

/**
 * Route folders allowed to import `@/lib/supabase/service`, as paths relative
 * to `src/app`:
 *   api/cron/**              — unauthenticated scheduler, Bearer CRON_SECRET
 *   api/auth/**              — admin password tools (auth.admin.*)
 *   api/admin/**             — global flags, backup trigger, health
 *   api/[fund]/roster/**     — roster import creates auth users
 *   api/[fund]/members/route.ts — "add one member" creates an auth user
 *   api/[fund]/year/**       — year rollover rewrites every membership
 */
const ALLOWED_API: RegExp[] = [
  /^api\/cron\//,
  /^api\/auth\//,
  /^api\/admin\//,
  /^api\/\[fund\]\/roster\//,
  /^api\/\[fund\]\/members\/route\.ts$/,
  /^api\/\[fund\]\/year\//,
];

/**
 * Non-route files allowed to import it. `src/lib/auth-admin.ts` and
 * `src/lib/sheets/backup.ts` are libraries called from the routes above, not
 * request handlers of their own.
 */
const ALLOWED_LIB = new Set([
  "src/lib/auth-admin.ts",
  "src/lib/sheets/backup.ts",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

/** Every source file under `dir`, recursively, as absolute paths. */
function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // directory does not exist (e.g. no src/components yet)
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry))) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * True when the file imports the service-role client by any spelling: the `@/`
 * alias, a relative path, static import, `require`, or dynamic `import()`.
 */
function importsServiceClient(file: string): boolean {
  const source = readFileSync(file, "utf8");
  return /(?:from|import|require)\s*\(?\s*["'][^"']*\/supabase\/service["']/.test(
    source
  );
}

/** POSIX-style path relative to the repo root, for readable failures. */
function relToRoot(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function relToApp(file: string): string {
  return path.relative(APP_DIR, file).split(path.sep).join("/");
}

describe("service-role client is confined to the routes that need it", () => {
  it("finds source files to scan (the walker is not silently empty)", () => {
    expect(walk(API_DIR).length).toBeGreaterThan(10);
    expect(walk(APP_DIR).length).toBeGreaterThan(walk(API_DIR).length);
  });

  it("is not imported by an API route outside the allowed folders", () => {
    const violations = walk(API_DIR)
      .filter(importsServiceClient)
      .map(relToApp)
      .filter((rel) => !ALLOWED_API.some((allowed) => allowed.test(rel)));

    expect(
      violations,
      violations.length === 0
        ? ""
        : `These API routes import @/lib/supabase/service but are not on the allow list ` +
          `(use createSupabaseServerClient so RLS applies, or extend ALLOWED_API in this test ` +
          `and explain why):\n  ${violations.join("\n  ")}`
    ).toEqual([]);
  });

  it("is not imported by a page, layout or component", () => {
    const scanned = [...walk(APP_DIR), ...walk(COMPONENTS_DIR)];
    const violations = scanned
      .filter((file) => !file.startsWith(API_DIR + path.sep))
      .filter(importsServiceClient)
      .map(relToRoot)
      .filter((rel) => !ALLOWED_LIB.has(rel));

    expect(
      violations,
      violations.length === 0
        ? ""
        : `These files import @/lib/supabase/service outside src/app/api. Server ` +
          `components and client components must use the user-scoped client so RLS ` +
          `applies:\n  ${violations.join("\n  ")}`
    ).toEqual([]);
  });

  it("recognises every spelling of the import", () => {
    const samples = [
      'import { createServiceClient } from "@/lib/supabase/service";',
      "import { createServiceClient } from '../../../lib/supabase/service'",
      'const { createServiceClient } = require("@/lib/supabase/service");',
      'const mod = await import("@/lib/supabase/service");',
    ];
    for (const sample of samples) {
      expect(
        /(?:from|import|require)\s*\(?\s*["'][^"']*\/supabase\/service["']/.test(
          sample
        ),
        sample
      ).toBe(true);
    }
    expect(
      /(?:from|import|require)\s*\(?\s*["'][^"']*\/supabase\/service["']/.test(
        'import { createSupabaseServerClient } from "@/lib/supabase/server";'
      )
    ).toBe(false);
  });

  it("still guards the routes that are on the allow list", () => {
    // Sanity: the allow list is not dead weight — these routes really do use it.
    const allowedUsers = walk(API_DIR).filter(importsServiceClient).map(relToApp);
    expect(allowedUsers).toContain("api/cron/backup/route.ts");
    expect(allowedUsers).toContain("api/[fund]/members/route.ts");
    for (const rel of allowedUsers) {
      expect(ALLOWED_API.some((allowed) => allowed.test(rel)), rel).toBe(true);
    }
  });
});
