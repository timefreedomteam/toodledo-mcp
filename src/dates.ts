// Toodledo stores due/start dates as unix timestamps at noon GMT of that day.

const DAY_SECONDS = 86400;

/** Convert a YYYY-MM-DD string to Toodledo's noon-GMT timestamp. */
export function dateToToodledo(date: string): number {
  return Math.floor(new Date(date + "T12:00:00Z").getTime() / 1000);
}

/** The user's time zone; the cloud server runs in UTC, so "today" is computed here instead. */
export const USER_TIMEZONE = process.env.TIMEZONE || "America/Los_Angeles";

/** Today's date as YYYY-MM-DD in the user's time zone. */
export function localToday(): string {
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: USER_TIMEZONE }).format(new Date());
}

/** Noon-GMT timestamp for today (or the given YYYY-MM-DD). */
export function todayToodledo(date: string = localToday()): number {
  return dateToToodledo(date);
}

/** A task is overdue only once its due day has fully passed, not at noon GMT on that day. */
export function isOverdue(duedate: number, today: number = todayToodledo()): boolean {
  return !!duedate && duedate < today - DAY_SECONDS / 2;
}

/** True when the due date falls on the given day. */
export function isDueOn(duedate: number, today: number = todayToodledo()): boolean {
  return !!duedate && Math.abs(duedate - today) < DAY_SECONDS / 2;
}
