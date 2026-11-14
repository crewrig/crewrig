#!/usr/bin/env node
// check-contrast.ts — WCAG 2.1 contrast ratio of two colors, with the AA and AAA thresholds.
//
// Usage: node scripts/check-contrast.ts <foreground> <background> [--large] [--level AA|AAA] [--json]
//
// Colors: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(r, g, b), rgba(r, g, b, a), and the names black
// and white. A translucent foreground is composited over the background, a translucent
// background over white; both cases add a warning because the real backdrop may differ.
//
// Exit codes: 0 the pair meets the chosen level and size, 1 it does not, 2 usage error
// (unknown option, missing argument, unparseable color), 3 never used here (no input file).
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing.
type Finding = { rule: string; message: string; severity?: "error" | "warning" };
type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff" };
const THRESHOLDS = {
  AA: { normal: 4.5, large: 3 },
  AAA: { normal: 7, large: 4.5 },
} as const;

const USAGE = `Usage: node scripts/check-contrast.ts <foreground> <background> [--large] [--level AA|AAA] [--json]`;
const HELP = `${USAGE}

Computes the WCAG 2.1 contrast ratio of two colors (hex or rgb()) and checks it against the
threshold of the chosen level (default AA) and text size (default normal; --large for text of
18 pt or more, or 14 pt or more in bold). Thresholds: AA 4.5 normal / 3 large, AAA 7 normal /
4.5 large. Use --large with AA for icons, focus rings and form borders (3:1).

--json prints one {ok, data, findings} object on stdout and the human text on stderr.
Exit codes: 0 meets the threshold, 1 below the threshold, 2 usage error (including a color
that cannot be parsed), 3 environment failure (not used by this script).
`;

function parseColor(input: string): Rgba | null {
  let s = input.trim().toLowerCase();
  if (NAMED[s] !== undefined) s = NAMED[s] as string;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex !== null) {
    let h = hex[1] as string;
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (fn !== null) {
    const parts = (fn[1] as string).split(/[\s,\/]+/).filter((p) => p !== "");
    if (parts.length < 3 || parts.length > 4) return null;
    const chan = (p: string): number | null => {
      const m = /^(\d+(?:\.\d+)?)(%?)$/.exec(p);
      if (m === null) return null;
      const v = m[2] === "%" ? (Number(m[1]) / 100) * 255 : Number(m[1]);
      return v > 255 ? null : v;
    };
    const rgb = parts.slice(0, 3).map(chan);
    if (rgb.some((v) => v === null)) return null;
    let a = 1;
    if (parts[3] !== undefined) {
      const m = /^(\d+(?:\.\d+)?)(%?)$/.exec(parts[3]);
      if (m === null) return null;
      a = m[2] === "%" ? Number(m[1]) / 100 : Number(m[1]);
      if (a > 1) return null;
    }
    return { r: rgb[0] as number, g: rgb[1] as number, b: rgb[2] as number, a };
  }
  return null;
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number): number => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance(c: Rgba): number {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function main(): void {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const findings: Finding[] = [];
  const say = (s: string): void => {
    (json ? process.stderr : process.stdout).write(`${s}\n`);
  };
  const finish = (code: number, data: object | null): void => {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    }
    process.exitCode = code;
  };

  if (argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const usageError = (message: string): void => {
    process.stderr.write(`${message}\n${USAGE}\n`);
    findings.push({ rule: "usage", message });
    finish(2, null);
  };

  let large = false;
  let level: "AA" | "AAA" = "AA";
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--json") continue;
    if (a === "--large") {
      large = true;
    } else if (a === "--level" || a.startsWith("--level=")) {
      const v = a === "--level" ? argv[++i] : a.slice("--level=".length);
      if (v !== "AA" && v !== "AAA") return usageError("--level takes AA or AAA");
      level = v;
    } else if (a.startsWith("--")) {
      return usageError(`unknown option ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 2) {
    return usageError("exactly two colors are required: <foreground> <background>");
  }
  const fg = parseColor(positional[0] as string);
  const bg = parseColor(positional[1] as string);
  if (fg === null) return usageError(`cannot parse foreground color "${positional[0]}"`);
  if (bg === null) return usageError(`cannot parse background color "${positional[1]}"`);

  if (bg.a < 1) {
    findings.push({
      rule: "translucent-background",
      severity: "warning",
      message: "The background is translucent and was composited over white; measure against the real backdrop.",
    });
  }
  const solidBg = over(bg, { r: 255, g: 255, b: 255, a: 1 });
  if (fg.a < 1) {
    findings.push({
      rule: "translucent-foreground",
      severity: "warning",
      message: "The foreground is translucent and was composited over the background.",
    });
  }
  const solidFg = over(fg, solidBg);

  const l1 = luminance(solidFg);
  const l2 = luminance(solidBg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  // Truncate, never round up: 4.499 must not read as 4.50 and pass.
  const shown = Math.floor(ratio * 100) / 100;
  const size = large ? "large" : "normal";
  const required = THRESHOLDS[level][size];
  const passes = ratio >= required;

  const row = (lv: "AA" | "AAA", sz: "normal" | "large"): string =>
    `  ${lv} ${sz.padEnd(6)} (${THRESHOLDS[lv][sz]}:1): ${ratio >= THRESHOLDS[lv][sz] ? "pass" : "fail"}`;
  say(`Contrast ratio: ${shown.toFixed(2)}:1`);
  say(row("AA", "normal"));
  say(row("AA", "large"));
  say(row("AAA", "normal"));
  say(row("AAA", "large"));
  say(`Checked ${level} ${size} text: ${passes ? "PASS" : "FAIL"} (needs ${required}:1)`);

  if (!passes) {
    findings.push({
      rule: "contrast-below-threshold",
      severity: "error",
      message: `Ratio ${shown.toFixed(2)}:1 is below the ${required}:1 that ${level} requires for ${size} text; darken the text or lighten the background.`,
    });
  }
  finish(passes ? 0 : 1, {
    ratio: shown,
    level,
    size,
    required,
    passes,
    thresholds: {
      AA: { normal: ratio >= 4.5, large: ratio >= 3 },
      AAA: { normal: ratio >= 7, large: ratio >= 4.5 },
    },
  });
}

main();
