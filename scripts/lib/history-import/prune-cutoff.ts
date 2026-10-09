// prune-cutoff.ts — the cutoff date of scripts/prune-transcripts.ts (spec 0253 R17): the local
// calendar date `days` days before `now`, with no POSIX `date`.

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of the local date `days` days before `now`. */
export function cutoffDate(days: number, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  if (Number.isNaN(d.getTime())) throw new RangeError(`--days ${days} is out of range`);
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
