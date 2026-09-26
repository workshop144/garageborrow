// Centralized date formatting. The server stores UTC ISO strings; the UI
// always renders in the garage's home zone (VITE_TIMEZONE, default America/New_York).
// Keep all UI date code going through these helpers so DST edge cases and
// timezone conversions stay in one place.

import { format, formatDistanceStrict, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = import.meta.env.VITE_TIMEZONE || "America/New_York";

function asDate(input: Date | string): Date {
  return typeof input === "string" ? parseISO(input) : input;
}

// "since Tuesday", "due ~Sat", "2 days ago", "in 3 hours". Tuned for borrow
// timelines: relative phrasing in the same week, weekday name beyond that.
//
// All day-boundary comparisons (today/tomorrow/yesterday) happen in the
// app's home zone — date-fns's isToday/isTomorrow use the runtime's local
// TZ and would be wrong on a UTC CI runner. Distances honour the passed
// `now` so callers can stub time deterministically in tests.
export function formatRelative(input: Date | string, now: Date = new Date()): string {
  const d = asDate(input);
  const ms = d.getTime() - now.getTime();
  const absMs = Math.abs(ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return ms >= 0 ? "in moments" : "just now";
  }

  const dDay = formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
  const nowDay = formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd");
  const oneDayBefore = formatInTimeZone(new Date(now.getTime() - day), APP_TIMEZONE, "yyyy-MM-dd");
  const oneDayAfter = formatInTimeZone(new Date(now.getTime() + day), APP_TIMEZONE, "yyyy-MM-dd");

  if (dDay === nowDay) {
    const dist = formatDistanceStrict(d, now);
    return ms >= 0 ? `in ${dist}` : `${dist} ago`;
  }
  if (dDay === oneDayAfter) return "tomorrow";
  if (dDay === oneDayBefore) return "yesterday";
  if (absMs < 7 * day) {
    const weekday = formatInTimeZone(d, APP_TIMEZONE, "EEEE");
    return ms >= 0 ? `~${weekday}` : `since ${weekday}`;
  }
  return formatInTimeZone(d, APP_TIMEZONE, "MMM d, yyyy");
}

// Date-picker display, e.g. "Apr 26, 2026".
export function formatDateInput(input: Date | string): string {
  return formatInTimeZone(asDate(input), APP_TIMEZONE, "MMM d, yyyy");
}

// Wall-clock time in the app zone, e.g. "9:30 AM".
export function formatTime(input: Date | string): string {
  return formatInTimeZone(asDate(input), APP_TIMEZONE, "h:mm a");
}

// Parse a free-form date string (yyyy-MM-dd or anything Date can read) into
// a Date interpreted in the local browser zone — caller is responsible for
// converting to UTC before sending to the server (use `fromAppZone`).
export function parseInputDate(input: string): Date {
  // ISO date-only strings (yyyy-MM-dd) parse as UTC midnight under the
  // standard, which would shift the day in some zones. parseISO + locale
  // adjust is fine for picker UX; explicit zone conversion happens at
  // submit time.
  return parseISO(input);
}

// UTC ISO → Date positioned at the same wall-clock as the app zone. Useful
// when feeding values into widgets that expect a "local" Date.
export function toAppZone(utcDate: Date | string): Date {
  return toZonedTime(asDate(utcDate), APP_TIMEZONE);
}

// Inverse: a Date that represents an app-zone wall-clock moment, back
// to its true UTC ISO string for the server.
export function fromAppZone(zonedDate: Date): string {
  return fromZonedTime(zonedDate, APP_TIMEZONE).toISOString();
}

// Convenience for date-only formatting in the app zone using a custom
// pattern (e.g. for chart axes). Prefer one of the named helpers above
// when possible.
export function formatInAppZone(input: Date | string, pattern: string): string {
  return formatInTimeZone(asDate(input), APP_TIMEZONE, pattern);
}

// Used by tests to avoid pulling in date-fns directly.
export { format };
