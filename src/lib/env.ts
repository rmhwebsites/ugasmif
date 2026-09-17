// Required environment variables, read in one place with an error that says
// what to do about it.
//
// Every Supabase client used to read `process.env.X!`. The `!` is a TypeScript
// assertion and does nothing at runtime, so a missing variable passed
// `undefined` into createServerClient, which threw somewhere deep in the SDK.
// Because the proxy builds a client on every request, one missing variable
// turned every page — including static ones like /login and /no-access — into
// a bare "Internal Server Error" with no clue anywhere in the browser.
//
// Now the error names the variable and where to set it, which is what shows up
// in the Vercel runtime log.

const WHERE =
  "Set it in Vercel under Project Settings -> Environment Variables (then redeploy), " +
  "or in .env.local for local development. .env.example lists every variable.";

/**
 * Reads the first of `names` that has a non-empty value, or throws naming all
 * of them. Several names because the Supabase key has a current spelling
 * (`sb_publishable_…`) and a legacy one (the anon JWT), and either works.
 */
export function requireEnv(...names: [string, ...string[]]): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  const label =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  throw new Error(`SMIF Hub is missing a required setting: ${label}. ${WHERE}`);
}

/** The Supabase project URL and the browser-safe key, together. */
export function supabasePublicConfig(): { url: string; key: string } {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    key: requireEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    ),
  };
}
