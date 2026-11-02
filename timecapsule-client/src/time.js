// Dates and times, always shown in the browser's own time zone and naming it,
// so nobody has to guess which 9:30 a capsule opens at.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const format = (options) => new Intl.DateTimeFormat(undefined, options);

// "Friday, January 15, 2027 at 9:30 AM EST"
const fullFormat = format({
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
// "Jan 15, 2027, 9:30 AM EST"
const shortFormat = format({
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
// "January 15, 2027"
const dayFormat = format({ year: "numeric", month: "long", day: "numeric" });

export const formatDateTime = (date) => fullFormat.format(new Date(date));
export const formatShortDateTime = (date) => shortFormat.format(new Date(date));
export const formatDay = (date) => dayFormat.format(new Date(date));

// How long until `until`: { total (ms), days, hours, minutes, seconds }, never
// negative. Seconds are rounded up, the way countdowns count: "1 second" shows
// until the moment itself, and 0 only once it has come.
export function timeLeft(until, now = Date.now()) {
  const total = Math.max(0, new Date(until).getTime() - now);
  const seconds = Math.ceil(total / SECOND);
  return {
    total,
    days: Math.floor(seconds / (DAY / SECOND)),
    hours: Math.floor((seconds % (DAY / SECOND)) / (HOUR / SECOND)),
    minutes: Math.floor((seconds % (HOUR / SECOND)) / (MINUTE / SECOND)),
    seconds: seconds % (MINUTE / SECOND),
  };
}

const UNITS = ["day", "hour", "minute", "second"];
const unitFormats = Object.fromEntries(
  UNITS.map((unit) => [
    unit,
    new Intl.NumberFormat(undefined, { style: "unit", unit, unitDisplay: "long" }),
  ]),
);
const listFormat = new Intl.ListFormat(undefined, { style: "long", type: "conjunction" });

// "74 days, 3 hours, 12 minutes, and 5 seconds" (zero parts left out; seconds
// only if asked for).
export function describeTimeLeft(left, { seconds = true } = {}) {
  const values = { day: left.days, hour: left.hours, minute: left.minutes, second: left.seconds };
  const parts = UNITS.filter((unit) => (unit !== "second" || seconds) && values[unit] > 0).map(
    (unit) => unitFormats[unit].format(values[unit]),
  );
  if (parts.length === 0) return seconds ? unitFormats.second.format(0) : "less than a minute";
  return listFormat.format(parts);
}

// The largest whole unit left, for the stamp: { value: "74", unit: "days" }.
export function largestUnitLeft(left) {
  const values = { day: left.days, hour: left.hours, minute: left.minutes };
  const unit = ["day", "hour", "minute"].find((u) => values[u] > 0) ?? "minute";
  const parts = unitFormats[unit].formatToParts(values[unit]);
  return {
    value: parts
      .filter((p) => p.type === "integer" || p.type === "group")
      .map((p) => p.value)
      .join(""),
    unit: parts.find((p) => p.type === "unit")?.value ?? unit,
  };
}
