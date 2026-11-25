// releaserc-legs.ts — the plugin entries of the engine configuration that vary
// by forge and mode: the gitmoji analyzer, the publish leg and the git leg.

import fs from "node:fs";
import path from "node:path";

import type { GitmojiOptions, PluginEntry, ReleasercInput } from "./releaserc-types.ts";

const PROJECT_URL_MARKER = "@@PROJECT_URL@@";

/** Paths written into the configuration use forward slashes on every host. */
export function configPath(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? value.replaceAll("\\", "/") : value;
}

// LF only, read verbatim: the shell's jq `--rawfile` does no newline handling.
function readTemplate(libDir: string, name: string): string {
  return fs.readFileSync(path.join(libDir, "release-notes", name), "utf8");
}

/** The gitmoji analyzer, through its ESM facade (issue #1225). */
export function gitmojiEntry(input: ReleasercInput, shim: string): PluginEntry {
  const options: GitmojiOptions = {
    releaseRules: {
      major: [":boom:"],
      minor: [":sparkles:"],
      patch: [":bug:", ":ambulance:", ":lock:", ":zap:"],
    },
  };
  if (input.forge === "gitlab") {
    const projectUrl = input.env["CI_PROJECT_URL"] ?? "";
    const serverUrl = input.env["CI_SERVER_URL"] ?? "";
    const withProjectUrl = (text: string): string =>
      text.split(PROJECT_URL_MARKER).join(projectUrl);
    options.releaseNotes = {
      template: withProjectUrl(readTemplate(input.libDir, "gitlab-template.hbs")),
      partials: {
        commitTemplate: withProjectUrl(readTemplate(input.libDir, "gitlab-commit-template.hbs")),
      },
      issueResolution: { template: `${serverUrl}/{owner}/{repo}/-/issues/{ref}` },
    };
  }
  return [shim, options];
}

/** The publish leg: only in publish mode; one archive, a glob (version unknown yet). */
export function publishLeg(input: ReleasercInput, out: string): PluginEntry[] {
  if (input.mode !== "publish") return [];
  const archive = `${out}/*.tar.gz`;
  if (input.forge === "github") {
    return [
      [
        "@semantic-release/github",
        { assets: [{ path: archive, label: `${input.ext} (installable tree)` }] },
      ],
    ];
  }
  // No label: the uploaded file keeps the archive's own basename (plan v1-F4).
  return [
    [
      "@semantic-release/gitlab",
      { assets: [{ path: archive, target: "generic_package", packageName: input.ext }] },
    ],
  ];
}

/** The release commit; `[skip ci]` is kept on every non-prepare commit. */
export function gitLeg(input: ReleasercInput): PluginEntry {
  const title = `🔖 ${input.ext}-v\${nextRelease.version}`;
  const message = input.mode === "prepare" ? title : `${title} [skip ci]`;
  return [
    "@semantic-release/git",
    {
      assets: ["package.json", "extension.json", "CHANGELOG.md"],
      message: `${message}\n\n\${nextRelease.notes}`,
    },
  ];
}
