// org-rig.ts — the rig of the organization command tests (spec 0315 R14, delta-01 R14; plan of issue #2114, step 12).
//
// Every test runs the template launcher UNMODIFIED, as a black box, in a copy of the template whose pin names an
// archive built from manifest.txt alone and served by a local HTTP server, so the commands run from the verified
// version root the launcher caches under the temporary HOME (never from the checkout). The rig adds, on top of
// launcher-rig.ts:
//   - an organization directory (a scaffold the way `init` leaves it, plus optional skills, agents and git);
//   - a PATH that holds only `node`, `git` and stub `claude` and `agy` (and nothing that could reach the host's
//     service manager or find a MemPalace interpreter), a temporary HOME, and `--answer` for every question;
//   - a digest of a directory tree (paths, bytes, modes) to prove that the version root stays read-only;
//   - the archive builder for a second version, and git repositories that play the organization's upstream.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFrameworkArchive } from "../../lib/framework-release/archive.ts";
import { resolveManifest } from "../../lib/framework-release/manifest.ts";
import { stageJsYaml } from "../../lib/framework-release/vendor.ts";
import {
  REPO,
  copyTemplate,
  pinOf,
  runLauncher,
  runNode,
  serveArchive,
  testManifestRecords,
  type Archive,
  type Rig,
  type RunOptions,
  type RunResult,
  type TestServer,
} from "./launcher-rig.ts";
import { makeToolchain, type Toolchain } from "./org-toolchain.ts";

export {
  daemonFilesUnder,
  gitIn,
  hostServices,
  porcelain,
  treeDigest,
  withUpstream,
  type Upstream,
} from "./org-toolchain.ts";

export const CLI_NAMES = ["claude", "gemini", "copilot", "antigravity"] as const;
export type CliName = (typeof CLI_NAMES)[number];

/** Every question setup can ask answered "no" or "default", so a run never waits on a terminal. */
export const ANSWER_VALUES: Readonly<Record<string, string>> = {
  "rules-action": "refresh",
  "validation.backend": "internal",
  "validation.translate": "off",
  "validation.pedagogy": "contextual",
  "validation.illustration": "off",
  "tls-delegation": "no",
  "mempalace-install": "no",
  "install-seqthink": "no",
  "legacy-mcp-removal": "no",
  "install-settings": "yes",
  "catalogue.team": "NOVA",
  "catalogue.expertise": "BACKEND-JAVA",
  "catalogue.level": "JUNIOR",
  "profile-method": "keep-local",
  "overlay.community": "no",
  "overlay.org": "yes",
  transcripts: "no",
  "transcripts-confirm": "no",
  "usage-capture": "yes",
  "usage-capture-keep": "keep",
};

/** `--answer <id>=<value>` for every question of the inventory (an answer a CLI never asks is ignored). */
export const SETUP_ANSWERS: readonly string[] = answerArgs({});

/** The `--answer` arguments of every question, with `overrides` replacing the default value of an id. */
export function answerArgs(overrides: Readonly<Record<string, string>>): string[] {
  return Object.entries({ ...ANSWER_VALUES, ...overrides }).flatMap(([id, value]) => [
    "--answer",
    `${id}=${value}`,
  ]);
}

export const CONFIG_TOML =
  'canonical_repo = "https://github.com/crewrig/crewrig"\nfeedback_repo = "https://github.com/acme/crewrig-config"\n';

export const IGNORE_TEXT = "config/SOUL.md\nconfig/PROFILE.md\ndist/\n";

// ------------------------------------------------------------------------------------ archives

const archives = new Map<string, Archive>();

export interface ArchiveVariant {
  /** Archive path to the content that replaces (or adds) that file. */
  readonly replace?: Readonly<Record<string, string>>;
  /** Archive paths left out. */
  readonly remove?: readonly string[];
}

/**
 * An archive of the manifest files labelled `version`, built once per process, label and variant. A variant
 * replaces, adds or drops files after the manifest is resolved, so a test can ask what an archive that lacks
 * a file (the root package.json, say) or carries another template does.
 */
export function archiveOfVersion(version: string, variant: ArchiveVariant = {}): Archive {
  const key = `${version}\0${JSON.stringify(variant)}`;
  const known = archives.get(key);
  if (known !== undefined) return known;
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "crewrig-org-archive-")),
  );
  process.once("exit", () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  stageJsYaml(REPO);
  const target = path.join(dir, `crewrig-${version}.tgz`);
  const removed = new Set(variant.remove ?? []);
  const replaced = variant.replace ?? {};
  const files = resolveManifest(REPO, testManifestRecords())
    .filter((file) => !removed.has(file.path) && !(file.path in replaced))
    .map((file) => ({ ...file }));
  for (const [rel, content] of Object.entries(replaced)) {
    const abs = path.join(dir, `replacement-${files.length}`);
    fs.writeFileSync(abs, content);
    files.push({ path: rel, mode: 0o644, abs });
  }
  files.sort((x, y) => (x.path < y.path ? -1 : 1));
  const archive = { file: target, version, sha256: writeFrameworkArchive(files, target) };
  archives.set(key, archive);
  return archive;
}

// ------------------------------------------------------------------------------- the world

