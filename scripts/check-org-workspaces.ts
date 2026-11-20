// check-org-workspaces.ts — spec 0311 (issue #2073): the root workspace set must stay narrowed to the
// upstream tiers, so an adopter's org extension under extensions/org/ never desynchronises the root
// lockfile.
//
// Usage: node scripts/check-org-workspaces.ts      (REPO_DIR overrides the repository root)
// Exit: 0 ok, 1 finding, 2 usage. Node.js built-ins only; it runs before any root `npm ci`.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/create-extension.ts: no top-level
// `import`/`export`, the first statement removes the `warning` listeners, `process.exitCode` rather
// than `process.exit`.

process.removeAllListeners("warning");

const cowFs = require("node:fs") as typeof import("node:fs");
const cowOs = require("node:os") as typeof import("node:os");
const cowPath = require("node:path") as typeof import("node:path");
const cowSpawnSync = (require("node:child_process") as typeof import("node:child_process"))
  .spawnSync;

const SPEC = "spec 0311";
const RESTORE =
  "The root package.json and package-lock.json are upstream-owned strict files: restore them from " +
  "upstream (task sync-from-upstream) so the root workspaces stay extensions/core/* and " +
  `extensions/library/* (${SPEC}).`;

function readJson(file: string): any {
  return JSON.parse(cowFs.readFileSync(file, "utf8"));
}

function staticFindings(root: string): string[] {
  const manifest = readJson(cowPath.join(root, "package.json"));
  const raw = manifest.workspaces;
  const patterns: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.packages)
      ? raw.packages
      : [];
  const findings: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
    if (cowPath.matchesGlob("extensions/org/probe", clean)) {
      findings.push(
        `root workspaces pattern "${pattern}" reaches extensions/org/<name>; org extensions must stay ` +
          `outside the root workspace set (${SPEC}).`,
      );
    }
  }
  return findings;
}

function copyFile(src: string, dest: string): void {
  cowFs.mkdirSync(cowPath.dirname(dest), { recursive: true });
  cowFs.copyFileSync(src, dest);
}

function dynamicFindings(root: string): string[] {
  const tmp = cowFs.mkdtempSync(cowPath.join(cowOs.tmpdir(), "org-workspaces-"));
  try {
    for (const rel of ["package.json", "package-lock.json"])
      copyFile(cowPath.join(root, rel), cowPath.join(tmp, rel));
    const extRoot = cowPath.join(root, "extensions");
    if (cowFs.existsSync(extRoot)) {
      for (const tier of cowFs.readdirSync(extRoot, { withFileTypes: true })) {
        if (!tier.isDirectory()) continue;
        for (const ext of cowFs.readdirSync(cowPath.join(extRoot, tier.name), {
          withFileTypes: true,
        })) {
          const src = cowPath.join(extRoot, tier.name, ext.name, "package.json");
          if (ext.isDirectory() && cowFs.existsSync(src)) {
            copyFile(src, cowPath.join(tmp, "extensions", tier.name, ext.name, "package.json"));
          }
        }
      }
    }
    const skeleton = cowFs
      .readFileSync(
        cowPath.join(__dirname, "..", "extension-skeleton", "base", "package.json"),
        "utf8",
      )
      .replaceAll("${SKELETON_NAME}", "probe");
    const probeFile = cowPath.join(tmp, "extensions", "org", "probe", "package.json");
    cowFs.mkdirSync(cowPath.dirname(probeFile), { recursive: true });
    cowFs.writeFileSync(probeFile, skeleton);

    const findings: string[] = [];
    for (const extra of [[], ["--omit=dev", "--workspaces=false"]]) {
      const run = cowSpawnSync(
        "npm",
        ["ci", "--dry-run", "--ignore-scripts", "--offline", ...extra],
        {
          cwd: tmp,
          encoding: "utf8",
        },
      );
      if (run.error !== undefined) throw run.error;
      if (run.status !== 0) {
        const out = `${run.stdout}${run.stderr}`;
        const missing = out.split("\n").filter((line) => /Missing:|Invalid:/.test(line));
        const detail =
          missing.length > 0 ? missing.join("\n") : out.trim().split("\n").slice(-5).join("\n");
        findings.push(
          `npm ci --dry-run ${extra.join(" ")} failed with a skeleton-shaped org extension present:\n${detail}\n` +
            `Cause: the root lockfile is out of sync with the root workspace set. ${RESTORE}`,
        );
        break;
      }
    }
    return findings;
  } finally {
    cowFs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  if (process.argv.length > 2) {
    process.stderr.write(
      "Usage: node scripts/check-org-workspaces.ts (REPO_DIR overrides the root)\n",
    );
    process.exitCode = 2;
  } else {
    const root = process.env.REPO_DIR ?? cowPath.resolve(__dirname, "..");
    let findings = staticFindings(root);
    if (findings.length === 0) findings = dynamicFindings(root);
    if (findings.length > 0) {
      for (const finding of findings) process.stderr.write(`check-org-workspaces: ${finding}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("check-org-workspaces: ok\n");
    }
  }
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
