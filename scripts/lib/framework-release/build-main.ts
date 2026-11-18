// build-main.ts — command line of scripts/framework-release-build.ts (spec 0310 R3, R4, R11).

import fs from "node:fs";
import path from "node:path";

import { writeFrameworkArchive } from "./archive.ts";
import { parseFlags, required, UsageError } from "./cli.ts";
import type { Io } from "./cli.ts";
import { MANIFEST_FILE, parseManifest, resolveManifest } from "./manifest.ts";
import { releaseNotes } from "./notes.ts";
import { RELEASE_BRANCH } from "./guard-main.ts";
import { assetName, parseTag } from "./version.ts";

const OPTIONS = {
  kind: { type: "string" },
  tag: { type: "string" },
  out: { type: "string" },
  root: { type: "string" },
  repository: { type: "string" },
  "workflow-path": { type: "string" },
  manifest: { type: "string" },
} as const;

export function main(argv: readonly string[], io: Io, env: NodeJS.ProcessEnv = process.env): number {
  try {
    const flags = parseFlags(argv, OPTIONS);
    const kind = required(flags, "kind");
    if (kind !== "stable" && kind !== "prerelease") {
      throw new UsageError("--kind must be prerelease or stable");
    }
    const tag = required(flags, "tag");
    const parsed = parseTag(tag, kind);
    if (parsed === undefined) throw new Error(`'${tag}' is not a ${kind} framework tag`);
    const root = path.resolve(typeof flags["root"] === "string" ? flags["root"] : process.cwd());
    const out = path.resolve(required(flags, "out"));
    const repository = typeof flags["repository"] === "string" ? flags["repository"] : env["GITHUB_REPOSITORY"];
    if (repository === undefined || repository === "") throw new UsageError("--repository or GITHUB_REPOSITORY is required");
    const manifest = typeof flags["manifest"] === "string" ? flags["manifest"] : MANIFEST_FILE;

    // Resolve first: nothing is written when an entry is absent.
    const files = resolveManifest(root, parseManifest(fs.readFileSync(manifest, "utf8")));
    fs.mkdirSync(out, { recursive: true });
    const asset = assetName(parsed.version);
    const sha256 = writeFrameworkArchive(files, path.join(out, asset));
    fs.writeFileSync(
      path.join(out, "notes.md"),
      releaseNotes({
        kind,
        tag,
        asset,
        sha256,
        workflowPath: required(flags, "workflow-path"),
        repository,
        releaseBranch: RELEASE_BRANCH,
      }),
    );
    io.out(`files=${files.length}`);
    io.out(`asset=${asset}`);
    io.out(`sha256=${sha256}`);
    const ghOut = env["GITHUB_OUTPUT"];
    if (ghOut !== undefined && ghOut !== "") fs.appendFileSync(ghOut, `asset=${asset}\nsha256=${sha256}\n`);
    return 0;
  } catch (error) {
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof UsageError ? 2 : 1;
  }
}
