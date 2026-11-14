/** Dates in Helsinki time, where Valio Aimo delivers. */

const HELSINKI = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in Helsinki as YYYY-MM-DD. */
export function helsinkiDate(now: Date): string {
  return HELSINKI.format(now);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The first delivery day to ask Valio Aimo about when the buyer names none: tomorrow. */
export function nextDeliveryDate(now: Date): string {
  return addDays(helsinkiDate(now), 1);
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** A cut-off time in plain language, such as "Thursday 12 November at 15:00". */
export function describeTime(iso: string): string {
  const parts = Object.fromEntries(WEEKDAY.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute}`;
}
