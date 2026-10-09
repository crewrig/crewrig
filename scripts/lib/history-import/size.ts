// size.ts — the human-readable size of the history importers' summaries (spec 0253 R13).
//
// The scale of `du -h`: B below 1024, then K, M, G, T in powers of 1024; one decimal below ten,
// none from ten, always rounded UP like `du`. The value is the sum of apparent file sizes, not
// disk blocks (spec 0253 deviation 3), so the figure differs from the shell's on small files.

const UNITS = ["K", "M", "G", "T"] as const;

/** `1.5M`, `12K`, `4.0K`, `0B` — the `du -h` rendering of `bytes`. */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  if (bytes < 1024) return `${Math.ceil(bytes)}B`;
  let value = bytes / 1024;
  let unit = 0;
  for (;;) {
    const rounded = value < 10 ? Math.ceil(value * 10) / 10 : Math.ceil(value);
    if (rounded >= 1024 && unit < UNITS.length - 1) {
      value /= 1024;
      unit += 1;
      continue;
    }
    const text = value < 10 ? rounded.toFixed(1) : String(rounded);
    return `${text}${UNITS[unit]}`;
  }
}
