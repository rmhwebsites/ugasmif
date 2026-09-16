// NYSE full-day market holidays, 2025-2028, as observed (spec Section 13.1).
// Rules baked into these dates: a holiday falling on a Saturday is observed
// the preceding Friday, one falling on a Sunday the following Monday.
// New Year's Day 2028 falls on a Saturday and is NOT observed (the preceding
// Friday, Dec 31 2027, closes the yearly accounting period, so the exchange
// stays open) — hence no 2028 New Year's entry.

export const NYSE_HOLIDAYS: readonly string[] = [
  // 2025
  "2025-01-01", // New Year's Day
  "2025-01-20", // Martin Luther King, Jr. Day
  "2025-02-17", // Washington's Birthday (Presidents Day)
  "2025-04-18", // Good Friday
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth National Independence Day
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-11-27", // Thanksgiving Day
  "2025-12-25", // Christmas Day
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King, Jr. Day
  "2026-02-16", // Washington's Birthday (Presidents Day)
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth National Independence Day
  "2026-07-03", // Independence Day (July 4 is a Saturday, observed Friday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King, Jr. Day
  "2027-02-15", // Washington's Birthday (Presidents Day)
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (June 19 is a Saturday, observed Friday)
  "2027-07-05", // Independence Day (July 4 is a Sunday, observed Monday)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving Day
  "2027-12-24", // Christmas Day (Dec 25 is a Saturday, observed Friday)
  // 2028
  "2028-01-17", // Martin Luther King, Jr. Day
  "2028-02-21", // Washington's Birthday (Presidents Day)
  "2028-04-14", // Good Friday
  "2028-05-29", // Memorial Day
  "2028-06-19", // Juneteenth National Independence Day
  "2028-07-04", // Independence Day
  "2028-09-04", // Labor Day
  "2028-11-23", // Thanksgiving Day
  "2028-12-25", // Christmas Day
];

const HOLIDAY_SET: ReadonlySet<string> = new Set(NYSE_HOLIDAYS);

/** True when the given ISO date (YYYY-MM-DD, Eastern) is an NYSE holiday. */
export function isNyseHoliday(isoDate: string): boolean {
  return HOLIDAY_SET.has(isoDate);
}
