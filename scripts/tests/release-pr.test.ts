// release-pr.test.ts — unit tests for the GitHub release-PR sync
// scripts/lib/release-pr.ts (issue #1379), against an in-memory API double.
//
// The bug: the release workflow pushed its version commit straight to `main`,
// which the `main-protected` ruleset now rejects (GH013). The release PR that
// replaces that push must (a) be opened or updated with the pending releases,
// (b) get its required checks through an explicit workflow_dispatch, since a
// GITHUB_TOKEN event starts no run, (c) degrade to a manual link when
// GITHUB_TOKEN may not open PRs, and (d) be closed, never re-opened, once
// nothing is pending — the no-loop property after a merge.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Api,
  type ApiResponse,
  BODY_LIMIT,
  type ReleaseEntry,
  main,
  parseEntries,
  renderBody,
  renderTitle,
  syncReleasePr,
} from "../lib/release-pr.ts";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeApi(answers: Record<string, ApiResponse>): { api: Api; calls: Call[] } {
  const calls: Call[] = [];
  const api: Api = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split("?")[0]}`;
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unexpected call ${key}`);
    return answer;
  };
  return { api, calls };
}

const FOO: ReleaseEntry = {
  ext: "foo",
  version: "1.3.0",
  tag: "foo-v1.3.0",
  notes: "# foo-v1.3.0\n\n- ✨ a",
};
const BAZ: ReleaseEntry = {
  ext: "baz",
  version: "1.0.0",
  tag: "baz-v1.0.0",
  notes: "# baz-v1.0.0",
};

const PULLS = "/repos/acme/fixture/pulls";
const DISPATCH = "/repos/acme/fixture/actions/workflows/build.yml/dispatches";

async function run(entries: ReleaseEntry[], answers: Record<string, ApiResponse>) {
  const { api, calls } = fakeApi(answers);
  const out: string[] = [];
  const summary: string[] = [];
  await syncReleasePr(
    {
      repository: "acme/fixture",
      base: "main",
      head: "release-pr/main",
      serverUrl: "https://github.com",
      workflow: "build.yml",
      entries,
    },
    { api, out: (l) => out.push(l), summary: (m) => summary.push(m) },
  );
  return { calls, out, summary };
}

describe("rendering", () => {
  test("the title lists every pending tag behind a non-release gitmoji", () => {
    assert.equal(renderTitle([FOO, BAZ]), "🔖 Release foo-v1.3.0, baz-v1.0.0");
  });

  test("the title and body never carry [skip ci] (it would suppress the publishing run)", () => {
    assert.ok(!renderTitle([FOO]).includes("[skip ci]"));
    assert.ok(!renderBody([FOO], "main").includes("[skip ci]"));
  });

  test("the body tabulates each release and folds its note", () => {
    const body = renderBody([FOO, BAZ], "main");
    assert.match(body, /\| `foo` \| 1\.3\.0 \| `foo-v1\.3\.0` \|/);
    assert.match(body, /<summary>baz-v1\.0\.0 release note<\/summary>/);
    assert.ok(body.includes("- ✨ a"));
  });

  test("an oversized body drops the notes, keeping the table", () => {
    const big = { ...FOO, notes: "x".repeat(BODY_LIMIT + 1) };
    const body = renderBody([big], "main");
    assert.ok(body.length < BODY_LIMIT);
    assert.match(body, /`foo-v1\.3\.0`/);
    assert.match(body, /CHANGELOG\.md/);
  });
});

