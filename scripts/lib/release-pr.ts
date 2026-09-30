// release-pr.ts — open, update or close the GitHub release PR and run its
// required checks (issue #1379).
//
// The `main-protected` ruleset requires the `ratchet` and `lint-typescript`
// checks on every commit reaching `main`, so the release workflow can no
// longer push its version commit there. scripts/monorepo-release.sh instead
// commits the version bumps and changelogs to the release PR's head branch
// (release_pr_branch, `release-pr/<base>`) and hands the pending releases to
// this module, which:
//
//   1. finds the open release PR (head `<owner>:<head>`, base `<base>`);
//   2. with pending releases: updates its title and body, or opens it; with
//      none: closes a stale one (its releases were published or withdrawn);
//   3. dispatches the checks workflow (default build.yml) on the head branch.
//      Events created with GITHUB_TOKEN start no workflow run — neither the
//      branch push nor the PR it opens — except `workflow_dispatch`, so this
//      explicit dispatch is what attaches `ratchet` and `lint-typescript` to
//      the release PR's head commit. Both are plain job ids of build.yml, so
//      their check-run names are exactly the ruleset's required contexts.
//
// Opening a PR with GITHUB_TOKEN needs the repository (and organisation)
// setting "Allow GitHub Actions to create and approve pull requests". When it
// is off, the create call answers 403: the branch is still pushed and checked,
// and this module prints `RELEASE-PR-MANUAL <compare-url>` plus a workflow
// warning, so a maintainer opens the PR in one click. It is never an error:
// once the PR exists, every later run updates it.
//
// Output lines (stdout):
//   RELEASE-PR opened #<n> <url> | RELEASE-PR updated #<n> <url>
//   RELEASE-PR closed #<n> | RELEASE-PR none
//   RELEASE-PR-MANUAL <compare-url>
//   RELEASE-PR-CHECKS dispatched <workflow> ref=<head>
//
// Environment: GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY, and optionally
// GITHUB_API_URL, GITHUB_SERVER_URL, GITHUB_STEP_SUMMARY,
// RELEASE_PR_CHECKS_WORKFLOW. The token is only ever sent to the API, never
// printed.

import { appendFileSync, readFileSync } from "node:fs";

