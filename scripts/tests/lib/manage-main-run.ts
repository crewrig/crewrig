// manage-main-run.ts — sandbox harness of scripts/tests/manage-main.test.ts: one `manageMain` run
// over a throwaway repository and HOME with captured streams. Nothing touches the real HOME.

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import type { Io } from "../../lib/extension/types.ts";
import { linkWarningLines } from "../../lib/manage/confirm.ts";
import { manageMain } from "../../lib/manage/main.ts";
import type { ManageCtx } from "../../lib/manage/main.ts";
import type { CliDescriptor } from "../../lib/manage/types.ts";
import { newBox, skill, write } from "./overlay-loop-box.ts";

export interface Run {
  readonly status: number;
  readonly out: string[];
  readonly err: string[];
  readonly raw: string[];
  readonly home: string;
  readonly repo: string;
}

/** The staging root of each CLI's skills, relative to `dist/<tier>/`. */
const STAGING: Record<string, string> = {
  claude: ".claude/skills",
  copilot: ".github/skills",
  antigravity: ".agents/skills",
  gemini: ".gemini/skills",
};

export function stage(repo: string, cli: CliDescriptor, name: string): void {
  skill(path.join(repo, "dist/library", STAGING[cli.cli] ?? "", name, "SKILL.md"), name, true);
}

/** Every file under `dir` with its text. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile()) files.set(file, fs.readFileSync(file, "utf8"));
  }
  return files;
}

/** Run `manageMain` in a fresh sandbox; `prepare` writes the fixtures, `answer` feeds standard input. */
export async function run(
  cli: CliDescriptor,
  argv: string[],
  opts: {
    prepare?: (repo: string, home: string) => void;
    answer?: string;
    ctx?: Partial<ManageCtx>;
  } = {},
): Promise<Run> {
  const b = newBox();
  opts.prepare?.(b.repo, b.home);
  // The overlay drivers prune dist/ before a rebuild; the stand-in puts the fixtures back.
  const compiled = snapshot(path.join(b.repo, "dist"));
  const out: string[] = [];
  const err: string[] = [];
  const raw: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), errRaw: (t) => raw.push(t) };
  const stdin = Readable.from(opts.answer === undefined ? [] : [Buffer.from(opts.answer)]);
  const ctx: ManageCtx = {
    io,
    env: {},
    platform: process.platform,
    stdin,
    repoDir: b.repo,
    home: b.home,
    rebuild: () => {
      for (const [file, text] of compiled) write(file, text);
      return { status: 0, output: "" };
    },
    ...opts.ctx,
  };
  const status = await manageMain(cli, argv, ctx);
  return { status, out, err, raw, home: b.home, repo: b.repo };
}

export const warning = (cli: CliDescriptor): string[] => [
  ...linkWarningLines(cli.cli === "gemini" ? "workspace" : (cli.cli as "claude")),
];