export interface OrgOptions {
  /** The pin the launcher reads; defaults to the world's archive. */
  pin?: Record<string, unknown> | string | null;
  /** The `.gitignore` text to write (undefined: none). */
  gitignore?: string;
  /** Extra files, repository-relative path to content. */
  files?: Record<string, string>;
  /** Leave out config/ORGANIZATION.md (spec 0315 R6). */
  withoutOrganizationFile?: boolean;
}

export const SKILL_MD = (name: string): string =>
  `---\nname: ${name}\ndescription: "An organization skill that the end-to-end tests of the commands compile."\ntype: skill\nmetadata:\n  provenance:\n    canonical: "\${CANONICAL_REPO}"\n    feedback: "\${FEEDBACK_REPO}"\n    version: "1.0.0"\n---\n\n# ${name}\n\nDo the thing.\n`;

export const AGENT_MD = (name: string): string =>
  `---\nname: ${name}\ndescription: "An organization agent that the end-to-end tests of the commands compile."\ntype: agent\nmetadata:\n  model:\n    intelligence: medium\n    reasoning: medium\n  tools: [read, search]\n  provenance:\n    canonical: "\${CANONICAL_REPO}"\n    feedback: "\${FEEDBACK_REPO}"\n    version: "1.0.0"\n---\n\n# ${name}\n\nYou are ${name}.\n`;

export interface World {
  readonly rig: Rig;
  readonly server: TestServer;
  readonly archive: Archive;
  readonly tools: Toolchain;
  /** `<home>/.crewrig/versions/<version>`, the version root the launcher caches. */
  versionRoot(version?: string): string;
  /** The environment of a child: the restricted PATH, the local server, and `extra`. */
  env(extra?: Record<string, string | undefined>): Record<string, string | undefined>;
  /** A copy of the template scaffolded as an organization directory. */
  makeOrg(options?: OrgOptions): string;
  /** `node <org>/crewrig <command> ...` through the launcher. */
  run(
    dir: string,
    command: string,
    args?: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult>;
  /** `run(dir, "setup", ["--cli", cli, ...SETUP_ANSWERS])`. */
  setup(
    dir: string,
    cli: CliName,
    extraArgs?: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult>;
}

export function makeWorld(rig: Rig, server: TestServer, archive: Archive): World {
  const tools = makeToolchain(rig);
  const world: World = {
    rig,
    server,
    archive,
    tools,
    versionRoot(version = archive.version) {
      return path.join(rig.versions, version);
    },
    env(extra = {}) {
      return {
        PATH: tools.pathValue,
        CREWRIG_RELEASE_BASE_URL: server.origin,
        ...extra,
      };
    },
    makeOrg(options = {}) {
      const dir = copyTemplate(rig, options.pin === undefined ? pinOf(archive) : options.pin);
      fs.writeFileSync(path.join(dir, "crewrig.config.toml"), CONFIG_TOML);
      fs.mkdirSync(path.join(dir, "config"));
      const copies: [string, string][] = [["config/TOOLS.md.template", "config/TOOLS.md"]];
      if (options.withoutOrganizationFile !== true)
        copies.push(["config/ORGANIZATION.md.template", "config/ORGANIZATION.md"]);
      for (const [from, to] of copies) fs.copyFileSync(path.join(REPO, from), path.join(dir, to));
      for (const catalog of ["teams", "expertise", "level"])
        fs.cpSync(path.join(REPO, "config", catalog), path.join(dir, "config", catalog), {
          recursive: true,
        });
      for (const home of [
        "artifacts/org/skills",
        "artifacts/org/agents",
        "artifacts/community/hooks",
      ]) {
        fs.mkdirSync(path.join(dir, home), { recursive: true });
        fs.writeFileSync(path.join(dir, home, ".gitkeep"), "");
      }
      if (options.gitignore !== undefined)
        fs.writeFileSync(path.join(dir, ".gitignore"), options.gitignore);
      for (const [rel, content] of Object.entries(options.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
      }
      return dir;
    },
    run(dir, command, args = [], options = {}) {
      return runLauncher(rig, dir, [command, ...args], {
        ...options,
        env: world.env(options.env),
      });
    },
    setup(dir, cli, extraArgs = [], options = {}) {
      return world.run(dir, "setup", ["--cli", cli, ...SETUP_ANSWERS, ...extraArgs], options);
    },
  };
  return world;
}

/** A world serving `archive` (default: the archive of version 1.0.0-test.1) to a fresh home. */
export function newWorld(
  rigs: { make(): Rig },
  servers: { start(): Promise<TestServer> },
  archive: Archive = archiveOfVersion("1.0.0-test.1"),
): Promise<World> {
  const rig = rigs.make();
  return servers.start().then((server) => {
    serveArchive(server, archive);
    return makeWorld(rig, server, archive);
  });
}

/** The entry point of a version root, run directly (no launcher) with the rig's environment. */
export function runEntryOf(
  world: World,
  versionRoot: string,
  dir: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return runNode(world.rig, path.join(versionRoot, "scripts", "crewrig-cli.ts"), args, {
    cwd: dir,
    ...options,
    env: world.env(options.env),
  });
}
