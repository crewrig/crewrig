// skill-scripts-cases-github-flow.ts — the case table of github-actions/simulate-workflow (spec
// 0258 R28, plan step 8). `act` and `docker` are stubs written into the sandbox `bin/`; the act
// stub copies the `--eventpath` file into the sandbox so the payload content is observed.

import { DOCKER_OK, TERM, WF } from "./skill-scripts-cases-github-sim.ts";
import type { SkillCase } from "./skill-scripts-observe.ts";

const FLOW = "github-actions/simulate-workflow";
/** Copies the `--eventpath` file into the sandbox so the payload content is observed. */
const SEEN =
  'while [ "$#" -gt 0 ]; do\n  if [ "$1" = --eventpath ]; then cat "$2" > "$HOME/payload.seen"; fi\n  shift\ndone\n';
const ACT_SEEN = `${SEEN}echo 'act: dry run done'\nexit 0\n`;
const SEEN_READY = { act: ACT_SEEN, docker: DOCKER_OK };
const PAYLOAD = '{"custom":true}';

function flow(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: FLOW, files: { "wf.yml": WF }, stubs: SEEN_READY, ...c };
}
const byEvent = (event: string, name = event.replaceAll("_", "-")): SkillCase =>
  flow(`default-payload-${name}`, { args: ["wf.yml", event] });

export const SIMULATE_WORKFLOW: readonly SkillCase[] = [
  // arguments
  flow("no-argument", { args: [] }),
  flow("four-arguments", { args: ["wf.yml", "push", "p.json", "extra"] }),
  flow("empty-workflow-argument", { args: [""] }),
  flow("help-flag", { args: ["--help"] }),
  flow("one-argument-default-event", { args: ["wf.yml"] }),
  flow("empty-event-defaults-to-push", { args: ["wf.yml", ""] }),
  flow("workflow-with-spaces", { args: ["my wf.yml"], files: { "my wf.yml": WF } }),
  flow("absolute-workflow-path", { args: ["{WORK}/wf.yml", "push"] }),
  flow("symlink-workflow", { args: ["link.yml"], links: { "link.yml": "wf.yml" } }),

  // the default payload of each event
  ...["push", "pull_request", "workflow_dispatch", "release", "schedule"].map((event) =>
    byEvent(event),
  ),
  byEvent("no_such_event"),
  byEvent("PUSH", "upper-push"),
  byEvent("Pull_Request", "mixed-case-pull-request"),
  flow("event-with-spaces", { args: ["wf.yml", "a b"] }),

  // a given payload
  flow("given-payload", {
    args: ["wf.yml", "push", "p.json"],
    files: { "wf.yml": WF, "p.json": PAYLOAD },
  }),
  flow("given-payload-wins-over-event", {
    args: ["wf.yml", "release", "p.json"],
    files: { "wf.yml": WF, "p.json": PAYLOAD },
  }),
  flow("given-payload-empty-event", {
    args: ["wf.yml", "", "p.json"],
    files: { "wf.yml": WF, "p.json": PAYLOAD },
  }),
  flow("given-payload-empty-file", {
    args: ["wf.yml", "push", "p.json"],
    files: { "wf.yml": WF, "p.json": "" },
  }),
  flow("given-payload-not-json", {
    args: ["wf.yml", "push", "p.json"],
    files: { "wf.yml": WF, "p.json": "not json at all\r\n" },
  }),
  flow("given-payload-with-spaces", {
    args: ["wf.yml", "push", "my payload.json"],
    files: { "wf.yml": WF, "my payload.json": PAYLOAD },
  }),
  flow("given-payload-absolute", {
    args: ["wf.yml", "push", "{WORK}/p.json"],
    files: { "wf.yml": WF, "p.json": PAYLOAD },
  }),
  flow("given-payload-symlink", {
    args: ["wf.yml", "push", "link.json"],
    files: { "wf.yml": WF, "p.json": PAYLOAD },
    links: { "link.json": "p.json" },
  }),
  flow("empty-payload-argument-means-not-given", { args: ["wf.yml", "push", ""] }),
  flow("empty-payload-argument-with-event", { args: ["wf.yml", "pull_request", ""] }),
  flow("given-payload-missing", { args: ["wf.yml", "push", "missing.json"] }),
  flow("given-payload-is-a-directory", { args: ["wf.yml", "push", "adir"], dirs: ["adir"] }),

  // the preconditions, in order
  flow("workflow-missing", { args: ["missing.yml"] }),
  flow("workflow-missing-with-missing-payload", { args: ["missing.yml", "push", "missing.json"] }),
  flow("workflow-missing-without-tools", { args: ["missing.yml"], stubs: {} }),
  flow("act-absent", { args: ["wf.yml"], stubs: { docker: DOCKER_OK } }),
  flow("act-absent-payload-missing", {
    args: ["wf.yml", "push", "missing.json"],
    stubs: { docker: DOCKER_OK },
  }),
  flow("docker-absent", { args: ["wf.yml"], stubs: { act: ACT_SEEN } }),
  flow("docker-absent-payload-missing", {
    args: ["wf.yml", "push", "missing.json"],
    stubs: { act: ACT_SEEN },
  }),
  flow("docker-info-fails", { args: ["wf.yml"], stubs: { act: ACT_SEEN, docker: "exit 1\n" } }),
  flow("docker-info-fails-payload-missing", {
    args: ["wf.yml", "push", "missing.json"],
    stubs: { act: ACT_SEEN, docker: "exit 1\n" },
  }),

  // the act call and the temp payload file
  flow("act-succeeds", { args: ["wf.yml", "push"] }),
  flow("act-exits-3-removes-temp-payload", {
    args: ["wf.yml", "push"],
    stubs: { act: `${SEEN}echo act-err >&2\nexit 3\n`, docker: DOCKER_OK },
  }),
  flow("act-killed-by-term-removes-temp-payload", {
    deviation: "(o)", // bash prints its own `Terminated` job message on stderr; the entry prints none
    args: ["wf.yml", "push"],
    stubs: { act: `${SEEN}${TERM}`, docker: DOCKER_OK },
  }),
  flow("act-exits-3-with-given-payload", {
    args: ["wf.yml", "push", "p.json"],
    files: { "wf.yml": WF, "p.json": PAYLOAD },
    stubs: { act: `${SEEN}exit 3\n`, docker: DOCKER_OK },
  }),
  flow("act-passthrough-streams", {
    args: ["wf.yml"],
    stubs: { act: `${SEEN}echo line-1\necho err-1 >&2\nexit 0\n`, docker: DOCKER_OK },
  }),
  flow("temp-payload-removed-by-act-itself", {
    args: ["wf.yml"],
    stubs: {
      act: `${SEEN}while [ "$#" -gt 0 ]; do if [ "$1" = --eventpath ]; then rm -f "$2"; fi; shift; done\nexit 0\n`,
      docker: DOCKER_OK,
    },
  }),
];