export interface ReleaseEntry {
  ext: string;
  version: string;
  tag: string;
  notes: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export type Api = (method: string, path: string, body?: unknown) => Promise<ApiResponse>;

export interface SyncOptions {
  repository: string;
  base: string;
  head: string;
  serverUrl: string;
  workflow: string;
  entries: ReleaseEntry[];
}

export interface SyncIo {
  api: Api;
  out: (line: string) => void;
  summary: (markdown: string) => void;
}

interface PullRequest {
  number: number;
  html_url: string;
}

/** GitHub rejects a PR body above 65 536 characters; keep a margin. */
export const BODY_LIMIT = 60000;

export function renderTitle(entries: ReleaseEntry[]): string {
  return `🔖 Release ${entries.map((e) => e.tag).join(", ")}`;
}

export function renderBody(entries: ReleaseEntry[], base: string): string {
  const head = [
    "## Release",
    "",
    `Merging this PR publishes the releases below. The \`Analyze & Release (Monorepo)\` run on \`${base}\` that the merge starts tags the merged commit and creates each forge release; it opens no new release PR for them.`,
    "",
    `This PR is regenerated from \`${base}\` on every push to it: do not push to its branch. Its required checks are dispatched by the release workflow (issue #1379).`,
    "",
    "| Extension | Version | Tag |",
    "| --- | --- | --- |",
    ...entries.map((e) => `| \`${e.ext}\` | ${e.version} | \`${e.tag}\` |`),
    "",
  ].join("\n");
  const notes = entries.map(
    (e) =>
      `<details>\n<summary>${e.tag} release note</summary>\n\n${e.notes.trim()}\n\n</details>\n`,
  );
  let body = [head, ...notes].join("\n");
  if (body.length > BODY_LIMIT) {
    body = `${head}\nThe release notes are too long for this PR body; each one is in its extension's CHANGELOG.md in this diff.\n`;
  }
  return body;
}

function asPullRequests(body: unknown): PullRequest[] {
  if (!Array.isArray(body)) throw new Error("release-pr: the pull request listing is not an array");
  return body.map(asPullRequest);
}

function asPullRequest(body: unknown): PullRequest {
  if (typeof body !== "object" || body === null)
    throw new Error("release-pr: malformed pull request");
  const { number, html_url } = body as Record<string, unknown>;
  if (typeof number !== "number" || typeof html_url !== "string")
    throw new Error("release-pr: malformed pull request");
  return { number, html_url };
}

function expect(res: ApiResponse, ok: number[], what: string): void {
  if (!ok.includes(res.status)) {
    const message =
      typeof res.body === "object" && res.body !== null && "message" in res.body
        ? String((res.body as { message: unknown }).message)
        : "";
    throw new Error(
      `release-pr: ${what} failed with HTTP ${res.status}${message ? `: ${message}` : ""}`,
    );
  }
}

export async function syncReleasePr(opts: SyncOptions, io: SyncIo): Promise<void> {
  const { repository, base, head, entries } = opts;
  const owner = repository.split("/")[0] ?? "";
  const q = new URLSearchParams({ state: "open", base, head: `${owner}:${head}` });
  const listed = await io.api("GET", `/repos/${repository}/pulls?${q.toString()}`);
  expect(listed, [200], "listing the open release PR");
  const open = asPullRequests(listed.body)[0];

  if (entries.length === 0) {
    if (open === undefined) {
      io.out("RELEASE-PR none");
      return;
    }
    const closed = await io.api("PATCH", `/repos/${repository}/pulls/${open.number}`, {
      state: "closed",
    });
    expect(closed, [200], `closing release PR #${open.number}`);
    io.out(`RELEASE-PR closed #${open.number}`);
    return;
  }

  const title = renderTitle(entries);
  const body = renderBody(entries, base);
  if (open !== undefined) {
    const updated = await io.api("PATCH", `/repos/${repository}/pulls/${open.number}`, {
      title,
      body,
    });
    expect(updated, [200], `updating release PR #${open.number}`);
    io.out(`RELEASE-PR updated #${open.number} ${open.html_url}`);
  } else {
    const created = await io.api("POST", `/repos/${repository}/pulls`, { title, head, base, body });
    if (created.status === 403) {
      const url = `${opts.serverUrl}/${repository}/compare/${base}...${head}?expand=1`;
      io.out(`RELEASE-PR-MANUAL ${url}`);
      io.out(
        `::warning title=Release PR not opened::GITHUB_TOKEN may not open pull requests here; open the release PR from ${url}`,
      );
      io.summary(
        `### Release PR\n\nThe release branch \`${head}\` is ready (${entries.map((e) => `\`${e.tag}\``).join(", ")}), but GITHUB_TOKEN may not open pull requests in this repository. [Open the release PR](${url}).\n`,
      );
    } else {
      expect(created, [201], "opening the release PR");
      const pr = asPullRequest(created.body);
      io.out(`RELEASE-PR opened #${pr.number} ${pr.html_url}`);
    }
  }

  const dispatched = await io.api(
    "POST",
    `/repos/${repository}/actions/workflows/${opts.workflow}/dispatches`,
    {
      ref: head,
    },
  );
  expect(dispatched, [204], `dispatching ${opts.workflow} on ${head}`);
  io.out(`RELEASE-PR-CHECKS dispatched ${opts.workflow} ref=${head}`);
}

export function parseEntries(text: string): ReleaseEntry[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("release-pr: the entries file is not a JSON array");
  return data.map((item: unknown) => {
    const { ext, version, tag, notes } = (item ?? {}) as Record<string, unknown>;
    if (typeof ext !== "string" || typeof version !== "string" || typeof tag !== "string")
      throw new Error("release-pr: an entry lacks ext, version or tag");
    return { ext, version, tag, notes: typeof notes === "string" ? notes : "" };
  });
}

export function fetchApi(apiUrl: string, token: string): Api {
  return async (method, path, body) => {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  };
}

const USAGE = "Usage: node scripts/release-pr.ts sync <base> <head> <entries.json>";

/** CLI entry (scripts/release-pr.ts). Returns the process exit code. */
export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [command, base, head, entriesFile] = argv;
  if (command !== "sync" || !base || !head || !entriesFile) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
  const repository = env.GITHUB_REPOSITORY || "";
  if (token === "" || repository === "") {
    process.stderr.write(
      "release-pr: GITHUB_TOKEN (or GH_TOKEN) and GITHUB_REPOSITORY are required\n",
    );
    return 2;
  }
  const summaryFile = env.GITHUB_STEP_SUMMARY || "";
  try {
    await syncReleasePr(
      {
        repository,
        base,
        head,
        serverUrl: env.GITHUB_SERVER_URL || "https://github.com",
        workflow: env.RELEASE_PR_CHECKS_WORKFLOW || "build.yml",
        entries: parseEntries(readFileSync(entriesFile, "utf8")),
      },
      {
        api: fetchApi(env.GITHUB_API_URL || "https://api.github.com", token),
        out: (line) => process.stdout.write(`${line}\n`),
        summary: (markdown) => {
          if (summaryFile !== "") appendFileSync(summaryFile, markdown);
        },
      },
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  return 0;
}
