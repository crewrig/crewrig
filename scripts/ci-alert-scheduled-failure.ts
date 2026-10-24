// ci-alert-scheduled-failure.ts — notify a human when a scheduled run is red (spec 0284).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-alert-scheduled-failure.ts \
//          --result <success|failure|skipped|cancelled> [--dry-run]
// Context comes from the standard GitHub environment; only the `gh` found on PATH is called.
// Exit: 0 done or nothing to do, 1 `gh` failed, 2 usage error or unknown result.

import { spawnSync } from "node:child_process";

const QUIET = new Set(["success", "skipped", "cancelled"]);

function fail(message: string): never {
  process.stderr.write(`ci-alert-scheduled-failure: ${message}\n`);
  process.exit(2);
}

function gh(args: string[], dryRun: boolean): string {
  if (dryRun) {
    process.stdout.write(`dry-run: gh ${args.map((a) => JSON.stringify(a)).join(" ")}\n`);
    return "[]";
  }
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    process.stderr.write(
      `ci-alert-scheduled-failure: gh ${args[0]} ${args[1]} failed: ${r.error?.message ?? r.stderr}\n`,
    );
    process.exit(1);
  }
  return r.stdout;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const at = argv.indexOf("--result");
const result = at >= 0 ? argv[at + 1] : undefined;
if (result === undefined) fail("missing --result <value>");
if (QUIET.has(result)) {
  process.stdout.write(`ci-alert-scheduled-failure: result is ${result}, nothing to report\n`);
  process.exit(0);
}
if (result !== "failure") fail(`unknown result '${result}'`);

const env = process.env;
const workflow = env.GITHUB_WORKFLOW ?? "";
if (workflow === "") fail("GITHUB_WORKFLOW is not set");
const title = `Scheduled run failed: ${workflow}`;
const marker = `<!-- crewrig:scheduled-failure workflow="${workflow}" -->`;
const runUrl = `${env.GITHUB_SERVER_URL ?? ""}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`;
const details = [
  `- Workflow: ${workflow}`,
  `- Run: ${runUrl}`,
  `- Commit: ${env.GITHUB_SHA ?? ""}`,
  `- Event: ${env.GITHUB_EVENT_NAME ?? ""}`,
  `- Date (UTC): ${new Date().toISOString()}`,
].join("\n");

const listed = JSON.parse(
  gh(
    [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--search",
      `${title} in:title`,
      "--json",
      "number,title,body",
    ],
    dryRun,
  ),
) as { number: number; title: string; body: string }[];
const existing = listed.find((i) => i.title === title && (i.body ?? "").includes(marker));

if (existing) {
  gh(
    [
      "issue",
      "comment",
      String(existing.number),
      "--body",
      `The scheduled run failed again.\n\n${details}`,
    ],
    dryRun,
  );
} else {
  gh(
    [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      `${marker}\n\nThe scheduled run failed.\n\n${details}`,
    ],
    dryRun,
  );
}
