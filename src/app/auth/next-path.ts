// Where to send someone once they have signed in or cleared a first-run
// screen: the page their link pointed to, carried as ?next. Only a path on
// this site counts; anything else falls back to "/".
//
// Checking the first characters is not enough. Browsers drop tabs and
// newlines from a URL and read "\" as "/", so "/<tab>/evil.example" and
// "/\evil.example" both become "//evil.example", another site. So control
// characters, whitespace and backslashes are refused outright, and what is
// left must still resolve to this origin when parsed the way a browser does.

const BASE = "http://next-path.invalid";

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\u0000-\u001F\u007F\s\\]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
