// The comparison behind every sortable table (SPEC 11.4). Lives here rather
// than inside the component so it can be tested without a DOM.

export type SortValue = string | number | null;

/**
 * Sorts by `read`, with blanks (null and "") last in BOTH directions.
 *
 * Blanks-last is the point: a bond fund sorted by maturity should not open
 * with a screenful of equities that have none, and reversing the sort should
 * not suddenly fill the top with them either. Numbers compare numerically,
 * everything else through localeCompare.
 */
export function sortByValue<T>(
  rows: T[],
  read: (row: T) => SortValue,
  dir: "asc" | "desc"
): T[] {
  const withVal = rows.map((row) => ({ row, s: read(row) }));
  const nonNull = withVal.filter((x) => x.s !== null && x.s !== "");
  const nulls = withVal.filter((x) => x.s === null || x.s === "");
  nonNull.sort((a, b) => {
    const av = a.s as string | number;
    const bv = b.s as string | number;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
  return [...nonNull, ...nulls].map((x) => x.row);
}
