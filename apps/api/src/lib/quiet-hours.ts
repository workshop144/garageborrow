// Compute whether a given UTC instant falls within a user's quiet hours,
// where quiet_hours_start / quiet_hours_end are HH:MM strings in the user's
// local timezone. EventBridge fires our cron in UTC and SMS senders likewise
// publish in UTC, so we resolve "is it 9pm in the garage's zone right now?" by
// formatting the UTC instant in the target timezone.
//
// Quiet windows can wrap midnight ("21:00" → "08:00"). We handle that by
// detecting end < start and inverting the inclusion check.

const TIMEZONE = process.env["APP_TIMEZONE"] || "America/New_York";

interface ZonedHm {
  hour: number;
  minute: number;
}

function zonedHm(now: Date, timezone: string): ZonedHm {
  // Intl.DateTimeFormat returns timezone-correct hours/minutes regardless
  // of DST — that's what makes this safe across the March/November
  // boundaries without us tracking offsets manually.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minStr = parts.find((p) => p.type === "minute")?.value ?? "00";
  // "24" can come back at midnight on some platforms — normalize to 0.
  const hour = Number.parseInt(hourStr, 10) % 24;
  const minute = Number.parseInt(minStr, 10);
  return { hour, minute };
}

function parseHm(hm: string): ZonedHm {
  const [h, m] = hm.split(":");
  return { hour: Number.parseInt(h ?? "0", 10), minute: Number.parseInt(m ?? "0", 10) };
}

function toMinutes(hm: ZonedHm): number {
  return hm.hour * 60 + hm.minute;
}

export interface QuietHoursOpts {
  start: string;
  end: string;
  timezone?: string;
}

export function isInQuietHours(now: Date, opts: QuietHoursOpts): boolean {
  const tz = opts.timezone ?? TIMEZONE;
  const nowMin = toMinutes(zonedHm(now, tz));
  const startMin = toMinutes(parseHm(opts.start));
  const endMin = toMinutes(parseHm(opts.end));
  if (startMin === endMin) return false;
  if (startMin < endMin) {
    // Same-day window, e.g. 13:00 → 14:00.
    return nowMin >= startMin && nowMin < endMin;
  }
  // Overnight window, e.g. 21:00 → 08:00.
  return nowMin >= startMin || nowMin < endMin;
}

// When deferring a notification because of quiet hours, compute the next UTC
// instant matching `end` in the user's local timezone. The notifier writes
// this to the inapp record's deliver_after attribute.
export function nextEndInstant(now: Date, opts: QuietHoursOpts): Date {
  const tz = opts.timezone ?? TIMEZONE;
  const todayHm = zonedHm(now, tz);
  const endHm = parseHm(opts.end);
  const todayEndMin = toMinutes(endHm);
  const nowMin = toMinutes(todayHm);

  // Find the UTC offset for today in the target timezone — naive but
  // sufficient: subtract from a known UTC date the formatted "now" minutes
  // and back-compute the offset. Faster path: compose a full ISO string in
  // local time then re-parse.
  const yearFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = yearFmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";

  const wallNowIso = `${y}-${mo}-${d}T${pad(endHm.hour)}:${pad(endHm.minute)}:00`;
  // Derive timezone offset by formatting the same instant back to UTC.
  const offsetMin = tzOffsetMinutes(now, tz);
  const target = Date.parse(`${wallNowIso}Z`) - offsetMin * 60_000;
  // If the end is earlier in the day than now, roll forward 24 hours.
  if (todayEndMin <= nowMin) {
    return new Date(target + 24 * 3600_000);
  }
  return new Date(target);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function tzOffsetMinutes(now: Date, tz: string): number {
  // formatToParts gives us "wall clock" components in the target timezone;
  // we reconstruct that as a UTC instant and subtract from `now` to get the
  // offset in minutes.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): number =>
    Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const wallUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((wallUtc - now.getTime()) / 60_000);
}
