// org-extensions.ts — spec 0311 (issue #2073): install, build or test org-tier extensions that sit
// outside the root workspace set.
//
// Usage: node scripts/org-extensions.ts [install|build|test] [<name>...]   (REPO_DIR overrides the root)
//   - `install` is the default action; a name is a directory under extensions/org/.
//   - With no name, every org extension present is processed. With none present: no-op, exit 0.
//   - Mode A (extensions/org/package.json exists): one npm call there, `--workspace <name>` per name.
//     A Mode A install replaces the installed set, so name every extension needed in one call.
//   - Mode B (no extensions/org/package.json): per extension, `npm ci` (lockfile) or `npm install`,
//     then `npm run <action> --if-present`.
// Exit: 0 ok, 1 unknown name, 2 usage, else npm's exit code. Never runs npm at the repository root.
// Node.js built-ins only.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5): no top-level `import`/`export`, `warning` listeners
// removed first, `process.exitCode` rather than `process.exit`.

process.removeAllListeners("warning");

const oexFs = require("node:fs") as typeof import("node:fs");
const oexPath = require("node:path") as typeof import("node:path");
const oexSpawnSync = (require("node:child_process") as typeof import("node:child_process")).spawnSync;

const ACTIONS = ["install", "build", "test"];

function npm(cwd: string, args: string[]): number {
  const run = oexSpawnSync("npm", args, { cwd, stdio: "inherit" });
  if (run.error !== undefined) throw run.error;
  return run.status ?? 1;
}

function main(): number {
  const argv = process.argv.slice(2);
  const action = argv.length > 0 && ACTIONS.includes(argv[0]!) ? argv.shift()! : "install";
  if (argv.length > 0 && ACTIONS.includes(argv[0]!)) {
    process.stderr.write("Usage: org-extensions.ts [install|build|test] [<name>...]\n");
    return 2;
  }
  const root = process.env.REPO_DIR ?? oexPath.resolve(__dirname, "..");
  const orgDir = oexPath.join(root, "extensions", "org");

  const available = oexFs.existsSync(orgDir)
    ? oexFs
        .readdirSync(orgDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && oexFs.existsSync(oexPath.join(orgDir, e.name, "package.json")))
        .map((e) => e.name)
        .sort()
    : [];
  if (available.length === 0) {
    process.stdout.write("org-extensions: no org extension, nothing to do\n");
    return 0;
  }

  const names = [...new Set(argv)];
  const unknown = names.filter((n) => !available.includes(n));
  if (unknown.length > 0) {
    process.stderr.write(
      `org-extensions: unknown org extension ${unknown.join(", ")}; available: ${available.join(", ")}\n`,
    );
    return 1;
  }
  const selected = names.length > 0 ? names : available;

  if (oexFs.existsSync(oexPath.join(orgDir, "package.json"))) {
    const flags = names.length > 0 ? names.flatMap((n) => ["--workspace", n]) : [];
    if (action === "install") {
      const verb = oexFs.existsSync(oexPath.join(orgDir, "package-lock.json")) ? "ci" : "install";
      return npm(orgDir, [verb, ...flags]);
    }
    return npm(orgDir, ["run", action, "--if-present", ...(names.length > 0 ? flags : ["--workspaces"])]);
  }

  for (const name of selected) {
    const dir = oexPath.join(orgDir, name);
    const verb = oexFs.existsSync(oexPath.join(dir, "package-lock.json")) ? "ci" : "install";
    let status = npm(dir, [verb]);
    if (status === 0 && action !== "install") status = npm(dir, ["run", action, "--if-present"]);
    if (status !== 0) return status;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
