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
// "3:30 AM EDT"
const timeFormat = format({ hour: "numeric", minute: "2-digit", timeZoneName: "short" });

// "2:30 AM", for a time of day on its own (read as UTC, so no zone moves it).
const wallFormat = format({ hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export const formatDateTime = (date) => fullFormat.format(new Date(date));
export const formatShortDateTime = (date) => shortFormat.format(new Date(date));
export const formatDay = (date) => dayFormat.format(new Date(date));
export const formatTime = (date) => timeFormat.format(new Date(date));

// The time of day in a datetime-local value ("2027-03-14T02:30" → "2:30 AM"), as
// typed, even on a night when the clocks skip it.
export function formatWallTime(value) {
  const match = /T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return value;
  return wallFormat.format(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
}

// Browsers still name a few zones after a city's old name (Asia/Calcutta for
// India); people know these cities by their current one.
const RENAMED_CITIES = {
  Calcutta: "Kolkata",
  Saigon: "Ho Chi Minh City",
  Katmandu: "Kathmandu",
  Rangoon: "Yangon",
  Kiev: "Kyiv",
  Godthab: "Nuuk",
};

// The browser's time zone as people say it: "Eastern Time (Toronto)".
export function timeZoneLabel(date = new Date()) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const last = zone.split("/").pop();
  const city = zone.includes("/") ? (RENAMED_CITIES[last] ?? last).replaceAll("_", " ") : zone;
  const name = format({ timeZoneName: "longGeneric" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!name) return city;
  return city && !name.includes(city) ? `${name} (${city})` : name;
}

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

// "2027-01-15T09:30", the value a datetime-local input takes, for a Date.
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// Reads a datetime-local value ("2027-03-14T02:30") as a time in the browser's
// zone. Returns null if it isn't one, else { date, issue }, where issue is:
//   null        an ordinary time
//   "skipped"   it doesn't exist that day: clocks spring forward past it, and
//               `date` is the same time after the jump (02:30 becomes 03:30)
//   "repeated"  it happens twice: clocks fall back over it, and `date` is the
//               first time (the one JavaScript, and so the form, picks)
export function readLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime())) return null;

  if (toLocalInputValue(date) !== value) return { date, issue: "skipped" };

  // If the clocks fall back in the next few hours, the same wall-clock time
  // comes round again once they have.
  const offsetLater = new Date(date.getTime() + 3 * HOUR).getTimezoneOffset();
  const fallBack = offsetLater - date.getTimezoneOffset(); // minutes
  if (fallBack > 0) {
    const again = new Date(date.getTime() + fallBack * MINUTE);
    if (toLocalInputValue(again) === value) return { date, issue: "repeated" };
  }
  return { date, issue: null };
}
