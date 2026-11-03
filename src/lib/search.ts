// The search boxes on the Team and Alumni pages: every word typed has to
// appear somewhere in the text a row offers up, in any order, ignoring case.

export function matchesQuery(haystack: string, query: string): boolean {
  const text = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));
}
