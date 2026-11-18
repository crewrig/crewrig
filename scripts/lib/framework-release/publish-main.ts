// publish-main.ts — command line of scripts/framework-release-publish.ts (spec 0310 R4, R5).

import { parseFlags, required, UsageError } from "./cli.ts";
import type { Io } from "./cli.ts";
import { publish } from "./publish.ts";
import type { PublishDeps } from "./publish.ts";

const OPTIONS = {
  kind: { type: "string" },
  tag: { type: "string" },
  commit: { type: "string" },
  asset: { type: "string" },
  notes: { type: "string" },
  repository: { type: "string" },
  "api-url": { type: "string" },
  "uploads-url": { type: "string" },
} as const;

const REAL_DEPS = (io: Io): PublishDeps => ({
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  digestAttempts: 6,
  digestDelayMs: 5000,
  log: io.out,
});

export async function main(
  argv: readonly string[],
  io: Io,
  env: NodeJS.ProcessEnv = process.env,
  deps: PublishDeps = REAL_DEPS(io),
): Promise<number> {
  try {
    const flags = parseFlags(argv, OPTIONS);
    const kind = required(flags, "kind");
    if (kind !== "stable" && kind !== "prerelease") throw new UsageError("--kind must be prerelease or stable");
    const token = env["GH_TOKEN"] ?? "";
    if (token === "") throw new UsageError("GH_TOKEN is not set");
    const repository = typeof flags["repository"] === "string" ? flags["repository"] : env["GITHUB_REPOSITORY"] ?? "";
    if (repository === "") throw new UsageError("--repository or GITHUB_REPOSITORY is required");
    const str = (name: string, fallback: string): string => (typeof flags[name] === "string" ? (flags[name] as string) : fallback);
    await publish(
      {
        apiBase: str("api-url", env["GITHUB_API_URL"] ?? "https://api.github.com").replace(/\/$/, ""),
        uploadsBase: str("uploads-url", "https://uploads.github.com").replace(/\/$/, ""),
        token,
        repository,
      },
      {
        tag: required(flags, "tag"),
        commit: required(flags, "commit"),
        asset: required(flags, "asset"),
        notesFile: required(flags, "notes"),
        prerelease: kind === "prerelease",
      },
      deps,
    );
    return 0;
  } catch (error) {
    // The token never appears in a message; a failure names the call and the HTTP status only.
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof UsageError ? 2 : 1;
  }
}