describe("syncReleasePr", () => {
  test("opens the PR when none is open, then dispatches the checks on its head", async () => {
    const { calls, out } = await run([FOO], {
      [`GET ${PULLS}`]: { status: 200, body: [] },
      [`POST ${PULLS}`]: {
        status: 201,
        body: { number: 7, html_url: "https://github.com/acme/fixture/pull/7" },
      },
      [`POST ${DISPATCH}`]: { status: 204, body: null },
    });
    assert.equal(calls[0]?.path, `${PULLS}?state=open&base=main&head=acme%3Arelease-pr%2Fmain`);
    assert.deepEqual(calls[1]?.body, {
      title: "🔖 Release foo-v1.3.0",
      head: "release-pr/main",
      base: "main",
      body: renderBody([FOO], "main"),
    });
    assert.deepEqual(calls[2], {
      method: "POST",
      path: DISPATCH,
      body: { ref: "release-pr/main" },
    });
    assert.deepEqual(out, [
      "RELEASE-PR opened #7 https://github.com/acme/fixture/pull/7",
      "RELEASE-PR-CHECKS dispatched build.yml ref=release-pr/main",
    ]);
  });

  test("updates the open PR instead of opening a second one", async () => {
    const { calls, out } = await run([FOO, BAZ], {
      [`GET ${PULLS}`]: { status: 200, body: [{ number: 7, html_url: "u7" }] },
      [`PATCH ${PULLS}/7`]: { status: 200, body: { number: 7, html_url: "u7" } },
      [`POST ${DISPATCH}`]: { status: 204, body: null },
    });
    assert.equal(calls.filter((c) => c.method === "POST" && c.path === PULLS).length, 0);
    assert.deepEqual(calls[1]?.body, {
      title: renderTitle([FOO, BAZ]),
      body: renderBody([FOO, BAZ], "main"),
    });
    assert.deepEqual(out, [
      "RELEASE-PR updated #7 u7",
      "RELEASE-PR-CHECKS dispatched build.yml ref=release-pr/main",
    ]);
  });

  test("a 403 on create (Actions may not open PRs) degrades to a manual link, still dispatching", async () => {
    const { calls, out, summary } = await run([FOO], {
      [`GET ${PULLS}`]: { status: 200, body: [] },
      [`POST ${PULLS}`]: {
        status: 403,
        body: { message: "GitHub Actions is not permitted to create or approve pull requests." },
      },
      [`POST ${DISPATCH}`]: { status: 204, body: null },
    });
    const url = "https://github.com/acme/fixture/compare/main...release-pr/main?expand=1";
    assert.equal(out[0], `RELEASE-PR-MANUAL ${url}`);
    assert.match(out[1] ?? "", /^::warning title=Release PR not opened::/);
    assert.equal(out[2], "RELEASE-PR-CHECKS dispatched build.yml ref=release-pr/main");
    assert.match(summary[0] ?? "", /\[Open the release PR\]\(/);
    assert.equal(calls.at(-1)?.path, DISPATCH);
  });

  test("with nothing pending, a stale open PR is closed and nothing is dispatched or opened", async () => {
    const { calls, out } = await run([], {
      [`GET ${PULLS}`]: { status: 200, body: [{ number: 7, html_url: "u7" }] },
      [`PATCH ${PULLS}/7`]: { status: 200, body: { number: 7, html_url: "u7" } },
    });
    assert.deepEqual(calls[1]?.body, { state: "closed" });
    assert.equal(calls.length, 2);
    assert.deepEqual(out, ["RELEASE-PR closed #7"]);
  });

  test("with nothing pending and no PR (right after a release PR merge), it only lists", async () => {
    const { calls, out } = await run([], { [`GET ${PULLS}`]: { status: 200, body: [] } });
    assert.equal(calls.length, 1);
    assert.deepEqual(out, ["RELEASE-PR none"]);
  });

  test("any other API failure is an error naming the step and status", async () => {
    await assert.rejects(
      run([FOO], {
        [`GET ${PULLS}`]: { status: 200, body: [] },
        [`POST ${PULLS}`]: { status: 201, body: { number: 7, html_url: "u7" } },
        [`POST ${DISPATCH}`]: { status: 404, body: { message: "Not Found" } },
      }),
      /dispatching build\.yml on release-pr\/main failed with HTTP 404: Not Found/,
    );
  });
});

describe("CLI", () => {
  test("parseEntries rejects an entry without a tag", () => {
    assert.throws(
      () => parseEntries('[{"ext":"foo","version":"1.0.0"}]'),
      /lacks ext, version or tag/,
    );
    assert.deepEqual(parseEntries("[]"), []);
  });

  test("main refuses (exit 2) without a token, naming only the variables", async () => {
    const code = await main(["sync", "main", "release-pr/main", "/nonexistent"], {
      GITHUB_REPOSITORY: "a/b",
    });
    assert.equal(code, 2);
  });

  test("main refuses (exit 2) on a bad command line", async () => {
    assert.equal(await main(["open"], {}), 2);
  });
});
