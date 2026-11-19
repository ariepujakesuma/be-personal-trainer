const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Offset of `timeZone` from UTC at `at`, in minutes (Jakarta = +420). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Calendar date (YYYY-MM-DD) of `at` in `timeZone`. */
export function localDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** UTC instants bounding a local calendar day: [start, end). */
export function dayRange(date: string, timeZone: string): { start: Date; end: Date } {
  const midnightUtc = new Date(`${date}T00:00:00Z`);
  const offset = tzOffsetMinutes(timeZone, midnightUtc);
  const start = new Date(midnightUtc.getTime() - offset * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60000);
  return { start, end };
}

/** Value to store in a @db.Date column for a local calendar date. */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ageOn(birthDate: Date, date: string): number {
  const ref = dateOnly(date);
  let age = ref.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    ref.getUTCMonth() < birthDate.getUTCMonth() ||
    (ref.getUTCMonth() === birthDate.getUTCMonth() && ref.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
