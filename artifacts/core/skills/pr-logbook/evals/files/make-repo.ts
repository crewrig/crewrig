// Builds ./repo, a throwaway local repository for this eval: no remote, no
// hook, no signing. It holds two commits, the second of which adds
// specs/0007-retry.md with status "approved".
// Usage: node make-repo.ts   (Node.js 24, no import)

const fs = process.getBuiltinModule("node:fs");
const cp = process.getBuiltinModule("node:child_process");

const repo = "repo";
fs.rmSync(repo, { recursive: true, force: true });
fs.mkdirSync(repo);

const git = (...args: string[]): void => {
  const r = cp.spawnSync("git", args, { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) {
    process.stderr.write(`make-repo: git ${args.join(" ")} failed\n`);
    process.exit(1);
  }
};

git("init", "-q");
git("symbolic-ref", "HEAD", "refs/heads/main");
git("config", "user.name", "Fixture Author");
git("config", "user.email", "fixture@example.invalid");
git("config", "commit.gpgsign", "false");
git("config", "core.hooksPath", "/dev/null");

fs.writeFileSync(
  `${repo}/README.md`,
  "# widgets\n\nA small client library for the widgets service.\n",
);
git("add", "README.md");
git("commit", "-q", "-m", "Add README");

const spec = [
  "---",
  'id: "0007"',
  "slug: retry",
  'status: "approved"  # lifecycle',
  "complexity: small",
  "related-issue: 12",
  "version: 1.0.0",
  "---",
  "",
  "# Retry transient failures in the widget client",
  "",
  "## Intent",
  "",
  "The widget client retries HTTP 429 and 5xx responses so that a brief outage",
  "of the widgets service does not fail the caller.",
  "",
  "## Requirements",
  "",
  "1. **R1.** `getWidget` SHALL retry a 429 or 5xx response up to `maxRetries`",
  "   times with exponential backoff.",
  "2. **R2.** `getWidget` SHALL NOT retry any other HTTP error.",
  "",
].join("\n");
fs.mkdirSync(`${repo}/specs`);
fs.writeFileSync(`${repo}/specs/0007-retry.md`, spec);
git("add", "specs/0007-retry.md");
git("commit", "-q", "-m", "Add spec 0007: retry transient failures");
