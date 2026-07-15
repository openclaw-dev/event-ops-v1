/**
 * dates.ts
 *
 * Timezone-aware calendar-date helpers. The codebase serves operators and
 * customers who live in the event's timezone (typically Asia/Riyadh, UTC+3);
 * computing calendar dates from UTC is wrong every night between 21:00 UTC and
 * midnight (00:00–03:00 local). These helpers centralise the correct approach
 * (the one already proven in generator.ts's buildEventTimingContext):
 * render the date in the target IANA timezone via Intl.DateTimeFormat, then do
 * whole-day arithmetic on the resulting YYYY-MM-DD strings.
 *
 * No date libraries — Intl.DateTimeFormat is sufficient.
 */

/**
 * Default timezone for contexts that have no single event to read a timezone
 * from (e.g. operator-level event routing before an event is chosen) or where
 * an event row is missing its timezone. Chosen as the primary market's zone
 * rather than UTC so the "midnight" boundary matches the operator/customer.
 */
export const DEFAULT_EVENT_TZ = 'Asia/Riyadh';

/** YYYY-MM-DD for `date` as seen in the given IANA timezone (en-CA → ISO order). */
export function localDateStringInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/** Epoch ms at UTC-midnight of a YYYY-MM-DD string (for whole-day arithmetic). */
export function parseYMDToUTCms(ymd: string): number {
  return Date.UTC(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(5, 7), 10) - 1,
    parseInt(ymd.slice(8, 10), 10),
  );
}

/**
 * Whole calendar days from baseYMD to targetYMD (both YYYY-MM-DD).
 * Positive when target is later. Operates on dates only, so it is immune to
 * time-of-day and to the UTC-vs-local midnight skew.
 */
export function dayDiff(targetYMD: string, baseYMD: string): number {
  return Math.round((parseYMDToUTCms(targetYMD) - parseYMDToUTCms(baseYMD)) / 86_400_000);
}

/** Offset (ms) of `timeZone` from UTC at the instant `date` (positive = east of UTC). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string): number =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const wallAsUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // wallAsUTC is the local wall-clock reinterpreted as UTC; the gap from the
  // real instant (floored to whole seconds, as the parts carry no ms) is the offset.
  return wallAsUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant corresponding to 00:00 local time (in `timeZone`) of the day
 * that contains `now`. Use for "since start of today" filters that must align to
 * the operator/customer's midnight, not the server's UTC midnight.
 */
export function startOfLocalDayUTC(now: Date, timeZone: string): Date {
  const midnightWallAsUTC = parseYMDToUTCms(localDateStringInTz(now, timeZone));
  return new Date(midnightWallAsUTC - tzOffsetMs(now, timeZone));
}
