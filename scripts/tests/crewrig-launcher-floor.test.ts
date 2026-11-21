// crewrig-launcher-floor.test.ts — the runtime floor of the organization launcher (spec 0314 R4 and
// R10; spec 0288 R3): on a Node.js major version below 24 the launcher prints one sentence naming Node.js
// 24 and the runtime it found, exits with code 10, and reads neither the pin nor the network.
//
// Two legs. The real case runs only on a Node.js 22 runtime (the `node@22` leg of CI, governance-ci) and
// is skipped, with the runtime named, anywhere else. The simulated cases run on every runtime: a preload
// makes `process.versions.node` report another version, which is all the launcher consults. This file
// imports nothing from the repository, so it loads on Node.js 22 as well.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const LAUNCHER = path.resolve(import.meta.dirname, "..", "..", "templates", "org-repo", "crewrig");
const RUNTIME_MAJOR = Number(process.versions.node.split(".")[0]);
const roots: string[] = [];

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Setup {
  dir: string;
  home: string;
  requests: string[];
  stop(): Promise<void>;
}

/** A directory for the launcher (with the given pin text, if any), a temporary HOME and a counting server. */
async function setup(pin: string | undefined): Promise<Setup & { baseUrl: string }> {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "crewrig-floor-")),
  );
  roots.push(root);
  const dir = path.join(root, "org");
  const home = path.join(root, "home");
  fs.mkdirSync(dir);
  fs.mkdirSync(home);
  fs.copyFileSync(LAUNCHER, path.join(dir, "crewrig"));
  if (pin !== undefined) fs.writeFileSync(path.join(dir, "crewrig.pin.json"), pin);
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    dir,
    home,
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

interface Outcome {
  code: number | null;
  out: string;
}

function launch(world: Setup & { baseUrl: string }, nodeArgs: string[]): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(git_|node_options$)/i.test(key)) delete env[key];
    }
    env.HOME = world.home;
    env.USERPROFILE = world.home;
    env.CREWRIG_RELEASE_BASE_URL = world.baseUrl;
    const child = spawn(process.execPath, [...nodeArgs, path.join(world.dir, "crewrig"), "init"], {
      cwd: world.dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

const VALID_PIN = JSON.stringify({ version: "1.0.0", sha256: "0".repeat(64) });

/** A preload that makes the launcher see another Node.js version. */
function pretend(version: string): string[] {
  const code = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });`;
  return ["--import", `data:text/javascript,${encodeURIComponent(code)}`];
}

function assertFloorRefusal(outcome: Outcome, runtime: string): void {
  assert.equal(outcome.code, 10, outcome.out);
  assert.equal(outcome.out.trim().split("\n").length, 1, `one sentence: ${outcome.out}`);
  assert.match(outcome.out, /Node\.js 24/);
  assert.ok(outcome.out.includes(runtime), `names the runtime ${runtime}: ${outcome.out}`);
}

describe("the real floor, on a Node.js 22 runtime (scenario: the runtime floor is not met)", () => {
  const onNode22 = RUNTIME_MAJOR === 22;
  const skip = onNode22
    ? false
    : `the runtime is Node.js ${process.versions.node}, not 22: this case runs on the node@22 leg of CI (governance-ci, crewrig-launcher-floor)`;

  test(
    "exits 10 with one sentence naming Node.js 24 and 22, and reads neither the pin nor the network",
    { skip },
    async () => {
      const world = await setup(VALID_PIN);
      try {
        const outcome = await launch(world, []);

        assertFloorRefusal(outcome, "22");
        assert.deepEqual(world.requests, []);
        assert.deepEqual(fs.readdirSync(world.home), [], "nothing is written under the home");
      } finally {
        await world.stop();
      }
    },
  );

  test("exits 10 in a directory with no pin file at all", { skip }, async () => {
    const world = await setup(undefined);
    try {
      assertFloorRefusal(await launch(world, []), "22");
    } finally {
      await world.stop();
    }
  });
});

describe("the floor under a pretended runtime version (every runtime)", () => {
  for (const version of ["22.12.0", "23.5.0", "20.19.0", "18.0.0", "9.11.2", "23.9.9"]) {
    test(`Node.js ${version} exits 10, naming Node.js 24 and ${version}, before the pin and the network`, async () => {
      const world = await setup(VALID_PIN);
      try {
        const outcome = await launch(world, pretend(version));

        assertFloorRefusal(outcome, version);
        assert.deepEqual(world.requests, []);
        assert.deepEqual(fs.readdirSync(world.home), []);
      } finally {
        await world.stop();
      }
    });
  }

  test("the floor is decided before the pin: a malformed pin file is still code 10", async () => {
    const world = await setup("{not json");
    try {
      assertFloorRefusal(await launch(world, pretend("22.12.0")), "22.12.0");
    } finally {
      await world.stop();
    }
  });

  const above = RUNTIME_MAJOR >= 24;
  for (const version of ["24.0.0", "25.1.0", "30.0.0"]) {
    test(
      `Node.js ${version} is not refused: the pin is read next (code 11 for a malformed pin)`,
      {
        skip: above ? false : "needs a Node.js 24 runtime to run the launcher past the floor",
      },
      async () => {
        const world = await setup("{not json");
        try {
          const outcome = await launch(world, pretend(version));

          assert.equal(outcome.code, 11, outcome.out);
          assert.match(outcome.out, /crewrig\.pin\.json/);
        } finally {
          await world.stop();
        }
      },
    );
  }
});
